package server

// handlers_gaps.go — handlers that close the 6 gaps surfaced by the
// 100-prompt Together.ai bench on 2026-04-22. See
// docs/strategy/2026-04-22-gap-findings-from-100-bench.md for evidence.
//
// Each handler follows the same HTTP-via-backend pattern as the existing
// observation/analysis handlers.

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

// ═══════════════════════════════════════════════════════════════════════════
// Gap 2 — resolve_resource (kind + name_hint → {namespace, name})
// ═══════════════════════════════════════════════════════════════════════════

// resolveMatch is the named struct used by handleResolveResource so
// matchesToSlice can take a concrete slice type (Go won't let us pass
// []anonymous-struct across function boundaries).
type resolveMatch struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Score     int    `json:"-"`
}

// handleResolveResource resolves a fuzzy resource name to concrete
// {namespace, name} coordinates across the whole cluster. Motivated by
// bench failures scen-change-105 / scen-config-96 / scen-compare-18 where
// the LLM called inspect_* with namespace=default when the resource lived
// elsewhere.
func (s *mcpServerImpl) handleResolveResource(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	kind := strArg(args, "kind")
	nameHint := strArg(args, "name_hint")
	if kind == "" || nameHint == "" {
		return nil, fmt.Errorf("resolve_resource: 'kind' and 'name_hint' are required")
	}
	kindPlural := kindToRestPlural(kind)

	// Ask the backend for every resource of this kind cluster-wide. The
	// backend /resources/{kind} endpoint returns all namespaces when no
	// namespace query is passed.
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+url.PathEscape(kindPlural)), &raw); err != nil {
		return map[string]interface{}{
			"kind":        kind,
			"name_hint":   nameHint,
			"matches":     []interface{}{},
			"suggestions": []interface{}{},
			"error":       fmt.Sprintf("list %s: %v", kindPlural, err),
		}, nil
	}

	items := extractResourceItems(raw)
	hintLower := strings.ToLower(nameHint)

	var exact, prefix, substr []resolveMatch
	var allNames []string

	for _, it := range items {
		meta, _ := it["metadata"].(map[string]interface{})
		name, _ := meta["name"].(string)
		namespace, _ := meta["namespace"].(string)
		if name == "" {
			// Fall back to top-level fields on list-view summaries.
			if n, ok := it["name"].(string); ok {
				name = n
			}
			if ns, ok := it["namespace"].(string); ok {
				namespace = ns
			}
		}
		if name == "" {
			continue
		}
		allNames = append(allNames, name)

		lowerName := strings.ToLower(name)
		m := resolveMatch{Namespace: namespace, Name: name, Kind: kind}
		switch {
		case lowerName == hintLower:
			m.Score = 3
			exact = append(exact, m)
		case strings.HasPrefix(lowerName, hintLower):
			m.Score = 2
			prefix = append(prefix, m)
		case strings.Contains(lowerName, hintLower):
			m.Score = 1
			substr = append(substr, m)
		}
	}

	merged := append(append(append([]resolveMatch{}, exact...), prefix...), substr...)
	if len(merged) > 5 {
		merged = merged[:5]
	}

	result := map[string]interface{}{
		"kind":      kind,
		"name_hint": nameHint,
		"matches":   matchesToSlice(merged),
	}
	if len(merged) == 0 {
		// Surface up to 10 real names so the LLM can pick a correction.
		sort.Strings(allNames)
		if len(allNames) > 10 {
			allNames = allNames[:10]
		}
		result["suggestions"] = allNames
	}
	return result, nil
}

func matchesToSlice(in []resolveMatch) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(in))
	for _, m := range in {
		out = append(out, map[string]interface{}{
			"namespace": m.Namespace,
			"name":      m.Name,
			"kind":      m.Kind,
		})
	}
	return out
}

// extractResourceItems peels off the typical backend envelopes ({items: [...]},
// [...] bare array, or single-object) so resolve_resource/metrics handlers
// can treat all list responses uniformly.
func extractResourceItems(raw interface{}) []map[string]interface{} {
	if raw == nil {
		return nil
	}
	var items []map[string]interface{}
	switch v := raw.(type) {
	case []interface{}:
		for _, e := range v {
			if m, ok := e.(map[string]interface{}); ok {
				items = append(items, m)
			}
		}
	case map[string]interface{}:
		if list, ok := v["items"].([]interface{}); ok {
			for _, e := range list {
				if m, ok := e.(map[string]interface{}); ok {
					items = append(items, m)
				}
			}
		}
	}
	return items
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap 4 — observe_recent_changes (events + rollout history fusion)
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveRecentChanges fuses k8s events and deployment rollout
// history within a time window. Closes scen-change-101 "anything deployed
// in last hour?".
func (s *mcpServerImpl) handleObserveRecentChanges(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	window := intArg(args, "window_minutes", 60)
	if window < 1 {
		window = 60
	}
	namespace := strArg(args, "namespace")
	cutoff := time.Now().Add(-time.Duration(window) * time.Minute)

	type change struct {
		When    string `json:"when"`
		Kind    string `json:"kind"`
		Name    string `json:"name,omitempty"`
		Ns      string `json:"namespace,omitempty"`
		Action  string `json:"action"`
		Summary string `json:"summary"`
	}

	// 1. Events in the window
	eq := url.Values{}
	eq.Set("limit", "500")
	if namespace != "" {
		eq.Set("namespace", namespace)
	}
	var rawEvents interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEvents)

	events := extractResourceItems(rawEvents)
	if items, ok := rawEvents.([]interface{}); ok && len(events) == 0 {
		for _, e := range items {
			if m, ok := e.(map[string]interface{}); ok {
				events = append(events, m)
			}
		}
	}

	var changes []change
	for _, ev := range events {
		ts := eventTimestamp(ev)
		if ts.IsZero() || ts.Before(cutoff) {
			continue
		}
		reason, _ := ev["reason"].(string)
		kind, name, ns := eventInvolvedObject(ev)
		msg, _ := ev["message"].(string)
		action := classifyEventReason(reason)
		if action == "" {
			continue
		}
		changes = append(changes, change{
			When:    ts.UTC().Format(time.RFC3339),
			Kind:    kind,
			Name:    name,
			Ns:      ns,
			Action:  action,
			Summary: firstNonEmpty(msg, reason),
		})
	}

	// 2. Rollout history for deployments in-scope
	dq := url.Values{}
	if namespace != "" {
		dq.Set("namespace", namespace)
	}
	var rawDeploys interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments?"+dq.Encode()), &rawDeploys)

	for _, d := range extractResourceItems(rawDeploys) {
		ns := resourceNamespace(d)
		name := resourceName(d)
		if name == "" {
			continue
		}
		histPath := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(ns)+"/"+url.PathEscape(name)+"/rollout-history")
		var hist map[string]interface{}
		if err := c.get(ctx, histPath, &hist); err != nil {
			continue
		}
		for _, rev := range extractRolloutRevisions(hist) {
			ts := parseRolloutTime(rev)
			if ts.IsZero() || ts.Before(cutoff) {
				continue
			}
			changes = append(changes, change{
				When:    ts.UTC().Format(time.RFC3339),
				Kind:    "Deployment",
				Name:    name,
				Ns:      ns,
				Action:  "rollout",
				Summary: firstNonEmpty(strOr(rev, "cause", "change_cause", "message"), "new revision"),
			})
		}
	}

	sort.Slice(changes, func(i, j int) bool { return changes[i].When > changes[j].When })

	return map[string]interface{}{
		"window_minutes": window,
		"namespace":      namespace,
		"changes":        changes,
		"summary": fmt.Sprintf("%d change(s) in the last %d minute(s)%s.",
			len(changes), window, namespaceSuffix(namespace)),
	}, nil
}

// resourceName / resourceNamespace — small accessors used by multiple gap
// handlers. Kept here (not in handlers_observation.go) to keep gap code
// self-contained.
func resourceName(m map[string]interface{}) string {
	if meta, ok := m["metadata"].(map[string]interface{}); ok {
		if n, ok := meta["name"].(string); ok {
			return n
		}
	}
	if n, ok := m["name"].(string); ok {
		return n
	}
	return ""
}

func resourceNamespace(m map[string]interface{}) string {
	if meta, ok := m["metadata"].(map[string]interface{}); ok {
		if n, ok := meta["namespace"].(string); ok {
			return n
		}
	}
	if n, ok := m["namespace"].(string); ok {
		return n
	}
	return ""
}

func namespaceSuffix(ns string) string {
	if ns == "" {
		return ""
	}
	return " in namespace " + ns
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}

func eventTimestamp(ev map[string]interface{}) time.Time {
	for _, key := range []string{"lastTimestamp", "firstTimestamp", "eventTime", "timestamp", "creationTimestamp"} {
		if v, ok := ev[key].(string); ok && v != "" {
			if t, err := time.Parse(time.RFC3339, v); err == nil {
				return t
			}
		}
	}
	return time.Time{}
}

func eventInvolvedObject(ev map[string]interface{}) (kind, name, namespace string) {
	obj, _ := ev["involvedObject"].(map[string]interface{})
	if obj != nil {
		kind, _ = obj["kind"].(string)
		name, _ = obj["name"].(string)
		namespace, _ = obj["namespace"].(string)
	}
	if kind == "" {
		kind, _ = ev["kind"].(string)
	}
	return
}

// classifyEventReason maps noisy k8s reason strings to the handful of
// high-signal "actions" the LLM cares about in a change timeline. Returns
// "" for noise the LLM should ignore.
func classifyEventReason(reason string) string {
	switch reason {
	case "ScalingReplicaSet", "DeploymentRollback":
		return "rollout"
	case "SuccessfulCreate", "Scheduled", "Pulled", "Started", "Created":
		return "create"
	case "Killing", "SuccessfulDelete":
		return "delete"
	case "ConfigMapUpdated", "SecretUpdated":
		return "update"
	}
	if strings.HasPrefix(reason, "Failed") || strings.HasPrefix(reason, "BackOff") {
		return "failure"
	}
	return ""
}

func extractRolloutRevisions(hist map[string]interface{}) []map[string]interface{} {
	if hist == nil {
		return nil
	}
	for _, key := range []string{"revisions", "history", "items"} {
		if list, ok := hist[key].([]interface{}); ok {
			out := make([]map[string]interface{}, 0, len(list))
			for _, e := range list {
				if m, ok := e.(map[string]interface{}); ok {
					out = append(out, m)
				}
			}
			return out
		}
	}
	return nil
}

func parseRolloutTime(rev map[string]interface{}) time.Time {
	for _, key := range []string{"timestamp", "revision_time", "creationTimestamp", "time"} {
		if v, ok := rev[key].(string); ok && v != "" {
			if t, err := time.Parse(time.RFC3339, v); err == nil {
				return t
			}
		}
	}
	return time.Time{}
}

// strOr looks up multiple keys in priority order and returns the first
// non-empty string value. Used by recent_changes + top_pods helpers.
func strOr(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}
