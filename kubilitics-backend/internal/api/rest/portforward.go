package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// ─── Session Store ────────────────────────────────────────────────────────────

// portForwardSession tracks a running kubectl port-forward subprocess.
type portForwardSession struct {
	cancel  context.CancelFunc
	cmd     *exec.Cmd
	mu      sync.Mutex
	stopped bool
}

func (s *portForwardSession) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	s.stopped = true
	s.cancel()
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
}

// pfMu protects pfByCluster.
// Structure: clusterID → sessionID → *portForwardSession
var (
	pfMu        sync.Mutex
	pfByCluster = make(map[string]map[string]*portForwardSession)
)

func pfStore(clusterID, sessionID string, sess *portForwardSession) {
	pfMu.Lock()
	defer pfMu.Unlock()
	if pfByCluster[clusterID] == nil {
		pfByCluster[clusterID] = make(map[string]*portForwardSession)
	}
	pfByCluster[clusterID][sessionID] = sess
}

func pfDelete(clusterID, sessionID string) {
	pfMu.Lock()
	defer pfMu.Unlock()
	if m, ok := pfByCluster[clusterID]; ok {
		delete(m, sessionID)
	}
}

func pfLookup(clusterID, sessionID string) (*portForwardSession, bool) {
	pfMu.Lock()
	defer pfMu.Unlock()
	if m, ok := pfByCluster[clusterID]; ok {
		sess, found := m[sessionID]
		return sess, found
	}
	return nil, false
}

// ─── Request / Response types ─────────────────────────────────────────────────

type portForwardStartReq struct {
	ResourceType string `json:"resourceType"` // "pod" or "service"
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	LocalPort    int    `json:"localPort"`
	RemotePort   int    `json:"remotePort"`
}

type portForwardStartResp struct {
	SessionID string `json:"sessionId"`
	LocalPort int    `json:"localPort"`
	Status    string `json:"status"`
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// PostPortForward starts a real kubectl port-forward subprocess.
// POST /api/v1/clusters/{clusterId}/port-forward
func (h *Handler) PostPortForward(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	rawID := vars["clusterId"]
	if !validate.ClusterID(rawID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	clusterID, err := h.resolveClusterID(r.Context(), rawID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Cluster not found: "+err.Error())
		return
	}

	var req portForwardStartReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}
	if req.Name == "" || req.Namespace == "" || req.LocalPort <= 0 || req.RemotePort <= 0 {
		respondError(w, http.StatusBadRequest, "name, namespace, localPort and remotePort are required")
		return
	}

	// Kubernetes target: "pod/name" or "svc/name"
	target := "pod/" + req.Name
	if req.ResourceType == "service" {
		target = "svc/" + req.Name
	}

	cluster, err := h.clusterService.GetCluster(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Cluster not found: "+err.Error())
		return
	}

	// Build: kubectl port-forward <target> <local>:<remote> -n <ns> --context <ctx>
	portMap := fmt.Sprintf("%d:%d", req.LocalPort, req.RemotePort)
	args := []string{"port-forward", target, portMap, "-n", req.Namespace}
	if cluster.Context != "" {
		args = append(args, "--context", cluster.Context)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "kubectl", args...)

	// Inherit a minimal, clean environment; inject KUBECONFIG for cluster access.
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
	}
	if cluster.KubeconfigPath != "" {
		cmd.Env = append(cmd.Env, "KUBECONFIG="+cluster.KubeconfigPath)
	}

	// Capture stderr so we can surface kubectl errors in the response.
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		cancel()
		log.Printf("[port-forward] failed to start kubectl: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to start port-forward: "+err.Error())
		return
	}

	// Monitor for early process exit while we probe the port.
	procExited := make(chan error, 1)
	go func() {
		procExited <- cmd.Wait()
	}()

	// Wait up to 2s (10 attempts × 200ms) for the local port to become reachable.
	addr := fmt.Sprintf("localhost:%d", req.LocalPort)
	var portReady bool
	for i := 0; i < 10; i++ {
		// If the process already exited, no point retrying.
		select {
		case exitErr := <-procExited:
			stderrMsg := stderrBuf.String()
			cancel()
			errMsg := fmt.Sprintf("kubectl port-forward exited prematurely: %v", exitErr)
			if stderrMsg != "" {
				errMsg += "; stderr: " + stderrMsg
			}
			log.Printf("[port-forward] %s", errMsg)
			respondError(w, http.StatusInternalServerError, errMsg)
			return
		default:
		}

		conn, dialErr := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if dialErr == nil {
			_ = conn.Close()
			portReady = true
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	if !portReady {
		// Port never opened — kill the subprocess and return an error.
		stderrMsg := stderrBuf.String()
		cancel()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		// Drain the wait goroutine.
		<-procExited
		errMsg := fmt.Sprintf("port-forward: local port %d did not open within 2s", req.LocalPort)
		if stderrMsg != "" {
			errMsg += "; stderr: " + stderrMsg
		}
		log.Printf("[port-forward] %s", errMsg)
		respondError(w, http.StatusInternalServerError, errMsg)
		return
	}

	sessionID := uuid.New().String()
	sess := &portForwardSession{cancel: cancel, cmd: cmd}
	pfStore(clusterID, sessionID, sess)

	// Reap subprocess in background; remove session when the process exits naturally.
	go func() {
		<-procExited
		pfDelete(clusterID, sessionID)
	}()

	log.Printf("[port-forward] started: session=%s target=%s %s ns=%s", sessionID, target, portMap, req.Namespace)
	respondJSON(w, http.StatusOK, portForwardStartResp{
		SessionID: sessionID,
		LocalPort: req.LocalPort,
		Status:    "active",
	})
}

// DeletePortForward stops a running port-forward session.
// DELETE /api/v1/clusters/{clusterId}/port-forward/{sessionId}
func (h *Handler) DeletePortForward(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	rawID := vars["clusterId"]
	sessionID := vars["sessionId"]

	clusterID, err := h.resolveClusterID(r.Context(), rawID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Cluster not found: "+err.Error())
		return
	}

	sess, found := pfLookup(clusterID, sessionID)
	if !found {
		respondError(w, http.StatusNotFound, "Session not found or already stopped")
		return
	}

	pfDelete(clusterID, sessionID)
	sess.stop()

	log.Printf("[port-forward] stopped: session=%s", sessionID)
	respondJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}
