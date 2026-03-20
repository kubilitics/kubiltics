package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

const kcliExecTimeout = 90 * time.Second
const confirmDestructiveHeader = "X-Confirm-Destructive"

// PostKCLIExec handles POST /clusters/{clusterId}/kcli/exec
// Body: {"args":["get","pods","-A"],"force":false}
func (h *Handler) PostKCLIExec(w http.ResponseWriter, r *http.Request) {
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
	if !h.allowKCLIRate(resolvedID, "exec") {
		respondError(w, http.StatusTooManyRequests, "kcli exec rate limit exceeded")
		return
	}

	var req struct {
		Args  []string `json:"args"`
		Force bool     `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(req.Args) == 0 {
		respondError(w, http.StatusBadRequest, "args are required")
		return
	}
	args, mutating, err := validateKCLIArgs(req.Args, req.Force)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if mutating && strings.TrimSpace(r.Header.Get(confirmDestructiveHeader)) == "" {
		respondError(w, http.StatusBadRequest, "mutating kcli commands require X-Confirm-Destructive header")
		return
	}

	resolveStart := time.Now()
	kcliBin, err := resolveKCLIBinary()
	resolveDuration := time.Since(resolveStart)
	metrics.KCLIBinaryResolutionDurationSeconds.Observe(resolveDuration.Seconds())
	
	if err != nil {
		// Log binary resolution failure with context
		if requestID != "" {
			fmt.Fprintf(os.Stderr, "[%s] ERROR: kcli binary resolution failed: %v (cluster_id=%s)\n", requestID, err, resolvedID)
		} else {
			fmt.Fprintf(os.Stderr, "ERROR: kcli binary resolution failed: %v (cluster_id=%s)\n", err, resolvedID)
		}
		metrics.KCLIErrorsTotal.WithLabelValues("binary_not_found").Inc()
		respondError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	// Log successful binary resolution (debug level)
	if requestID != "" {
		fmt.Fprintf(os.Stderr, "[%s] DEBUG: kcli binary resolved: path=%s (cluster_id=%s)\n", requestID, kcliBin, resolvedID)
	}

	args = append([]string{}, args...)
	if cluster.Context != "" && !hasFlag(args, "--context") {
		args = append([]string{"--context", cluster.Context}, args...)
	}
	if req.Force && !hasFlag(args, "--force") {
		args = append([]string{"--force"}, args...)
	}

	ctx, cancel := context.WithTimeout(r.Context(), kcliExecTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, kcliBin, args...)
	env := append(os.Environ(), "KUBECONFIG="+cluster.KubeconfigPath)
	env = append(env, h.buildKCLIAIEnvVars()...)
	cmd.Env = env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	duration := time.Since(start)
	exitCode := 0
	auditCommand := renderAuditCommand(args)
	commandType := "unknown"
	if len(args) > 0 {
		commandType = args[0]
	}
	
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			metrics.KCLIExecTotal.WithLabelValues(commandType, "timeout").Inc()
			metrics.KCLIExecDurationSeconds.WithLabelValues(commandType).Observe(duration.Seconds())
			metrics.KCLIErrorsTotal.WithLabelValues("timeout").Inc()
			audit.LogCommand(requestID, resolvedID, "kcli_exec", auditCommand, "failure", "timeout", 124, duration)
			respondError(w, http.StatusGatewayTimeout, "kcli command timed out")
			return
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			metrics.KCLIExecTotal.WithLabelValues(commandType, "failure").Inc()
			metrics.KCLIExecDurationSeconds.WithLabelValues(commandType).Observe(duration.Seconds())
			metrics.KCLIErrorsTotal.WithLabelValues("execution_failed").Inc()
			audit.LogCommand(requestID, resolvedID, "kcli_exec", auditCommand, "failure", err.Error(), -1, duration)
			respondError(w, http.StatusInternalServerError, "Failed to run kcli: "+err.Error())
			return
		}
	}
	outcome := "success"
	msg := ""
	if exitCode != 0 {
		outcome = "failure"
		msg = "non-zero exit"
		metrics.KCLIExecTotal.WithLabelValues(commandType, "failure").Inc()
	} else {
		metrics.KCLIExecTotal.WithLabelValues(commandType, "success").Inc()
	}
	metrics.KCLIExecDurationSeconds.WithLabelValues(commandType).Observe(duration.Seconds())
	audit.LogCommand(requestID, resolvedID, "kcli_exec", auditCommand, outcome, msg, exitCode, duration)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"stdout":   stdout.String(),
		"stderr":   stderr.String(),
		"exitCode": exitCode,
	})
}

func resolveKCLIBinary() (string, error) {
	var checkedPaths []string
	
	// Check 1: KCLI_BIN environment variable
	if v := strings.TrimSpace(os.Getenv("KCLI_BIN")); v != "" {
		checkedPaths = append(checkedPaths, fmt.Sprintf("KCLI_BIN=%s", v))
		if st, err := os.Stat(v); err == nil && !st.IsDir() {
			return v, nil
		}
		return "", fmt.Errorf("kcli binary not found: KCLI_BIN is set to %q but file does not exist or is not executable. Please verify the path is correct and the file has execute permissions.", v)
	}
	
	// Check 2: System PATH
	if path, err := exec.LookPath("kcli"); err == nil {
		return path, nil
	}
	checkedPaths = append(checkedPaths, "system PATH")
	
	// Check 3: Relative path (development)
	cwd, err := os.Getwd()
	if err == nil {
		cand := filepath.Clean(filepath.Join(cwd, "..", "kcli", "bin", "kcli"))
		checkedPaths = append(checkedPaths, fmt.Sprintf("relative path: %s", cand))
		if st, serr := os.Stat(cand); serr == nil && !st.IsDir() {
			return cand, nil
		}
	}
	
	// Build detailed error message
	var errMsg strings.Builder
	errMsg.WriteString("kcli binary not found. ")
	errMsg.WriteString("Searched locations:\n")
	for _, p := range checkedPaths {
		errMsg.WriteString(fmt.Sprintf("  - %s\n", p))
	}
	errMsg.WriteString("\nTo fix this issue:\n")
	errMsg.WriteString("  1. Install kcli: https://github.com/vellankikoti/kcli#installation\n")
	errMsg.WriteString("  2. Set KCLI_BIN environment variable to the full path of the kcli binary\n")
	errMsg.WriteString("  3. Build kcli from source: cd kcli && go build -o bin/kcli ./cmd/kcli\n")
	errMsg.WriteString("  4. For Docker deployments: ensure kcli is included in the container image\n")
	errMsg.WriteString("\nSee documentation: https://github.com/kubilitics/kubilitics-os-emergent/docs/DEPLOYMENT_KCLI.md")
	
	return "", fmt.Errorf("%s", errMsg.String())
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag || strings.HasPrefix(a, flag+"=") {
			return true
		}
	}
	return false
}

// buildKCLIAIEnvVars builds environment variables for kcli AI integration
func (h *Handler) buildKCLIAIEnvVars() []string {
	var env []string
	if h.cfg == nil {
		return env
	}
	aiURL := strings.TrimSpace(h.cfg.AIBackendURL)
	if aiURL == "" {
		aiURL = "http://localhost:8081"
	}
	// Set AI endpoint for kcli to use AI backend
	env = append(env, "KCLI_AI_ENDPOINT="+aiURL)
	// Set provider to use OpenAI-compatible API (AI backend provides OpenAI-compatible endpoint)
	env = append(env, "KCLI_AI_PROVIDER=openai")
	return env
}
