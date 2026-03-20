package rest

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

var (
	kcliCommands = []string{
		"get", "describe", "apply", "delete", "logs", "exec", "port-forward", "top", "rollout", "diff", "explain", "wait", "scale", "patch", "label", "annotate",
		"auth", "ctx", "ns", "search", "plugin", "metrics", "restarts", "instability", "events", "incident", "ui", "ai", "why", "summarize", "suggest", "completion",
	}
)

// GetKCLIComplete handles GET /clusters/{clusterId}/kcli/complete?line=...
// Returns JSON: { "completions": ["..."] }.
func (h *Handler) GetKCLIComplete(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	metrics.KCLICompletionRequestsTotal.Inc()
	defer func() {
		metrics.KCLICompletionDurationSeconds.Observe(time.Since(start).Seconds())
	}()
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
	if !h.allowKCLIRate(resolvedID, "complete") {
		respondError(w, http.StatusTooManyRequests, "kcli completion rate limit exceeded")
		return
	}

	line := r.URL.Query().Get("line")
	if strings.TrimSpace(line) == "" {
		logCompletionDebug("kcli", resolvedID, line, "empty", 0, time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": []string{}})
		return
	}

	words := completionWords(line)
	if len(words) == 0 {
		logCompletionDebug("kcli", resolvedID, line, "parse-empty", 0, time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": []string{}})
		return
	}

	trimmed := make([]string, len(words))
	copy(trimmed, words)
	for len(trimmed) > 0 && strings.ToLower(strings.TrimSpace(trimmed[0])) == "kcli" {
		trimmed = trimmed[1:]
	}

	// Live cluster-aware completion for kcli kubectl-parity verbs.
	if len(trimmed) > 0 {
		verb := strings.ToLower(strings.TrimSpace(trimmed[0]))
		switch verb {
		case "get", "describe", "logs", "exec":
			if comp := contextAwareCompletions(r.Context(), h.clusterService, resolvedID, strings.Join(trimmed, " "), trimmed); len(comp) > 0 {
				logCompletionDebug("kcli", resolvedID, line, "context-aware", len(comp), time.Since(start))
				respondJSON(w, http.StatusOK, map[string]interface{}{"completions": comp})
				return
			}
		}
	}
	if comp := fileFlagCompletions(trimmed); len(comp) > 0 {
		logCompletionDebug("kcli", resolvedID, line, "file-path", len(comp), time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": comp})
		return
	}

	kcliBin, err := resolveKCLIBinary()
	if err != nil {
		completions := ensureKCLIFirst(words, kcliStaticCompletions(words))
		logCompletionDebug("kcli", resolvedID, line, "static-fallback", len(completions), time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": completions})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	args := []string{"__complete"}
	if cluster.Context != "" {
		args = append(args, "--context", cluster.Context)
	}
	args = append(args, words...)
	cmd := exec.CommandContext(ctx, kcliBin, args...)
	cmd.Env = append(os.Environ(), "KUBECONFIG="+cluster.KubeconfigPath)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		completions := ensureKCLIFirst(words, kcliStaticCompletions(words))
		logCompletionDebug("kcli", resolvedID, line, "static-fallback", len(completions), time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": completions})
		return
	}

	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	completions := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" || strings.HasPrefix(l, ":") {
			continue
		}
		completions = append(completions, l)
	}
	if len(completions) == 0 {
		completions = kcliStaticCompletions(words)
		logCompletionDebug("kcli", resolvedID, line, "complete-empty-static", len(completions), time.Since(start))
	} else {
		logCompletionDebug("kcli", resolvedID, line, "__complete", len(completions), time.Since(start))
	}
	completions = ensureKCLIFirst(words, completions)
	respondJSON(w, http.StatusOK, map[string]interface{}{"completions": completions})
}

func isPrefixOfKCLI(words []string) bool {
	if len(words) == 0 {
		return false
	}
	first := strings.ToLower(strings.TrimSpace(words[0]))
	return first != "" && first != "kcli" && strings.HasPrefix("kcli", first)
}

func ensureKCLIFirst(words []string, completions []string) []string {
	if !isPrefixOfKCLI(words) {
		return completions
	}
	out := make([]string, 0, len(completions)+1)
	out = append(out, "kcli")
	for _, c := range completions {
		if strings.ToLower(strings.TrimSpace(c)) != "kcli" {
			out = append(out, c)
		}
	}
	return out
}

func kcliStaticCompletions(words []string) []string {
	if len(words) == 0 {
		return kcliCommands
	}
	if len(words) == 1 {
		first := strings.TrimSpace(words[0])
		if first != "" && strings.HasPrefix(strings.ToLower("kcli"), strings.ToLower(first)) {
			return []string{"kcli"}
		}
		return filterByPrefix(kcliCommands, words[0])
	}

	trimmed := make([]string, len(words))
	copy(trimmed, words)
	for len(trimmed) > 0 && strings.ToLower(strings.TrimSpace(trimmed[0])) == "kcli" {
		trimmed = trimmed[1:]
	}
	if len(trimmed) == 0 {
		return kcliCommands
	}
	verb := strings.ToLower(strings.TrimSpace(trimmed[0]))
	last := trimmed[len(trimmed)-1]
	switch verb {
	case "get", "describe", "logs", "exec", "top":
		return filterByPrefix(kubectlResources, last)
	case "ctx":
		if len(trimmed) == 2 && strings.TrimSpace(trimmed[1]) == "group" {
			return []string{"set", "add", "rm", "ls", "export", "import"}
		}
	}
	return filterByPrefix(kcliCommands, last)
}
