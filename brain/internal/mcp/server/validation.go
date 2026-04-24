package server

// validation.go — early-gate rejector for obviously-fabricated tool
// arguments. Motivation: the 2026-04-22 v2 bench found the LLM passing
// name="all", namespace="*", kind="all", pod="all" to legacy tools when
// a better aggregator existed. Those values silently propagated to the
// backend, failed mid-stream with generic errors, and burned tool-call
// budget without redirecting the model.
//
// By catching these at the MCP dispatch layer and returning a structured
// `tool_args_invalid` payload with a redirect_hint, the LLM sees the
// response as a normal tool result (not an error) and naturally retries
// with the correct scope.

import (
	"fmt"
	"strings"
)

// wildcardValues are strings that are never valid for a named resource.
// We deliberately do NOT include "" here — an empty string is the
// documented way to mean "cluster-wide" for namespace params.
var wildcardValues = map[string]bool{
	"all": true,
	"*":   true,
}

// wildcardGuardedFields lists the argument keys we police. Keep this
// conservative: every field here must be semantically a concrete
// resource identifier (not a filter/selector that legitimately accepts
// wildcards, like `verbs` inside an RBAC rule).
var wildcardGuardedFields = []string{"name", "namespace", "kind", "pod"}

// validationRejection is the result payload returned when a wildcard is
// caught. The shape is deliberately distinct from a Go error so the LLM
// does not see a tool failure — it sees a normal result that tells it
// how to retry.
type validationRejection struct {
	ToolArgsInvalid bool   `json:"tool_args_invalid"`
	Field           string `json:"field"`
	BadValue        string `json:"bad_value"`
	RedirectHint    string `json:"redirect_hint"`
}

// validateToolArgs inspects args for obvious wildcard fabrications and
// returns a non-nil *validationRejection on the first one it finds.
// Returns nil when the args are acceptable.
//
// toolName is accepted for future per-tool overrides but is currently
// unused — the guard is uniformly applied across every tool. Fine-grained
// opt-outs can slot in here without touching callers.
func validateToolArgs(toolName string, args map[string]interface{}) *validationRejection {
	if args == nil {
		return nil
	}
	for _, field := range wildcardGuardedFields {
		raw, ok := args[field]
		if !ok {
			continue
		}
		s, ok := raw.(string)
		if !ok {
			continue
		}
		lower := strings.ToLower(strings.TrimSpace(s))
		if !wildcardValues[lower] {
			continue
		}
		return &validationRejection{
			ToolArgsInvalid: true,
			Field:           field,
			BadValue:        s,
			RedirectHint:    redirectHintFor(field),
		}
	}
	return nil
}

func redirectHintFor(field string) string {
	switch field {
	case "name":
		return "The parameter 'name' cannot be 'all' or '*'. For cluster-wide queries use the scope='cluster' parameter (e.g. analyze_blast_radius), or list resources first and query them individually."
	case "namespace":
		return "The parameter 'namespace' cannot be 'all' or '*'. Use an empty string or omit the field entirely for cluster-wide queries."
	case "kind":
		return "The parameter 'kind' cannot be 'all' or '*'. Use scope='cluster' on aggregator tools, or pick a specific kind like 'Deployment' / 'Pod' / 'Service'."
	case "pod":
		return "The parameter 'pod' cannot be 'all' or '*'. List pods first (observe_resources_by_query or inspect_namespace), then query logs per pod."
	}
	return fmt.Sprintf("The parameter %q cannot be a wildcard. Pass a concrete value or use a scope-aware aggregator tool.", field)
}

// asToolResult converts a rejection into the map[string]interface{}
// shape every MCP handler returns. Keeps the dispatch site a one-liner.
func (v *validationRejection) asToolResult() map[string]interface{} {
	return map[string]interface{}{
		"tool_args_invalid": v.ToolArgsInvalid,
		"field":             v.Field,
		"bad_value":         v.BadValue,
		"redirect_hint":     v.RedirectHint,
	}
}
