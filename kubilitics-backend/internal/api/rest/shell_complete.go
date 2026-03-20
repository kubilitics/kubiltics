package rest

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Static kubectl verbs and resource short names for fallback when __complete is not available.
// Verbs include read-only and mutating so Tab suggests every command when __complete fails.
var (
	kubectlVerbs = []string{
		"get", "describe", "logs", "top", "version", "api-resources", "api-versions", "explain", "cluster-info", "config", "auth",
		"delete", "apply", "edit", "patch", "replace", "create", "run", "drain", "taint", "set", "expose", "rollout", "scale", "autoscale", "label", "annotate", "exec",
	}
	// Order short names (no, po, ns) before long (node, nodes) so Tab completes to the short form first when typing "no"
	kubectlResources = []string{"pods", "pod", "po", "deployments", "deployment", "deploy", "replicasets", "rs", "services", "service", "svc", "configmaps", "configmap", "cm", "secrets", "secret", "namespaces", "namespace", "ns", "nodes", "node", "no", "events", "event", "ev", "ingresses", "ingress", "ing", "daemonsets", "ds", "statefulsets", "sts", "jobs", "job", "cronjobs", "cj"}
)

const fileCompletionMaxResults = 200

var (
	completionDebugOnce    sync.Once
	completionDebugEnabled bool
)

func isCompletionDebugEnabled() bool {
	completionDebugOnce.Do(func() {
		v := strings.ToLower(strings.TrimSpace(os.Getenv("KUBILITICS_SHELL_COMPLETION_DEBUG")))
		completionDebugEnabled = v == "1" || v == "true" || v == "yes" || v == "on"
	})
	return completionDebugEnabled
}

func logCompletionDebug(kind, clusterID, line, source string, count int, dur time.Duration) {
	if !isCompletionDebugEnabled() {
		return
	}
	log.Printf(
		"completion debug: kind=%s cluster=%s source=%s count=%d duration_ms=%d line=%q",
		kind,
		clusterID,
		source,
		count,
		dur.Milliseconds(),
		line,
	)
}

func completionWords(line string) []string {
	words := splitCommand(line)
	if line != "" {
		last := line[len(line)-1]
		if last == ' ' || last == '\t' {
			words = append(words, "")
		}
	}
	return words
}

type fileCompletionTarget struct {
	pathPrefix  string
	tokenPrefix string
}

func fileFlagCompletions(words []string) []string {
	target, ok := detectFileCompletionTarget(words)
	if !ok {
		return nil
	}
	pathPrefix := target.pathPrefix
	dir := "."
	base := pathPrefix
	if pathPrefix != "" {
		if strings.HasSuffix(pathPrefix, "/") || strings.HasSuffix(pathPrefix, string(filepath.Separator)) {
			dir = pathPrefix
			base = ""
		} else {
			dir = filepath.Dir(pathPrefix)
			base = filepath.Base(pathPrefix)
		}
	}
	if dir == "" {
		dir = "."
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if base != "" && !strings.HasPrefix(strings.ToLower(name), strings.ToLower(base)) {
			continue
		}
		var candidate string
		if dir == "." {
			candidate = name
		} else {
			candidate = filepath.Join(dir, name)
		}
		if entry.IsDir() {
			candidate += "/"
		}
		if target.tokenPrefix != "" {
			candidate = target.tokenPrefix + candidate
		}
		out = append(out, candidate)
	}
	sort.Strings(out)
	if len(out) > fileCompletionMaxResults {
		out = out[:fileCompletionMaxResults]
	}
	return out
}

func detectFileCompletionTarget(words []string) (fileCompletionTarget, bool) {
	w := make([]string, len(words))
	copy(w, words)
	for len(w) > 0 {
		head := strings.ToLower(strings.TrimSpace(w[0]))
		if head == "kubectl" || head == "kcli" {
			w = w[1:]
			continue
		}
		break
	}
	if len(w) < 2 {
		return fileCompletionTarget{}, false
	}

	verb := strings.ToLower(strings.TrimSpace(w[0]))
	switch verb {
	case "apply", "create", "replace", "delete", "patch", "diff":
	default:
		return fileCompletionTarget{}, false
	}

	for i := 1; i < len(w); i++ {
		tok := strings.TrimSpace(w[i])
		switch {
		case tok == "-f" || tok == "--filename" || tok == "-k" || tok == "--kustomize" || tok == "--patch-file":
			if i+1 == len(w)-1 {
				return fileCompletionTarget{pathPrefix: w[len(w)-1]}, true
			}
			i++
		case strings.HasPrefix(tok, "-f") && len(tok) > 2:
			if i == len(w)-1 {
				return fileCompletionTarget{pathPrefix: tok[2:], tokenPrefix: "-f"}, true
			}
		case strings.HasPrefix(tok, "--filename="):
			if i == len(w)-1 {
				return fileCompletionTarget{pathPrefix: strings.TrimPrefix(tok, "--filename="), tokenPrefix: "--filename="}, true
			}
		case strings.HasPrefix(tok, "--kustomize="):
			if i == len(w)-1 {
				return fileCompletionTarget{pathPrefix: strings.TrimPrefix(tok, "--kustomize="), tokenPrefix: "--kustomize="}, true
			}
		case strings.HasPrefix(tok, "--patch-file="):
			if i == len(w)-1 {
				return fileCompletionTarget{pathPrefix: strings.TrimPrefix(tok, "--patch-file="), tokenPrefix: "--patch-file="}, true
			}
		}
	}

	return fileCompletionTarget{}, false
}

// filterByPrefix returns entries that start with prefix (case-insensitive); if prefix is empty, returns all.
// Always returns a non-nil slice so JSON serializes as [] not null.
func filterByPrefix(list []string, prefix string) []string {
	if prefix == "" {
		if list == nil {
			return []string{}
		}
		return list
	}
	lower := strings.ToLower(prefix)
	out := make([]string, 0, len(list))
	for _, s := range list {
		if strings.HasPrefix(strings.ToLower(s), lower) {
			out = append(out, s)
		}
	}
	return out
}

// isPrefixOfKubectl returns true if the first word is a non-empty, incomplete prefix of "kubectl" (e.g. "ku", "kub").
// When true, we put "kubectl" first so the user gets that completion instead of e.g. "kustomize".
func isPrefixOfKubectl(words []string) bool {
	if len(words) == 0 {
		return false
	}
	first := strings.ToLower(strings.TrimSpace(words[0]))
	return first != "" && first != "kubectl" && strings.HasPrefix("kubectl", first)
}

// ensureKubectlFirst: when the user is typing a prefix of "kubectl" (e.g. "ku"), put "kubectl" first
// so they get the expected completion instead of e.g. "kustomize".
func ensureKubectlFirst(words []string, completions []string) []string {
	if !isPrefixOfKubectl(words) || len(completions) == 0 {
		return completions
	}
	out := make([]string, 0, len(completions)+1)
	out = append(out, "kubectl")
	for _, c := range completions {
		if strings.ToLower(c) != "kubectl" {
			out = append(out, c)
		}
	}
	return out
}

// clusterClientGetter is a minimal interface for context-aware completion (avoids circular import).
type clusterClientGetter interface {
	GetClient(id string) (*k8s.Client, error)
}

// resourceTypeToKind maps short names to API kind for ListResources (plural).
var resourceTypeToKind = map[string]string{
	"po": "pods", "pod": "pods", "pods": "pods",
	"deploy": "deployments", "deployment": "deployments", "deployments": "deployments",
	"rs": "replicasets", "replicaset": "replicasets", "replicasets": "replicasets",
	"svc": "services", "service": "services", "services": "services",
	"cm": "configmaps", "configmap": "configmaps", "configmaps": "configmaps",
	"secret": "secrets", "secrets": "secrets",
	"ns": "namespaces", "namespace": "namespaces", "namespaces": "namespaces",
	"no": "nodes", "node": "nodes", "nodes": "nodes",
	"ds": "daemonsets", "daemonset": "daemonsets", "daemonsets": "daemonsets",
	"sts": "statefulsets", "statefulset": "statefulsets", "statefulsets": "statefulsets",
	"job": "jobs", "jobs": "jobs", "cj": "cronjobs", "cronjob": "cronjobs", "cronjobs": "cronjobs",
	"ing": "ingresses", "ingress": "ingresses", "ingresses": "ingresses",
}

// contextAwareCompletions returns live cluster completions: namespace names after -n/--namespace,
// and resource names (e.g. pod names) after "get po" / "get pods". Returns nil to fall back to __complete.
func contextAwareCompletions(ctx context.Context, getClient clusterClientGetter, clusterID, line string, words []string) []string {
	client, err := getClient.GetClient(clusterID)
	if err != nil {
		return nil
	}
	w := make([]string, len(words))
	copy(w, words)
	for len(w) > 0 && strings.ToLower(w[0]) == "kubectl" {
		w = w[1:]
	}
	if len(w) == 0 {
		return nil
	}

	// Completing namespace: "kubectl get po -n a" or "kubectl get po -n " -> list namespaces
	for i := 0; i < len(w); i++ {
		if w[i] != "-n" && w[i] != "--namespace" {
			continue
		}
		// Next token (if any) is the namespace value we're completing
		if i+1 > len(w) {
			return nil
		}
		prefix := ""
		if i+1 == len(w)-1 {
			prefix = strings.TrimSpace(w[len(w)-1])
		} else if i+1 == len(w) {
			// Line ends with " -n " (no value yet): show all namespaces
			prefix = ""
		} else {
			i++ // skip value, continue
			continue
		}
		list, err := client.ListResources(ctx, "namespaces", "", metav1.ListOptions{Limit: 500})
		if err != nil {
			return nil
		}
		var names []string
		for _, item := range list.Items {
			n := item.GetName()
			if prefix == "" || strings.HasPrefix(strings.ToLower(n), strings.ToLower(prefix)) {
				names = append(names, n)
			}
		}
		if len(names) > 0 {
			return names
		}
		return nil
	}

	// Completing resource name: "kubectl get po " or "kubectl get po my-prefix" -> list pod names
	verb := strings.ToLower(w[0])
	if verb != "get" && verb != "describe" && verb != "logs" && verb != "exec" {
		return nil
	}
	if len(w) < 2 {
		return nil
	}
	resourceToken := strings.ToLower(strings.TrimSpace(w[1]))
	kind, ok := resourceTypeToKind[resourceToken]
	if !ok {
		// Try normalized (e.g. "deploy" -> deployments)
		kind = k8s.NormalizeKindToResource(resourceToken)
		if kind == "" {
			return nil
		}
	}
	// We're completing a resource name if: "get po " (line ends with space) or "get po <prefix>"
	namePrefix := ""
	if len(w) >= 3 {
		namePrefix = strings.TrimSpace(w[len(w)-1])
	}
	// If line doesn't end with space and we have 2 words, they're still typing the resource type
	if len(w) == 2 && !strings.HasSuffix(line, " ") {
		return nil
	}
	namespace := "default"
	for i := 0; i < len(w)-1; i++ {
		if (w[i] == "-n" || w[i] == "--namespace") && i+1 < len(w) {
			namespace = w[i+1]
			break
		}
	}
	if kind == "namespaces" || kind == "nodes" {
		namespace = "" // cluster-scoped
	}
	list, err := client.ListResources(ctx, kind, namespace, metav1.ListOptions{Limit: 500})
	if err != nil {
		return nil
	}
	var names []string
	for _, item := range list.Items {
		n := item.GetName()
		if namePrefix == "" || strings.HasPrefix(strings.ToLower(n), strings.ToLower(namePrefix)) {
			names = append(names, n)
		}
	}
	if len(names) > 0 {
		return names
	}
	return nil
}

// GetShellComplete handles GET /clusters/{clusterId}/shell/complete?line=...
// Returns JSON { "completions": ["..."] } for IDE-style Tab completion.
func (h *Handler) GetShellComplete(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
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

	line := r.URL.Query().Get("line")
	if strings.TrimSpace(line) == "" {
		logCompletionDebug("kubectl", resolvedID, line, "empty", 0, time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": []string{}})
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

	words := completionWords(line)
	if len(words) == 0 {
		logCompletionDebug("kubectl", resolvedID, line, "parse-empty", 0, time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": []string{}})
		return
	}
	wordsTrimmed := make([]string, len(words))
	copy(wordsTrimmed, words)
	for len(wordsTrimmed) > 0 && strings.ToLower(wordsTrimmed[0]) == "kubectl" {
		wordsTrimmed = wordsTrimmed[1:]
	}
	// kubectx-style: complete "kubectl config use-context" with context names from kubeconfig
	if len(wordsTrimmed) >= 2 && strings.ToLower(wordsTrimmed[0]) == "config" && strings.ToLower(wordsTrimmed[1]) == "use-context" {
		prefix := ""
		if len(wordsTrimmed) == 3 {
			prefix = strings.TrimSpace(wordsTrimmed[2])
		}
		ctxList, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctxList, "kubectl", "config", "get-contexts", "-o", "name")
		cmd.Env = append(os.Environ(), "KUBECONFIG="+cluster.KubeconfigPath)
		out, err := cmd.Output()
		if err == nil {
			var names []string
			for _, s := range strings.Split(strings.TrimSpace(string(out)), "\n") {
				s = strings.TrimSpace(s)
				if s == "" {
					continue
				}
				if prefix == "" || strings.HasPrefix(strings.ToLower(s), strings.ToLower(prefix)) {
					names = append(names, s)
				}
			}
			if len(names) > 0 {
				logCompletionDebug("kubectl", resolvedID, line, "contexts", len(names), time.Since(start))
				respondJSON(w, http.StatusOK, map[string]interface{}{"completions": names})
				return
			}
		}
	}

	// Context-aware intellisense: namespace and resource-name completion from live cluster
	if comp := contextAwareCompletions(r.Context(), h.clusterService, resolvedID, line, words); len(comp) > 0 {
		logCompletionDebug("kubectl", resolvedID, line, "context-aware", len(comp), time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": comp})
		return
	}
	if comp := fileFlagCompletions(words); len(comp) > 0 {
		logCompletionDebug("kubectl", resolvedID, line, "file-path", len(comp), time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": comp})
		return
	}

	// Try kubectl __complete (Cobra internal; outputs one completion per line, last line can be ":0" or ":4" for directive)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	args := []string{"__complete"}
	if cluster.Context != "" {
		args = append(args, "--context", cluster.Context)
	}
	args = append(args, words...)

	cmd := exec.CommandContext(ctx, "kubectl", args...)
	cmd.Env = append(os.Environ(), "KUBECONFIG="+cluster.KubeconfigPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		completions := staticCompletions(line, words)
		completions = ensureKubectlFirst(words, completions)
		logCompletionDebug("kubectl", resolvedID, line, "static-fallback", len(completions), time.Since(start))
		respondJSON(w, http.StatusOK, map[string]interface{}{"completions": completions})
		return
	}

	// Parse __complete output: lines are completions; last line can be ":0" (default) or ":4" (no space after)
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	var completions []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if strings.HasPrefix(l, ":") {
			continue
		}
		completions = append(completions, l)
	}
	if len(completions) == 0 {
		completions = staticCompletions(line, words)
		logCompletionDebug("kubectl", resolvedID, line, "complete-empty-static", len(completions), time.Since(start))
	} else {
		logCompletionDebug("kubectl", resolvedID, line, "__complete", len(completions), time.Since(start))
	}
	completions = ensureKubectlFirst(words, completions)
	respondJSON(w, http.StatusOK, map[string]interface{}{"completions": completions})
}

func staticCompletions(_ string, words []string) []string {
	// When the user is typing the command name (e.g. "ku", "kub"), complete to "kubectl" first.
	if len(words) == 1 {
		first := strings.ToLower(strings.TrimSpace(words[0]))
		if first != "" && strings.HasPrefix("kubectl", first) {
			return []string{"kubectl"}
		}
	}
	// Normalize: drop leading "kubectl" so "kubectl get pod" and "get pod" both work
	for len(words) > 0 && strings.ToLower(words[0]) == "kubectl" {
		words = words[1:]
	}
	if len(words) == 0 {
		return kubectlVerbs
	}
	if len(words) == 1 {
		return filterByPrefix(kubectlVerbs, words[0])
	}
	// words[0] = verb, words[1+] = args; complete the last token
	verb := strings.ToLower(words[0])
	last := ""
	if len(words) > 0 {
		last = words[len(words)-1]
	}
	switch verb {
	case "get", "describe", "logs", "exec", "top":
		return filterByPrefix(kubectlResources, last)
	default:
		return filterByPrefix(kubectlResources, last)
	}
}
