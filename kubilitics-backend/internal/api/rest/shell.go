package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

const shellTimeout = 60 * time.Second

// blockedShellVerbs: mutating/dangerous kubectl/kcli verbs not allowed in the web shell (user must use UI or direct kubectl).
var blockedShellVerbs = map[string]bool{
	"delete": true, "apply": true, "edit": true, "patch": true, "replace": true,
	"create": true, "run": true, "drain": true, "taint": true, "set": true,
	"expose": true, "rollout": true, "scale": true, "autoscale": true,
	"label": true, "annotate": true, "exec": true,
	"ui": true, "fix": true,
}

// PostShell handles POST /clusters/{clusterId}/shell
// Body: {"command": "get pods"} or "get pods -n default". Runs kcli (kubectl wrapper) with cluster's kubeconfig and returns stdout/stderr.
func (h *Handler) PostShell(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	var req struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	cmdStr := strings.TrimSpace(req.Command)
	// Strip leading "kubectl" or "kcli" (case-insensitive) so "kubectl get po", "kcli get po" and "get po" all work
	for {
		trimmed := strings.TrimSpace(cmdStr)
		if len(trimmed) >= 7 && strings.EqualFold(trimmed[:7], "kubectl") {
			after := trimmed[7:]
			if len(after) == 0 || after[0] == ' ' || after[0] == '\t' {
				cmdStr = strings.TrimSpace(after)
				continue
			}
		}
		if len(trimmed) >= 4 && strings.EqualFold(trimmed[:4], "kcli") {
			after := trimmed[4:]
			if len(after) == 0 || after[0] == ' ' || after[0] == '\t' {
				cmdStr = strings.TrimSpace(after)
				continue
			}
		}
		break
	}
	cmdStr = strings.TrimSpace(cmdStr)

	cluster, err := h.clusterService.GetCluster(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	if cluster.KubeconfigPath == "" {
		respondError(w, http.StatusBadRequest, "Cluster has no kubeconfig path")
		return
	}

	// Bare "kcli"/"kubectl" or empty: run version so the shell always returns something useful
	if cmdStr == "" {
		ctx, cancel := context.WithTimeout(r.Context(), shellTimeout)
		defer cancel()
		args := []string{"version"}
		if cluster.Context != "" {
			args = append([]string{"--context", cluster.Context}, args...)
		}
		cmd := exec.CommandContext(ctx, "kcli", args...)
		cmd.Env = append(cmd.Env, "KUBECONFIG="+cluster.KubeconfigPath)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		_ = cmd.Run()
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"stdout":   stdout.String(),
			"stderr":   stderr.String(),
			"exitCode": 0,
		})
		return
	}

	parts := splitCommand(cmdStr)
	if len(parts) == 0 {
		respondError(w, http.StatusBadRequest, "Invalid command")
		return
	}
	// Strip any remaining leading "kubectl" or "kcli" from parsed parts (e.g. "kubectl get po" -> ["get", "po"])
	for len(parts) > 0 {
		lower := strings.ToLower(strings.TrimSpace(parts[0]))
		if lower == "kubectl" || lower == "kcli" {
			parts = parts[1:]
			continue
		}
		break
	}
	if len(parts) == 0 {
		respondError(w, http.StatusBadRequest, "Invalid command")
		return
	}
	verb := strings.ToLower(strings.TrimSpace(parts[0]))
	if blockedShellVerbs[verb] {
		respondError(w, http.StatusBadRequest, "Command not allowed. Use read-only commands (get, describe, logs, top, version, etc.). For mutating actions use the UI or a local terminal.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), shellTimeout)
	defer cancel()

	args := parts
	if cluster.Context != "" {
		args = append([]string{"--context", cluster.Context}, parts...)
	}
	cmd := exec.CommandContext(ctx, "kcli", args...)
	cmd.Env = append(cmd.Env, "KUBECONFIG="+cluster.KubeconfigPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Command timed out (60s). Try a more specific query or use -n namespace.")
			return
		} else {
			respondError(w, http.StatusInternalServerError, "Failed to run command: "+err.Error())
			return
		}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"stdout":   stdout.String(),
		"stderr":   stderr.String(),
		"exitCode": exitCode,
	})
}

func splitCommand(s string) []string {
	var parts []string
	for {
		s = strings.TrimSpace(s)
		if s == "" {
			break
		}
		if s[0] == '"' || s[0] == '\'' {
			quote := s[0]
			end := strings.IndexByte(s[1:], quote)
			if end == -1 {
				parts = append(parts, s[1:])
				break
			}
			parts = append(parts, s[1:end+1])
			s = s[end+2:]
			continue
		}
		i := strings.IndexAny(s, " \t")
		if i == -1 {
			parts = append(parts, s)
			break
		}
		parts = append(parts, s[:i])
		s = s[i:]
	}
	return parts
}
