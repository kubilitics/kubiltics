package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// shellStreamUpgrader is no longer used — replaced by h.newWSUpgrader() for proper origin validation.
// Kept as a comment for reference: ReadBufferSize=65536, WriteBufferSize=65536.

// GetShellStream handles GET /clusters/{clusterId}/shell/stream
// Upgrades to WebSocket and runs an interactive PTY shell with KUBECONFIG set for the cluster.
// Protocol: same as pod exec — stdin, resize (rows/cols), stdout/stderr base64, exit, error.
// Enables full kubectl and any other CLI with zero round-trip latency per keystroke.
func (h *Handler) GetShellStream(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	log.Printf("Terminal: Incoming request for cluster %s", clusterID)
	if !validate.ClusterID(clusterID) {
		log.Printf("Terminal: Invalid clusterId %s", clusterID)
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	cluster, err := h.clusterService.GetCluster(r.Context(), clusterID)
	if err != nil {
		log.Printf("Terminal: Cluster %s not found: %v", clusterID, err)
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	log.Printf("Terminal: Found cluster %s (name: %s, kubeconfig: %s)", clusterID, cluster.Name, cluster.KubeconfigPath)
	if cluster.KubeconfigPath == "" {
		log.Printf("Terminal: Cluster %s has no kubeconfig path", clusterID)
		respondError(w, http.StatusBadRequest, "Cluster has no kubeconfig path")
		return
	}

	// Enforce per-cluster per-user WebSocket connection limit.
	wsRelease, wsErr := h.wsAcquire(r, clusterID)
	if wsErr != nil {
		respondError(w, http.StatusTooManyRequests, wsErr.Error())
		return
	}
	defer wsRelease()

	upgrader := h.newWSUpgrader(65536, 65536)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Terminal: WebSocket upgrade failed for %s: %v", clusterID, err)
		return
	}
	log.Printf("Terminal: WebSocket upgraded for %s", clusterID)
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sendErr := func(msg string) {
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: msg})
	}

	shell := "/bin/bash"
	if _, err := exec.LookPath("bash"); err != nil {
		shell = "/bin/sh"
	}
	env := append(os.Environ(), "KUBECONFIG="+cluster.KubeconfigPath)
	workDir := "/tmp"
	if d, err := os.UserHomeDir(); err == nil && d != "" {
		workDir = d
	}
	// Wrapper: source kcli completion (bash only), set context if needed, then exec interactive shell.
	// This gives native Tab completion for kcli and aliases k/kubectl to kcli.
	// We must ensure kcli is in the PATH. If not, we try to use the absolute path.
	kcliPath := "kcli"
	if _, err := exec.LookPath("kcli"); err != nil {
		// Fallback to absolute path in dev environment
		devPath := "/Users/koti/myFuture/Kubernetes/kubilitics-os-emergent/kcli/kcli"
		if _, err := os.Stat(devPath); err == nil {
			kcliPath = devPath
		}
	}

	ctxArg := strings.ReplaceAll(cluster.Context, "'", "'\"'\"'")
	var wrapper string

	// Phase 5: Fix Shell Instability - Strict kcli requirement.
	// We MUST ensure kcli is runnable. If not, we fail the shell session immediately.
	// We do NOT want to fall back to a raw zsh/bash if kcli is missing.

	// Common preamble: Check kcli, setup aliases.
	// If kcli is missing, print error and exit immediately.
	preamble := fmt.Sprintf(`
		if ! command -v %s &> /dev/null; then
			echo "❌ Critical Error: kcli binary not found at '%s'"
			echo "The shell cannot start without the Kubilitics backend CLI."
			exit 1
		fi
		alias k=%s
		alias kubectl=%s
		alias kcl=%s
		alias kubectx='%s ctx'
		alias kubens='%s ns'
		alias k9s='%s ui'
	`, kcliPath, kcliPath, kcliPath, kcliPath, kcliPath, kcliPath, kcliPath, kcliPath)

	if shell == "/bin/bash" {
		wrapper = preamble + fmt.Sprintf("source <(%s completion bash) 2>/dev/null; ", kcliPath)
		if cluster.Context != "" {
			wrapper += fmt.Sprintf("%s config use-context '%s' 2>/dev/null || exit 1; ", kcliPath, ctxArg)
		}
		wrapper += "exec bash -i"
	} else {
		wrapper = preamble
		if cluster.Context != "" {
			wrapper += fmt.Sprintf("%s config use-context '%s' 2>/dev/null || exit 1; ", kcliPath, ctxArg)
		}
		wrapper += "exec sh -i"
	}
	cmd := exec.CommandContext(ctx, shell, "-c", wrapper)
	cmd.Env = env
	cmd.Dir = workDir

	ptmx, err := pty.Start(cmd)
	if err != nil {
		sendErr("Failed to start shell: " + err.Error())
		return
	}
	defer func() {
		_ = ptmx.Close()
		_ = cmd.Process.Kill()
	}()

	outChan := make(chan wsOutMessage, 128)
	execDone := make(chan struct{})
	var once sync.Once
	closeExecDone := func() { once.Do(func() { close(execDone) }) }
	writerDone := make(chan struct{})
	defer func() {
		// Cancel context FIRST so goroutines see ctx.Done() before outChan is closed.
		cancel()
		closeExecDone()
		// Wait for PTY reader to finish, but do not block forever (avoids hang on client disconnect).
		select {
		case <-execDone:
		case <-time.After(3 * time.Second):
		}
		time.Sleep(50 * time.Millisecond)
		close(outChan)
		<-writerDone
	}()

	// Single writer goroutine: send all messages to WebSocket; exit on write error to avoid EPIPE.
	go func() {
		defer close(writerDone)
		for m := range outChan {
			b, _ := json.Marshal(m)
			conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		}
	}()

	stdoutW := &chanWriter{ch: outChan, typ: wsMsgStdout}
	// PTY combines stdout+stderr into one stream; send as stdout
	go func() {
		defer closeExecDone()
		_, _ = io.Copy(stdoutW, ptmx)
		select {
		case outChan <- wsOutMessage{T: wsMsgExit}:
		case <-ctx.Done():
		}
	}()

	// Initial size
	_ = pty.Setsize(ptmx, &pty.Winsize{Cols: 80, Rows: 24})

	const readDeadline = 60 * time.Second
	const pingInterval = 30 * time.Second

	// Ping keepalive: detect dead connections when client disappears without closing
	pingDone := make(chan struct{})
	defer close(pingDone)
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-pingDone:
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(readDeadline))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(readDeadline))
	})
	for {
		conn.SetReadDeadline(time.Now().Add(readDeadline))
		_, data, err := conn.ReadMessage()
		if err != nil {
			cancel()
			_ = ptmx.Close()
			select {
			case <-execDone:
			case <-time.After(2 * time.Second):
			}
			return
		}

		var msg wsInMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}

		switch msg.T {
		case wsMsgStdin:
			if msg.D != "" {
				dec, err := base64.StdEncoding.DecodeString(msg.D)
				if err == nil && len(dec) > 0 {
					_, _ = ptmx.Write(dec)
				}
			}
		case wsMsgResize:
			if msg.R != nil && msg.R.Rows > 0 && msg.R.Cols > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{
					Cols: msg.R.Cols,
					Rows: msg.R.Rows,
				})
			}
		}
	}
}
