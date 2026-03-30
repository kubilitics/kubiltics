package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
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
	defer func() { _ = conn.Close() }()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	sendErr := func(msg string) {
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: msg})
	}

	shell := "/bin/bash"
	if _, err := exec.LookPath("bash"); err != nil {
		shell = "/bin/sh"
	}
	env := append(os.Environ(),
		"KUBECONFIG="+cluster.KubeconfigPath,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)
	workDir := "/tmp"
	if d, err := os.UserHomeDir(); err == nil && d != "" {
		workDir = d
	}
	// Resolve kcli binary using the shared resolver (checks KCLI_BIN env, PATH, common locations).
	// If kcli is not available, gracefully fall back to plain kubectl — the shell must always start.
	kcliBin, kcliErr := resolveKCLIBinary()

	ctxArg := strings.ReplaceAll(cluster.Context, "'", "'\"'\"'")
	var sb strings.Builder

	// Suppress macOS bash deprecation warning
	sb.WriteString("export BASH_SILENCE_DEPRECATION_WARNING=1\n")

	if kcliErr == nil {
		// kcli is available — set up a rich kcli-powered shell with aliases and completion
		sb.WriteString("export KCLI_BIN='" + strings.ReplaceAll(kcliBin, "'", "'\"'\"'") + "'\n")

		if shell == "/bin/bash" {
			sb.WriteString("source <(\"$KCLI_BIN\" completion bash 2>/dev/null) 2>/dev/null\n")
			sb.WriteString("source <(kubectl completion bash 2>/dev/null) 2>/dev/null\n")
		}

		// Alias common tools to kcli
		sb.WriteString("alias k='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kubectl='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kcli='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kcl='\"$KCLI_BIN\"'\n")
		sb.WriteString("alias kubectx='\"$KCLI_BIN\" ctx'\n")
		sb.WriteString("alias kubens='\"$KCLI_BIN\" ns'\n")
		sb.WriteString("alias k9s='\"$KCLI_BIN\" ui'\n")

		// Set Kubernetes context
		if cluster.Context != "" {
			sb.WriteString("\"$KCLI_BIN\" ctx '" + ctxArg + "' 2>/dev/null || kubectl config use-context '" + ctxArg + "' 2>/dev/null\n")
		}

		// Custom PS1 prompt showing kcli context
		sb.WriteString("eval \"$(\\\"$KCLI_BIN\\\" prompt 2>/dev/null)\" 2>/dev/null || export PS1='\\[\\033[1;32m\\][kcli: $(\"$KCLI_BIN\" kubeconfig current-context 2>/dev/null)]\\[\\033[0m\\] \\$ '\n")
	} else {
		// kcli not available — fall back to plain kubectl shell (never block the session)
		log.Printf("Terminal: kcli not available (%v), falling back to kubectl for cluster %s", kcliErr, clusterID)
		if shell == "/bin/bash" {
			sb.WriteString("source <(kubectl completion bash 2>/dev/null) 2>/dev/null\n")
		}
		if cluster.Context != "" {
			sb.WriteString("kubectl config use-context '" + ctxArg + "' 2>/dev/null\n")
		}
		sb.WriteString("export PS1='\\[\\033[1;33m\\][kubectl]\\[\\033[0m\\] \\$ '\n")
	}

	// Write init commands to a temp rcfile so bash --rcfile sources them
	// in the interactive shell itself (not a parent that gets replaced).
	// This preserves aliases, PS1, and completions across the session.
	tmpFile, tmpErr := os.CreateTemp("", "kubilitics-shell-*.rc")
	if tmpErr != nil {
		log.Printf("Terminal: failed to create temp rcfile: %v", tmpErr)
		sendErr("Failed to start shell")
		return
	}
	rcfile := tmpFile.Name()
	defer func() { _ = os.Remove(rcfile) }()
	if _, err := tmpFile.Write([]byte(sb.String())); err != nil {
		_ = tmpFile.Close()
		log.Printf("Terminal: failed to write rcfile: %v", err)
		sendErr("Failed to start shell")
		return
	}
	_ = tmpFile.Close()

	var cmd *exec.Cmd
	if shell == "/bin/bash" {
		cmd = exec.CommandContext(ctx, shell, "--rcfile", rcfile)
	} else {
		// /bin/sh doesn't support --rcfile; use ENV variable
		env = append(env, "ENV="+rcfile)
		cmd = exec.CommandContext(ctx, shell, "-i")
	}
	cmd.Env = env
	cmd.Dir = workDir

	// Start with a default PTY size so the shell reads correct dimensions on init.
	// The frontend will immediately send a resize event with the actual terminal dimensions.
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 80, Rows: 24})
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
			_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
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

	// PTY size already set at start via StartWithSize.
	// The frontend sends a resize message immediately after connect with actual dimensions.

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
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
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
		_ = conn.SetReadDeadline(time.Now().Add(readDeadline))
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
