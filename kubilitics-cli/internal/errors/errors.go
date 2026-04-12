// Package errors provides user-friendly error wrapping for kcli.
// It detects common kubectl failure patterns and adds actionable hints.
package errors

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/runner"
)

// Code identifies a class of error for programmatic handling and Desktop integration.
type Code string

const (
	ErrKubectlNotFound    Code = "KUBECTL_NOT_FOUND"
	ErrClusterUnreachable Code = "CLUSTER_UNREACHABLE"
	ErrPermissionDenied   Code = "PERMISSION_DENIED"
	ErrResourceNotFound   Code = "RESOURCE_NOT_FOUND"
	ErrResourceTypeNotFound Code = "RESOURCE_TYPE_NOT_FOUND"
	ErrMutationAborted    Code = "MUTATION_ABORTED"
	ErrTimeout            Code = "TIMEOUT"
	ErrConfigInvalid      Code = "CONFIG_INVALID"
	ErrParseFailed        Code = "PARSE_FAILED"
)

// KcliError is a user-friendly error with an optional hint.
type KcliError struct {
	ErrCode Code   `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
	Cause   error  `json:"-"`
}

func (e *KcliError) Error() string {
	if e.Hint != "" {
		return fmt.Sprintf("%s\n\nhint: %s", e.Message, e.Hint)
	}
	return e.Message
}

func (e *KcliError) Unwrap() error { return e.Cause }

// MarshalJSON implements json.Marshaler for Desktop integration.
func (e *KcliError) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Error struct {
			Code    Code   `json:"code"`
			Message string `json:"message"`
			Hint    string `json:"hint,omitempty"`
		} `json:"error"`
	}{
		Error: struct {
			Code    Code   `json:"code"`
			Message string `json:"message"`
			Hint    string `json:"hint,omitempty"`
		}{e.ErrCode, e.Message, e.Hint},
	})
}

// Wrap inspects err and, if it's a KubectlError with a recognizable stderr
// pattern, returns a KcliError with a user-friendly hint. Otherwise returns
// the original error unchanged.
func Wrap(err error) error {
	if err == nil {
		return nil
	}
	ke, ok := err.(*runner.KubectlError)
	if !ok {
		// Check for kubectl-not-found
		msg := err.Error()
		if strings.Contains(msg, "kubectl not available") {
			return &KcliError{
				ErrCode: ErrKubectlNotFound,
				Message: "kubectl is not installed or not in PATH",
				Hint:    "Install kubectl: https://kubernetes.io/docs/tasks/tools/\nOr set KCLI_KUBECTL_PATH to the binary location.",
				Cause:   err,
			}
		}
		return err
	}

	stderr := ke.Stderr
	switch {
	case strings.Contains(stderr, "the server doesn't have a resource type"):
		resType := extractQuoted(stderr)
		hint := "Run 'kcli api-resources' to list available resource types."
		if resType != "" {
			if suggestion := suggestResourceType(resType); suggestion != "" {
				hint = fmt.Sprintf("Did you mean %q?\n%s", suggestion, hint)
			}
		}
		return &KcliError{
			ErrCode: ErrResourceTypeNotFound,
			Message: fmt.Sprintf("resource type not found: %s", stderr),
			Hint:    hint,
			Cause:   ke,
		}

	case strings.Contains(stderr, "Forbidden") || strings.Contains(stderr, "forbidden"):
		return &KcliError{
			ErrCode: ErrPermissionDenied,
			Message: stderr,
			Hint:    "Check your permissions: kcli rbac what-can <your-identity>",
			Cause:   ke,
		}

	case strings.Contains(stderr, "Unable to connect") ||
		strings.Contains(stderr, "dial tcp") ||
		strings.Contains(stderr, "connection refused") ||
		strings.Contains(stderr, "no such host") ||
		strings.Contains(stderr, "i/o timeout"):
		return &KcliError{
			ErrCode: ErrClusterUnreachable,
			Message: "cannot connect to the Kubernetes cluster",
			Hint:    "Check your connection and context: kcli ctx --current\nVerify cluster accessibility: kubectl cluster-info",
			Cause:   ke,
		}

	case strings.Contains(stderr, "NotFound") || strings.Contains(stderr, "not found"):
		return &KcliError{
			ErrCode: ErrResourceNotFound,
			Message: stderr,
			Hint:    "Check the resource name and namespace: kcli ns --current",
			Cause:   ke,
		}

	case strings.Contains(stderr, "timed out"):
		return &KcliError{
			ErrCode: ErrTimeout,
			Message: stderr,
			Hint:    "The cluster may be under load. Retry or check: kcli health",
			Cause:   ke,
		}

	case strings.Contains(stderr, "error: context") && strings.Contains(stderr, "does not exist"):
		return &KcliError{
			ErrCode: ErrConfigInvalid,
			Message: stderr,
			Hint:    "List available contexts: kcli ctx\nCheck kubeconfig: kcli kubeconfig view",
			Cause:   ke,
		}
	}

	return ke
}

// NewParseError creates a KcliError for when API returned data that can't be parsed.
func NewParseError(context string, cause error) *KcliError {
	return &KcliError{
		ErrCode: ErrParseFailed,
		Message: fmt.Sprintf("failed to parse API response for %s", context),
		Hint:    "The cluster may have returned unexpected data. Try: kubectl get " + context + " -o json",
		Cause:   cause,
	}
}

// extractQuoted returns the first double-quoted substring from s, or empty string.
func extractQuoted(s string) string {
	start := strings.IndexByte(s, '"')
	if start < 0 {
		return ""
	}
	end := strings.IndexByte(s[start+1:], '"')
	if end < 0 {
		return ""
	}
	return s[start+1 : start+1+end]
}

// suggestResourceType returns a common resource type that is similar to the
// misspelled input, or empty string if no suggestion.
func suggestResourceType(input string) string {
	input = strings.ToLower(input)
	// Common misspellings / abbreviations
	suggestions := map[string]string{
		"pod":          "pods",
		"deploy":       "deployments",
		"deployment":   "deployments",
		"svc":          "services",
		"service":      "services",
		"ns":           "namespaces",
		"namespace":    "namespaces",
		"cm":           "configmaps",
		"configmap":    "configmaps",
		"ing":          "ingresses",
		"ingress":      "ingresses",
		"pv":           "persistentvolumes",
		"pvc":          "persistentvolumeclaims",
		"sa":           "serviceaccounts",
		"sts":          "statefulsets",
		"statefulset":  "statefulsets",
		"ds":           "daemonsets",
		"daemonset":    "daemonsets",
		"rs":           "replicasets",
		"replicaset":   "replicasets",
		"cj":           "cronjobs",
		"cronjob":      "cronjobs",
		"hpa":          "horizontalpodautoscalers",
		"ep":           "endpoints",
		"endpoint":     "endpoints",
		"secret":       "secrets",
		"node":         "nodes",
		"event":        "events",
		"job":          "jobs",
	}
	if s, ok := suggestions[input]; ok {
		return s
	}
	// Try prefix match
	for k, v := range suggestions {
		if strings.HasPrefix(k, input) || strings.HasPrefix(input, k) {
			return v
		}
	}
	return ""
}
