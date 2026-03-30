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
	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetKCLIStream handles GET /clusters/{clusterId}/kcli/stream.
// Launches an interactive shell session with kcli available as the primary CLI.
// Protocol is identical to pod exec/shell stream: stdin, resize, stdout/stderr(base64), exit, error.
func (h *Handler) GetKCLIStream(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	requestID := logger.FromContext(r.Context())
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	cluster, err := h.clusterService.GetCluster(r.Context(), resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	if cluster.KubeconfigPath == "" {
		respondError(w, http.StatusBadRequest, "Cluster has no kubeconfig path")
		return
	}
	mode := "shell"
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if !h.allowKCLIRate(resolvedID, "stream") {
		respondError(w, http.StatusTooManyRequests, "kcli stream rate limit exceeded")
		return
	}
	releaseStreamSlot, ok := h.acquireKCLIStreamSlot(resolvedID)
	if !ok {
		respondError(w, http.StatusTooManyRequests, "too many concurrent kcli streams for this cluster")
		return
	}
	defer releaseStreamSlot()

	// Enforce per-cluster per-user WebSocket connection limit.
	wsRelease, wsErr := h.wsAcquire(r, resolvedID)
	if wsErr != nil {
		respondError(w, http.StatusTooManyRequests, wsErr.Error())
		return
	}
	defer wsRelease()

	upgrader := h.newWSUpgrader(65536, 65536)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()

	log.Printf(
		"kcli stream: connected requestedCluster=%s resolvedCluster=%s context=%s mode=%s",
		clusterID,
		resolvedID,
		cluster.Context,
		mode,
	)
	metrics.KCLIStreamConnectionsTotal.WithLabelValues(mode).Inc()
	metrics.KCLIStreamConnectionsActive.WithLabelValues(mode).Inc()
	audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "success", "connected", 0, time.Since(start))
	
	// Decrement active connections when stream closes
	defer func() {
		metrics.KCLIStreamConnectionsActive.WithLabelValues(mode).Dec()
	}()

	cmd, err := h.makeKCLIStreamCommand(r.Context(), cluster.Context, cluster.KubeconfigPath, mode, namespace)
	if err != nil {
		// Log binary resolution failure with context
		if requestID != "" {
			fmt.Fprintf(os.Stderr, "[%s] ERROR: kcli stream command creation failed: %v (cluster_id=%s, mode=%s)\n", requestID, err, resolvedID, mode)
		} else {
			fmt.Fprintf(os.Stderr, "ERROR: kcli stream command creation failed: %v (cluster_id=%s, mode=%s)\n", err, resolvedID, mode)
		}
		metrics.KCLIErrorsTotal.WithLabelValues("stream_creation_failed").Inc()
		metrics.KCLIStreamConnectionsActive.WithLabelValues(mode).Dec() // Decrement since we're not creating a connection
		audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "failure", err.Error(), -1, time.Since(start))
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: err.Error()})
		return
	}

	// Start with a default PTY size so the shell reads correct dimensions on init.
	// The frontend will immediately send a resize event with the actual terminal dimensions.
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: execDefaultCols, Rows: execDefaultRows})
	if err != nil {
		audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "failure", err.Error(), -1, time.Since(start))
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: "failed to start kcli stream: " + err.Error()})
		return
	}
	defer func() {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	outChan := make(chan wsOutMessage, 256)
	execDone := make(chan struct{})
	writerDone := make(chan struct{})
	var once sync.Once
	closeExecDone := func() { once.Do(func() { close(execDone) }) }

	defer func() {
		// Cancel context FIRST so all goroutines see ctx.Done() before outChan is closed.
		// This prevents send-on-closed-channel panics in the cmd.Wait goroutine.
		cancel()
		closeExecDone()
		select {
		case <-execDone:
		case <-time.After(3 * time.Second):
		}
		time.Sleep(execDrainWait)
		close(outChan)
		<-writerDone
	}()

	conn.SetReadLimit(execReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(execPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(execPongWait))
	})

	go func() {
		defer close(writerDone)
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
	go func() {
		defer closeExecDone()
		_, _ = io.Copy(stdoutW, ptmx)
	}()

	go func() {
		err := cmd.Wait()
		if err != nil && ctx.Err() == nil {
			audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "failure", err.Error(), -1, time.Since(start))
			select {
			case outChan <- wsOutMessage{T: wsMsgError, D: "kcli stream exited: " + err.Error()}:
			case <-ctx.Done():
			}
		} else {
			audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "success", "exited", 0, time.Since(start))
		}
		closeExecDone()
		// Use ctx.Done() to avoid send-on-closed-channel panic: the deferred cleanup
		// cancels ctx before closing outChan, so this select exits safely.
		select {
		case outChan <- wsOutMessage{T: wsMsgExit}:
		case <-ctx.Done():
		}
	}()

	// PTY size already set at start via StartWithSize.
	// The frontend sends a resize message immediately after connect with actual dimensions.

	firstStdinLogged := false
	for {
		_ = conn.SetReadDeadline(time.Now().Add(execPongWait))
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
				if !firstStdinLogged {
					firstStdinLogged = true
					log.Printf(
						"kcli stream: first stdin received requestedCluster=%s resolvedCluster=%s mode=%s",
						clusterID,
						resolvedID,
						mode,
					)
				}
				dec, err := base64.StdEncoding.DecodeString(msg.D)
				if err == nil && len(dec) > 0 {
					_, _ = ptmx.Write(dec)
				}
			}
		case wsMsgResize:
			if msg.R != nil && msg.R.Rows > 0 && msg.R.Cols > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: msg.R.Cols, Rows: msg.R.Rows})
			}
		}
	}
}

func (h *Handler) makeKCLIStreamCommand(ctx context.Context, clusterContext, kubeconfigPath, mode, namespace string) (*exec.Cmd, error) {
	env := append(os.Environ(),
		"KUBECONFIG="+kubeconfigPath,
		// Ensure terminal detection for color support
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)
	// Add AI backend env vars for kcli AI commands
	env = append(env, h.buildKCLIAIEnvVars()...)
	workDir := "/tmp"
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		workDir = home
	}

	// Shell mode: launch an interactive bash/sh session with kcli available.
	// Use kcli as the primary kubectl-compatible CLI and alias common tools to it.
	kcliBin, kcliErr := resolveKCLIBinary()

	sh := "/bin/bash"
	if _, err := exec.LookPath("bash"); err != nil {
		sh = "/bin/sh"
	}

	ctxArg := strings.ReplaceAll(clusterContext, "'", "'\"'\"'")
	var sb strings.Builder

	// Suppress macOS bash deprecation warning
	sb.WriteString("export BASH_SILENCE_DEPRECATION_WARNING=1\n")

	if kcliErr == nil {
		// kcli is available — set up a rich kcli-powered shell
		sb.WriteString("export KCLI_BIN='" + strings.ReplaceAll(kcliBin, "'", "'\"'\"'") + "'\n")

		if sh == "/bin/bash" {
			sb.WriteString("source <(\"$KCLI_BIN\" completion bash 2>/dev/null) 2>/dev/null\n")
			sb.WriteString("source <(kubectl completion bash 2>/dev/null) 2>/dev/null\n")
		}

		// Alias all common tools to kcli
		sb.WriteString("alias k='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kubectl='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kcli='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kubectx='\"$KCLI_BIN\" ctx'\n")
		sb.WriteString("alias kubens='\"$KCLI_BIN\" ns'\n")
		sb.WriteString("alias k9s='\"$KCLI_BIN\" ui'\n")

		// Set Kubernetes context
		if clusterContext != "" {
			sb.WriteString("\"$KCLI_BIN\" ctx '" + ctxArg + "' 2>/dev/null || kubectl config use-context '" + ctxArg + "' 2>/dev/null\n")
		}

		// Set namespace if provided
		if namespace != "" && namespace != "all" {
			nsArg := strings.ReplaceAll(namespace, "'", "'\"'\"'")
			sb.WriteString("\"$KCLI_BIN\" ns '" + nsArg + "' 2>/dev/null || kubectl config set-context --current --namespace='" + nsArg + "' 2>/dev/null\n")
		}

		// Custom PS1 prompt showing kcli context/namespace
		sb.WriteString("eval \"$(\\\"$KCLI_BIN\\\" prompt 2>/dev/null)\" 2>/dev/null || export PS1='\\[\\033[1;32m\\][kcli: $(\"$KCLI_BIN\" kubeconfig current-context 2>/dev/null)]\\[\\033[0m\\] \\$ '\n")
	} else {
		// kcli not available — fall back to plain kubectl shell
		if sh == "/bin/bash" {
			sb.WriteString("source <(kubectl completion bash 2>/dev/null) 2>/dev/null\n")
		}
		if clusterContext != "" {
			sb.WriteString("kubectl config use-context '" + ctxArg + "' 2>/dev/null\n")
		}
		if namespace != "" && namespace != "all" {
			nsArg := strings.ReplaceAll(namespace, "'", "'\"'\"'")
			sb.WriteString("kubectl config set-context --current --namespace='" + nsArg + "' 2>/dev/null\n")
		}
		sb.WriteString("export PS1='\\[\\033[1;33m\\][kubectl]\\[\\033[0m\\] \\$ '\n")
	}

	// Write init commands to a temp rcfile so bash --rcfile sources them
	// in the interactive shell itself (preserving aliases, PS1, completions).
	rcfile := fmt.Sprintf("/tmp/kubilitics-kcli-%d.rc", time.Now().UnixNano())
	if err := os.WriteFile(rcfile, []byte(sb.String()), 0600); err != nil {
		return nil, fmt.Errorf("failed to write rcfile: %w", err)
	}

	var cmd *exec.Cmd
	if sh == "/bin/bash" {
		cmd = exec.CommandContext(ctx, sh, "--rcfile", rcfile)
	} else {
		env = append(env, "ENV="+rcfile)
		cmd = exec.CommandContext(ctx, sh, "-i")
	}
	cmd.Env = env
	cmd.Dir = workDir
	return cmd, nil
}
