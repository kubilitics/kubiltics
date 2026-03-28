package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// execUpgrader is no longer used — replaced by h.newWSUpgrader() for proper origin validation.
// Kept as a comment for reference: ReadBufferSize=4096, WriteBufferSize=4096.

const (
	wsMsgStdin  = "stdin"
	wsMsgResize = "resize"
	wsMsgStdout = "stdout"
	wsMsgStderr = "stderr"
	wsMsgExit   = "exit"
	wsMsgError  = "error"

	execReadLimit   = 1 << 16
	execPongWait    = 75 * time.Second
	execPingPeriod  = 25 * time.Second
	execWriteWait   = 30 * time.Second
	execDrainWait   = 50 * time.Millisecond
	execDefaultCols = 80
	execDefaultRows = 24
)

type wsInMessage struct {
	T string         `json:"t"`
	D string         `json:"d,omitempty"`
	R *resizePayload `json:"r,omitempty"`
}

type resizePayload struct {
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

type wsOutMessage struct {
	T string `json:"t"`
	D string `json:"d,omitempty"`
}

type sizeQueue struct {
	ch  chan *remotecommand.TerminalSize
	ctx context.Context
}

func (q *sizeQueue) Next() *remotecommand.TerminalSize {
	select {
	case s := <-q.ch:
		return s
	case <-q.ctx.Done():
		return nil
	}
}

func (q *sizeQueue) push(cols, rows uint16) {
	select {
	case q.ch <- &remotecommand.TerminalSize{Width: cols, Height: rows}:
	default:
	}
}

type chanWriter struct {
	ch  chan<- wsOutMessage
	typ string
}

func (w *chanWriter) Write(p []byte) (n int, err error) {
	if len(p) == 0 {
		return 0, nil
	}
	d := base64.StdEncoding.EncodeToString(p)
	// Block so we never drop stdout/stderr; back-pressure propagates to the exec stream.
	w.ch <- wsOutMessage{T: w.typ, D: d}
	return len(p), nil
}

// GetPodExec handles GET /clusters/{clusterId}/pods/{namespace}/{name}/exec
// Upgrades to WebSocket and runs an interactive shell (exec) in the pod container.
// Query: container=..., shell=/bin/sh (default).
// Protocol: Client -> Server: {"t":"stdin","d":"<base64>"} | {"t":"resize","r":{"rows":N,"cols":M}}
// Server -> Client: {"t":"stdout","d":"<base64>"} | {"t":"stderr","d":"<base64>"} | {"t":"exit"} | {"t":"error","d":"msg"}
func (h *Handler) GetPodExec(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod name")
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	container := r.URL.Query().Get("container")
	shell := r.URL.Query().Get("shell")
	if shell == "" {
		shell = "/bin/sh"
	}

	// Enforce per-cluster per-user WebSocket connection limit.
	wsRelease, wsErr := h.wsAcquire(r, clusterID)
	if wsErr != nil {
		respondError(w, http.StatusTooManyRequests, wsErr.Error())
		return
	}
	defer wsRelease()

	upgrader := h.newWSUpgrader(4096, 4096)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	log.Printf(
		"pod exec: connected requestedCluster=%s ns=%s pod=%s container=%s",
		clusterID,
		namespace,
		name,
		container,
	)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sendWSError := func(msg string) {
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: msg})
	}

	pod, err := client.Clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		sendWSError("pod not found or not accessible: " + err.Error())
		return
	}
	if container == "" {
		if len(pod.Spec.Containers) == 1 {
			container = pod.Spec.Containers[0].Name
		} else {
			names := make([]string, 0, len(pod.Spec.Containers))
			for _, c := range pod.Spec.Containers {
				names = append(names, c.Name)
			}
			sendWSError("container query is required when pod has multiple containers. Valid: " + strings.Join(names, ", "))
			return
		}
	} else {
		found := false
		for _, c := range pod.Spec.Containers {
			if c.Name == container {
				found = true
				break
			}
		}
		if !found {
			names := make([]string, 0, len(pod.Spec.Containers))
			for _, c := range pod.Spec.Containers {
				names = append(names, c.Name)
			}
			sendWSError(fmt.Sprintf("container %q not found in pod. Valid: %s", container, strings.Join(names, ", ")))
			return
		}
	}

	stdinR, stdinW := io.Pipe()
	defer func() { _ = stdinW.Close() }()

	outChan := make(chan wsOutMessage, 256)
	execDone := make(chan struct{})

	sizeCh := make(chan *remotecommand.TerminalSize, 4)
	sq := &sizeQueue{ch: sizeCh, ctx: ctx}
	sq.push(execDefaultCols, execDefaultRows)

	defer func() {
		<-execDone
		time.Sleep(execDrainWait)
		close(outChan)
	}()

	conn.SetReadLimit(execReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(execPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(execPongWait))
	})

	go func() {
		pingTicker := time.NewTicker(execPingPeriod)
		defer pingTicker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(execWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					cancel()
					return
				}
			case m, ok := <-outChan:
				if !ok {
					return
				}
				b, _ := json.Marshal(m)
				_ = conn.SetWriteDeadline(time.Now().Add(execWriteWait))
				if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	stdoutW := &chanWriter{ch: outChan, typ: wsMsgStdout}
	stderrW := &chanWriter{ch: outChan, typ: wsMsgStderr}

	// Build command: try multiple shells for distroless/minimal containers.
	// The wrapper script tries bash → sh → ash in order within a single exec.
	// If the user specified a custom shell, use that directly.
	command := []string{shell}
	if shell == "/bin/sh" {
		wrapperScript := `
if [ -x /bin/bash ]; then
  exec /bin/bash -il
elif [ -x /bin/sh ]; then
  exec /bin/sh -i
elif [ -x /bin/ash ]; then
  exec /bin/ash -i
else
  echo "No interactive shell found in this container."
  echo "This is likely a distroless/minimal image."
  echo "Try using a debug container: kubectl debug -it <pod> --image=busybox"
  sleep 3600
fi
`
		command = []string{"/bin/sh", "-c", wrapperScript}
	}

	req := client.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(name).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   command,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(client.Config, "POST", req.URL())
	if err != nil {
		close(execDone)
		select {
		case outChan <- wsOutMessage{T: wsMsgError, D: "Failed to create executor: " + err.Error()}:
		default:
		}
		return
	}

	go func() {
		defer close(execDone)
		err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdin:             stdinR,
			Stdout:            stdoutW,
			Stderr:            stderrW,
			Tty:               true,
			TerminalSizeQueue: sq,
		})
		if err != nil {
			select {
			case outChan <- wsOutMessage{T: wsMsgError, D: err.Error()}:
			default:
			}
		}
		select {
		case outChan <- wsOutMessage{T: wsMsgExit}:
		default:
		}
	}()

	firstStdinLogged := false
	for {
		_ = conn.SetReadDeadline(time.Now().Add(execPongWait))
		_, data, err := conn.ReadMessage()
		if err != nil {
			cancel()
			_ = stdinW.Close()
			<-execDone
			return
		}

		var msg wsInMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}

		switch msg.T {
		case wsMsgStdin:
			if msg.D != "" {
				if !firstStdinLogged {
					firstStdinLogged = true
					log.Printf(
						"pod exec: first stdin received requestedCluster=%s ns=%s pod=%s container=%s",
						clusterID,
						namespace,
						name,
						container,
					)
				}
				dec, err := base64.StdEncoding.DecodeString(msg.D)
				if err == nil && len(dec) > 0 {
					_, _ = stdinW.Write(dec)
				}
			}
		case wsMsgResize:
			if msg.R != nil && msg.R.Rows > 0 && msg.R.Cols > 0 {
				sq.push(msg.R.Cols, msg.R.Rows)
			}
		}
	}
}
