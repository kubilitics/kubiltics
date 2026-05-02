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
	"sync"
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
				Summary: firstNonEmpty(strOr(rev, "cause", "change_cause", "changeCause", "message"), "new revision"),
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

// ═══════════════════════════════════════════════════════════════════════════
// Gap 3 — who_can_do RBAC aggregator
// ═══════════════════════════════════════════════════════════════════════════

// handleWhoCanDo answers "who can <verb> <resource> in <namespace>?" in a
// single call. Closes the scen-rbac-12 95-tool-fan-out outlier where the
// LLM enumerated every ClusterRole one-by-one via inspect_clusterrole.
func (s *mcpServerImpl) handleWhoCanDo(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	verb := strings.ToLower(strArg(args, "verb"))
	resource := strings.ToLower(strArg(args, "resource"))
	namespace := strArg(args, "namespace")
	if verb == "" || resource == "" {
		return nil, fmt.Errorf("who_can_do: 'verb' and 'resource' are required")
	}

	// Pull all roles + bindings in parallel.
	var wg sync.WaitGroup
	var clusterRoles, roles, clusterRoleBindings, roleBindings interface{}
	var crErr, rErr, crbErr, rbErr error

	wg.Add(4)
	go func() {
		defer wg.Done()
		crErr = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles"), &clusterRoles)
	}()
	go func() {
		defer wg.Done()
		rErr = c.get(ctx, c.clusterPath(clusterID, "/resources/roles"), &roles)
	}()
	go func() {
		defer wg.Done()
		crbErr = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &clusterRoleBindings)
	}()
	go func() {
		defer wg.Done()
		rbErr = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"), &roleBindings)
	}()
	wg.Wait()

	roleMatches := map[string]bool{}
	grantingRoleNames := map[string][]string{}

	checkRules := func(rules []interface{}, key string, scope string) {
		for _, r := range rules {
			rule, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			if !stringSliceMatches(rule["verbs"], verb) {
				continue
			}
			if !stringSliceMatches(rule["resources"], resource) {
				continue
			}
			roleMatches[key] = true
			grantingRoleNames[key] = append(grantingRoleNames[key], scope)
		}
	}

	for _, cr := range extractResourceItems(clusterRoles) {
		name := resourceName(cr)
		if name == "" {
			continue
		}
		rules, _ := cr["rules"].([]interface{})
		checkRules(rules, "ClusterRole/"+name, "cluster")
	}
	for _, r := range extractResourceItems(roles) {
		name := resourceName(r)
		ns := resourceNamespace(r)
		if name == "" {
			continue
		}
		if namespace != "" && ns != namespace {
			continue
		}
		rules, _ := r["rules"].([]interface{})
		checkRules(rules, "Role/"+ns+"/"+name, ns)
	}

	type principal struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		Namespace string `json:"namespace,omitempty"`
		Via       string `json:"via"`
	}
	var principals []principal
	seen := map[string]bool{}

	addPrincipals := func(subjects []interface{}, via string) {
		for _, s := range subjects {
			subj, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			kind, _ := subj["kind"].(string)
			name, _ := subj["name"].(string)
			ns, _ := subj["namespace"].(string)
			if kind == "" || name == "" {
				continue
			}
			dedupKey := kind + "/" + ns + "/" + name + "|" + via
			if seen[dedupKey] {
				continue
			}
			seen[dedupKey] = true
			principals = append(principals, principal{
				Kind: kind, Name: name, Namespace: ns, Via: via,
			})
		}
	}

	for _, crb := range extractResourceItems(clusterRoleBindings) {
		ref, _ := crb["roleRef"].(map[string]interface{})
		refKind, _ := ref["kind"].(string)
		refName, _ := ref["name"].(string)
		key := refKind + "/" + refName
		if !roleMatches[key] {
			continue
		}
		subjects, _ := crb["subjects"].([]interface{})
		addPrincipals(subjects, "ClusterRoleBinding/"+resourceName(crb))
	}
	for _, rb := range extractResourceItems(roleBindings) {
		rbNS := resourceNamespace(rb)
		if namespace != "" && rbNS != namespace {
			continue
		}
		ref, _ := rb["roleRef"].(map[string]interface{})
		refKind, _ := ref["kind"].(string)
		refName, _ := ref["name"].(string)
		// A RoleBinding can point at either a Role (same namespace) or a
		// ClusterRole (then scoped to the binding's namespace).
		var key string
		if refKind == "ClusterRole" {
			key = "ClusterRole/" + refName
		} else {
			key = "Role/" + rbNS + "/" + refName
		}
		if !roleMatches[key] {
			continue
		}
		subjects, _ := rb["subjects"].([]interface{})
		addPrincipals(subjects, "RoleBinding/"+rbNS+"/"+resourceName(rb))
	}

	rolesGranting := make([]string, 0, len(grantingRoleNames))
	for k := range grantingRoleNames {
		rolesGranting = append(rolesGranting, k)
	}
	sort.Strings(rolesGranting)

	return map[string]interface{}{
		"verb":           verb,
		"resource":       resource,
		"namespace":      namespace,
		"principals":     principals,
		"roles_granting": rolesGranting,
		"summary":        summarizeWhoCanDo(verb, resource, namespace, len(principals), rolesGranting),
		"backend_errors": filterNonNilErrs(crErr, rErr, crbErr, rbErr),
	}, nil
}

func filterNonNilErrs(errs ...error) []string {
	var out []string
	for _, e := range errs {
		if e != nil {
			out = append(out, e.Error())
		}
	}
	return out
}

// stringSliceMatches returns true if needle matches any element in the
// slice. Honors the kubernetes "*" wildcard.
func stringSliceMatches(v interface{}, needle string) bool {
	list, ok := v.([]interface{})
	if !ok {
		return false
	}
	for _, e := range list {
		s, ok := e.(string)
		if !ok {
			continue
		}
		if s == "*" || strings.EqualFold(s, needle) {
			return true
		}
	}
	return false
}

func summarizeWhoCanDo(verb, resource, namespace string, principalCount int, roles []string) string {
	clusterRoles := 0
	namespacedRoles := 0
	for _, r := range roles {
		if strings.HasPrefix(r, "ClusterRole/") {
			clusterRoles++
		} else {
			namespacedRoles++
		}
	}
	scope := "cluster-wide"
	if namespace != "" {
		scope = "namespace " + namespace
	}
	return fmt.Sprintf("%d principal(s) can %s %s in %s via %d cluster-level role(s) and %d namespaced role(s).",
		principalCount, verb, resource, scope, clusterRoles, namespacedRoles)
}

// ═══════════════════════════════════════════════════════════════════════════
// Gap 1 — live metrics adapter (pod / node / top-N)
// ═══════════════════════════════════════════════════════════════════════════

// metricsFallback returns a structured "metrics-server not installed"
// response when the backend metrics endpoint is unavailable. The LLM gets
// a coherent non-empty shape instead of a generic error.
func metricsFallback(reason string) map[string]interface{} {
	return map[string]interface{}{
		"metrics_unavailable": true,
		"reason":              reason,
		"install_hint":        "kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml",
	}
}

// handleObservePodMetrics returns CPU/memory for a single pod, or a
// namespace-aggregate summary when no name is given. Closes scen-pods-33 /
// scen-pods-42.
func (s *mcpServerImpl) handleObservePodMetrics(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")

	if name != "" {
		if namespace == "" {
			return nil, fmt.Errorf("observe_pod_metrics: 'namespace' is required when 'name' is given")
		}
		var m map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &m); err != nil {
			return metricsFallback(fmt.Sprintf("metrics for pod %q in %q unavailable: %v", name, namespace, err)), nil
		}
		return map[string]interface{}{
			"pod":       name,
			"namespace": namespace,
			"metrics":   m,
		}, nil
	}

	// Namespace / cluster-wide aggregate via /metrics/summary.
	var raw map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &raw); err != nil {
		return metricsFallback(fmt.Sprintf("metrics-server summary unavailable: %v", err)), nil
	}
	return map[string]interface{}{
		"namespace":       namespace,
		"metrics_summary": raw,
		"analysis_hint":   "Use 'pods' key (if present) to identify hot pods. For a top-N ranking call observe_top_pods_by_metric.",
	}, nil
}

// handleObserveNodeMetrics returns per-node CPU/memory/disk.
func (s *mcpServerImpl) handleObserveNodeMetrics(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name != "" {
		var m map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/nodes/"+url.PathEscape(name)), &m); err == nil {
			return map[string]interface{}{"node": name, "metrics": m}, nil
		}
	}
	var raw map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &raw); err != nil {
		return metricsFallback(fmt.Sprintf("cluster metrics unavailable: %v", err)), nil
	}
	return map[string]interface{}{
		"node":    name,
		"metrics": raw,
	}, nil
}

// handleObserveTopPodsByMetric returns the N highest-consuming pods for
// cpu|memory. Closes gap scen-pods-42 ("pod with highest CPU this hour").
func (s *mcpServerImpl) handleObserveTopPodsByMetric(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	metricType := strings.ToLower(strArg(args, "metric_type"))
	if metricType == "" {
		metricType = "cpu"
	}
	if metricType != "cpu" && metricType != "memory" {
		return nil, fmt.Errorf("observe_top_pods_by_metric: 'metric_type' must be 'cpu' or 'memory'")
	}
	namespace := strArg(args, "namespace")
	limit := intArg(args, "limit", 10)
	if limit < 1 {
		limit = 10
	}

	var raw map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &raw); err != nil {
		return metricsFallback(fmt.Sprintf("metrics-server summary unavailable: %v", err)), nil
	}

	podsRaw, _ := raw["pods"].([]interface{})
	type row struct {
		Namespace string  `json:"namespace"`
		Name      string  `json:"name"`
		CPU       float64 `json:"cpu_millicores"`
		Memory    float64 `json:"memory_mib"`
	}
	var rows []row
	for _, p := range podsRaw {
		pm, ok := p.(map[string]interface{})
		if !ok {
			continue
		}
		ns, _ := pm["namespace"].(string)
		if namespace != "" && ns != namespace {
			continue
		}
		rows = append(rows, row{
			Namespace: ns,
			Name:      strOr(pm, "name", "pod"),
			CPU:       floatOr(pm, "cpu_millicores", "cpu"),
			Memory:    floatOr(pm, "memory_mib", "memory"),
		})
	}

	sort.Slice(rows, func(i, j int) bool {
		if metricType == "cpu" {
			return rows[i].CPU > rows[j].CPU
		}
		return rows[i].Memory > rows[j].Memory
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}

	if len(rows) == 0 {
		return map[string]interface{}{
			"metric_type":  metricType,
			"namespace":    namespace,
			"top_pods":     []interface{}{},
			"summary":      "No pod metrics available — metrics-server may not be installed or summary endpoint has no pod rows.",
			"install_hint": "kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml",
		}, nil
	}

	out := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]interface{}{
			"namespace":      r.Namespace,
			"name":           r.Name,
			"cpu_millicores": r.CPU,
			"memory_mib":     r.Memory,
		})
	}
	return map[string]interface{}{
		"metric_type": metricType,
		"namespace":   namespace,
		"top_pods":    out,
		"summary":     fmt.Sprintf("Top %d pods by %s in %s", len(out), metricType, namespaceLabel(namespace)),
	}, nil
}

func namespaceLabel(ns string) string {
	if ns == "" {
		return "all namespaces"
	}
	return "namespace " + ns
}

// floatOr looks up multiple keys and returns the first numeric value
// (float64 / int / int64).
func floatOr(m map[string]interface{}, keys ...string) float64 {
	for _, k := range keys {
		switch v := m[k].(type) {
		case float64:
			return v
		case int:
			return float64(v)
		case int64:
			return float64(v)
		}
	}
	return 0
}

// ═══════════════════════════════════════════════════════════════════════════
// Iteration 3 aggregators (2026-04-22 v2 bench gap closure)
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveServicesByFilter returns Services matching any of the
// requested filters (flapping, no_endpoints) with a short reason. Answers
// scen-health-26 ("any services flapping cluster-wide?") without making
// the LLM enumerate Services one-by-one.
func (s *mcpServerImpl) handleObserveServicesByFilter(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	wantFlapping := boolArg(args, "flapping")
	wantNoEndpoints := boolArg(args, "no_endpoints")

	// If nothing was asked for, imply both — "show me problem services".
	if !wantFlapping && !wantNoEndpoints {
		wantFlapping = true
		wantNoEndpoints = true
	}

	var svcList map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+nsQuery(namespace)), &svcList); err != nil {
		return nil, err
	}
	items := extractResourceItems(svcList)

	// Events scoped to recent window for flap detection.
	eq := url.Values{}
	eq.Set("since", "15m")
	if namespace != "" {
		eq.Set("namespace", namespace)
	}
	var rawEvents interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEvents)
	flapCount := countEndpointChurn(rawEvents)

	type row struct {
		Namespace      string   `json:"namespace"`
		Name           string   `json:"name"`
		Reasons        []string `json:"reasons"`
		EndpointChurn  int      `json:"endpoint_churn_events,omitempty"`
		ReadyEndpoints int      `json:"ready_endpoints"`
	}
	var out []row

	for _, svc := range items {
		ns := resourceNamespace(svc)
		name := resourceName(svc)
		if name == "" {
			continue
		}
		if namespace != "" && ns != namespace {
			continue
		}
		var reasons []string
		readyCount := 0

		// Count endpoints by reading the subresource.
		var eps map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(ns)+"/"+url.PathEscape(name)+"/endpoints"), &eps)
		readyCount = countReadyEndpoints(eps)

		if wantNoEndpoints && readyCount == 0 {
			reasons = append(reasons, "no ready endpoints")
		}
		churn := flapCount[ns+"/"+name]
		if wantFlapping && churn >= 3 {
			reasons = append(reasons, fmt.Sprintf("endpoint churn: %d events in 15m", churn))
		}
		if len(reasons) == 0 {
			continue
		}
		out = append(out, row{
			Namespace:      ns,
			Name:           name,
			Reasons:        reasons,
			EndpointChurn:  churn,
			ReadyEndpoints: readyCount,
		})
	}

	summary := fmt.Sprintf("%d service(s) matched in %s", len(out), namespaceLabel(namespace))
	if len(out) == 0 {
		summary = "All services healthy — no flapping or endpoint-less services detected"
	}
	return map[string]interface{}{
		"cluster_id": clusterID,
		"filters": map[string]interface{}{
			"flapping":     wantFlapping,
			"no_endpoints": wantNoEndpoints,
		},
		"services": out,
		"summary":  summary,
	}, nil
}

func countEndpointChurn(rawEvents interface{}) map[string]int {
	counts := map[string]int{}
	evs := extractResourceItems(rawEvents)
	for _, ev := range evs {
		reason, _ := ev["reason"].(string)
		r := strings.ToLower(reason)
		if !strings.Contains(r, "endpoint") && !strings.Contains(r, "nodenotready") {
			continue
		}
		kind, name, ns := eventInvolvedObject(ev)
		if !strings.EqualFold(kind, "Service") && !strings.EqualFold(kind, "Endpoints") {
			continue
		}
		counts[ns+"/"+name]++
	}
	return counts
}

func countReadyEndpoints(eps map[string]interface{}) int {
	if eps == nil {
		return 0
	}
	n := 0
	subsets, _ := eps["subsets"].([]interface{})
	for _, s := range subsets {
		ss, _ := s.(map[string]interface{})
		addrs, _ := ss["addresses"].([]interface{})
		n += len(addrs)
	}
	// EndpointSlice style.
	endpoints, _ := eps["endpoints"].([]interface{})
	for _, e := range endpoints {
		em, _ := e.(map[string]interface{})
		cond, _ := em["conditions"].(map[string]interface{})
		if ready, ok := cond["ready"].(bool); ok && ready {
			n++
		}
	}
	return n
}

// handleObserveSecretsUsage returns every Secret with a reference graph
// showing which Pods mount it (volume) or consume it via env. Answers
// scen-config-95 ("any secrets not actually used?").
func (s *mcpServerImpl) handleObserveSecretsUsage(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	var secretList, podList map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/secrets"+nsQuery(namespace)), &secretList); err != nil {
		return nil, err
	}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+nsQuery(namespace)), &podList); err != nil {
		return nil, err
	}

	// Build reference graph.
	type usage struct {
		MountedBy []string `json:"mounted_by_pods"`
		EnvBy     []string `json:"mounted_as_env_by_pods"`
	}
	ref := map[string]*usage{} // key: "ns/name"

	pods := extractResourceItems(podList)
	for _, pod := range pods {
		ns := resourceNamespace(pod)
		pname := resourceName(pod)
		if pname == "" {
			continue
		}
		spec, _ := pod["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}

		// Volumes of type secret.
		if vols, ok := spec["volumes"].([]interface{}); ok {
			for _, v := range vols {
				vm, _ := v.(map[string]interface{})
				sec, _ := vm["secret"].(map[string]interface{})
				if sec == nil {
					continue
				}
				secName, _ := sec["secretName"].(string)
				if secName == "" {
					continue
				}
				k := ns + "/" + secName
				if ref[k] == nil {
					ref[k] = &usage{}
				}
				ref[k].MountedBy = append(ref[k].MountedBy, ns+"/"+pname)
			}
		}

		// Env sources on every container.
		for _, section := range []string{"containers", "initContainers"} {
			containers, _ := spec[section].([]interface{})
			for _, c := range containers {
				cm, _ := c.(map[string]interface{})
				if cm == nil {
					continue
				}
				if env, ok := cm["env"].([]interface{}); ok {
					for _, e := range env {
						em, _ := e.(map[string]interface{})
						vf, _ := em["valueFrom"].(map[string]interface{})
						sr, _ := vf["secretKeyRef"].(map[string]interface{})
						if sn, _ := sr["name"].(string); sn != "" {
							k := ns + "/" + sn
							if ref[k] == nil {
								ref[k] = &usage{}
							}
							ref[k].EnvBy = append(ref[k].EnvBy, ns+"/"+pname)
						}
					}
				}
				if sources, ok := cm["envFrom"].([]interface{}); ok {
					for _, src := range sources {
						sm, _ := src.(map[string]interface{})
						sr, _ := sm["secretRef"].(map[string]interface{})
						if sn, _ := sr["name"].(string); sn != "" {
							k := ns + "/" + sn
							if ref[k] == nil {
								ref[k] = &usage{}
							}
							ref[k].EnvBy = append(ref[k].EnvBy, ns+"/"+pname)
						}
					}
				}
			}
		}
	}

	type row struct {
		Namespace string   `json:"namespace"`
		Name      string   `json:"name"`
		Type      string   `json:"type,omitempty"`
		Mounted   []string `json:"mounted_by_pods"`
		Env       []string `json:"mounted_as_env_by_pods"`
		Unused    bool     `json:"unused"`
	}
	var out []row
	unusedCount := 0
	secrets := extractResourceItems(secretList)
	for _, sec := range secrets {
		ns := resourceNamespace(sec)
		name := resourceName(sec)
		if name == "" {
			continue
		}
		stype, _ := sec["type"].(string)
		u := ref[ns+"/"+name]
		var mounted, env []string
		if u != nil {
			mounted = u.MountedBy
			env = u.EnvBy
		}
		unused := len(mounted) == 0 && len(env) == 0 &&
			// Filter out service-account tokens and helm ownership secrets;
			// those are "used" by the infrastructure even if no pod references them.
			!strings.HasPrefix(stype, "kubernetes.io/service-account-token") &&
			!strings.HasPrefix(stype, "helm.sh/")
		if unused {
			unusedCount++
		}
		out = append(out, row{
			Namespace: ns, Name: name, Type: stype,
			Mounted: mounted, Env: env, Unused: unused,
		})
	}

	return map[string]interface{}{
		"namespace":    namespace,
		"secrets":      out,
		"unused_count": unusedCount,
		"summary":      fmt.Sprintf("%d secret(s) total, %d unused in %s", len(out), unusedCount, namespaceLabel(namespace)),
	}, nil
}

// handleObserveIngressesByTLSExpiry returns Ingresses whose TLS certs
// expire within the given window (default 30 days). Answers scen-network-86
// ("certs about to expire") without per-ingress iteration.
func (s *mcpServerImpl) handleObserveIngressesByTLSExpiry(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	days := intArg(args, "days", 30)
	if days < 1 {
		days = 30
	}
	namespace := strArg(args, "namespace")

	var ingList map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses"+nsQuery(namespace)), &ingList); err != nil {
		return nil, err
	}
	items := extractResourceItems(ingList)

	type row struct {
		Namespace     string `json:"namespace"`
		Name          string `json:"name"`
		Host          string `json:"host,omitempty"`
		Issuer        string `json:"issuer,omitempty"`
		ExpiresAt     string `json:"expires_at,omitempty"`
		DaysRemaining int    `json:"days_remaining"`
	}
	var out []row
	anyTLSInfo := false
	cutoff := time.Now().Add(time.Duration(days) * 24 * time.Hour)
	for _, ing := range items {
		ns := resourceNamespace(ing)
		name := resourceName(ing)
		if name == "" {
			continue
		}
		var tlsInfo map[string]interface{}
		err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses/"+url.PathEscape(ns)+"/"+url.PathEscape(name)+"/tls-info"), &tlsInfo)
		if err != nil || tlsInfo == nil {
			continue
		}
		anyTLSInfo = true
		certs, _ := tlsInfo["certificates"].([]interface{})
		for _, cert := range certs {
			cm, _ := cert.(map[string]interface{})
			if cm == nil {
				continue
			}
			expStr, _ := cm["not_after"].(string)
			if expStr == "" {
				expStr, _ = cm["expires_at"].(string)
			}
			if expStr == "" {
				continue
			}
			exp, err := time.Parse(time.RFC3339, expStr)
			if err != nil {
				continue
			}
			if exp.After(cutoff) {
				continue
			}
			host, _ := cm["host"].(string)
			issuer, _ := cm["issuer"].(string)
			remaining := int(time.Until(exp).Hours() / 24)
			out = append(out, row{
				Namespace:     ns,
				Name:          name,
				Host:          host,
				Issuer:        issuer,
				ExpiresAt:     expStr,
				DaysRemaining: remaining,
			})
		}
	}

	if !anyTLSInfo {
		return map[string]interface{}{
			"tls_inspection_unavailable": true,
			"reason":                     "Backend /ingresses/<ns>/<name>/tls-info endpoint returned nothing — cluster may not expose TLS inspection or no Ingress has a TLS section.",
			"install_hint":               "Install cert-manager and ensure the backend certificate inspector is enabled on this cluster.",
			"days_window":                days,
			"namespace":                  namespace,
		}, nil
	}

	// Sort ascending — expiring soonest first.
	sort.Slice(out, func(i, j int) bool { return out[i].DaysRemaining < out[j].DaysRemaining })

	return map[string]interface{}{
		"days_window":        days,
		"namespace":          namespace,
		"expiring_ingresses": out,
		"summary":            fmt.Sprintf("%d ingress TLS cert(s) expire within %d days in %s", len(out), days, namespaceLabel(namespace)),
	}, nil
}
