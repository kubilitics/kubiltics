package server

// handlers_narrate.go — Phase 3 Category 5 narrative/storytelling tools.
//
// Ten narrate_* tools that gather scoped data + emit a
// `narrative_prompt` field the LLM uses to produce a human-ready summary.
// All raw K8s list objects are replaced with pre-computed compact summaries
// so the payload stays well under the 8 KB LLM cap.
// Returned via routeAnalysisTool's default delegate.

import (
	"context"
	"fmt"
	"net/url"
)

// ─────────────────────────────────────────────────────────────────────────────
// Compact-summary helpers (narrate-specific)
// ─────────────────────────────────────────────────────────────────────────────

// extractEventField reads a top-level string field from a raw event map.
func extractEventField(ev map[string]interface{}, field string) string {
	if v, ok := ev[field].(string); ok {
		return v
	}
	return ""
}

// involvedObjectField reads involvedObject.<field> from an event map.
func involvedObjectField(ev map[string]interface{}, field string) string {
	if io, ok := ev["involvedObject"].(map[string]interface{}); ok {
		if v, ok := io[field].(string); ok {
			return v
		}
	}
	return ""
}

// compactEventSummary distils a raw events payload into a small summary map:
//
//	{ total_events, warning_count, warning_reasons, top_warnings }
//
// topN controls how many individual top_warnings entries to include.
func compactEventSummary(raw interface{}, topN int) map[string]interface{} {
	items := extractResourceItems(raw)
	total := len(items)
	warningCount := 0
	reasonCount := map[string]int{}

	type warnEntry struct {
		Reason  string `json:"-"`
		Message string
		NS      string
		Object  string
	}
	var warnings []warnEntry

	for _, ev := range items {
		evType := extractEventField(ev, "type")
		reason := extractEventField(ev, "reason")
		if evType == "Warning" {
			warningCount++
			cnt := intFromFloat(ev["count"])
			if cnt < 1 {
				cnt = 1
			}
			reasonCount[reason] += cnt
			warnings = append(warnings, warnEntry{
				Reason:  reason,
				Message: extractEventField(ev, "message"),
				NS:      resourceNamespace(ev),
				Object:  involvedObjectField(ev, "name"),
			})
		}
	}

	// Cap top_warnings
	if topN <= 0 {
		topN = 10
	}
	limit := topN
	if limit > len(warnings) {
		limit = len(warnings)
	}
	topWarnings := make([]map[string]interface{}, 0, limit)
	for _, w := range warnings[:limit] {
		topWarnings = append(topWarnings, map[string]interface{}{
			"reason":  w.Reason,
			"message": w.Message,
			"ns":      w.NS,
			"object":  w.Object,
		})
	}

	return map[string]interface{}{
		"total_events":    total,
		"warning_count":   warningCount,
		"warning_reasons": reasonCount,
		"top_warnings":    topWarnings,
	}
}

// compactNodeSummary returns { node_count, ready_count, nodes_summary }.
func compactNodeSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	readyCount := 0
	summaries := make([]map[string]interface{}, 0, len(items))
	for _, node := range items {
		name := resourceName(node)
		ready := false
		unschedulable := false
		taintsCount := 0

		if spec, ok := node["spec"].(map[string]interface{}); ok {
			if u, ok := spec["unschedulable"].(bool); ok {
				unschedulable = u
			}
			if taints, ok := spec["taints"].([]interface{}); ok {
				taintsCount = len(taints)
			}
		}
		if status, ok := node["status"].(map[string]interface{}); ok {
			if conds, ok := status["conditions"].([]interface{}); ok {
				for _, ci := range conds {
					if cm, ok := ci.(map[string]interface{}); ok {
						if cm["type"] == "Ready" && cm["status"] == "True" {
							ready = true
						}
					}
				}
			}
		}
		if ready {
			readyCount++
		}
		summaries = append(summaries, map[string]interface{}{
			"name":          name,
			"ready":         ready,
			"unschedulable": unschedulable,
			"taints_count":  taintsCount,
		})
	}
	return map[string]interface{}{
		"node_count":    len(items),
		"ready_count":   readyCount,
		"nodes_summary": summaries,
	}
}

// compactPodSummary returns { total_pods, running, pending, failed, namespaces }.
func compactPodSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	running, pending, failed := 0, 0, 0
	nsSet := map[string]struct{}{}
	for _, pod := range items {
		ns := resourceNamespace(pod)
		if ns != "" {
			nsSet[ns] = struct{}{}
		}
		phase := ""
		if status, ok := pod["status"].(map[string]interface{}); ok {
			phase, _ = status["phase"].(string)
		}
		switch phase {
		case "Running":
			running++
		case "Pending":
			pending++
		case "Failed":
			failed++
		}
	}
	nsList := make([]string, 0, len(nsSet))
	for ns := range nsSet {
		nsList = append(nsList, ns)
	}
	return map[string]interface{}{
		"total_pods":  len(items),
		"running":     running,
		"pending":     pending,
		"failed":      failed,
		"namespaces":  nsList,
	}
}

// compactRBACSummary returns rb_count, crb_count, and cluster_admin_bindings names.
func compactRBACSummary(rbsRaw, crbsRaw interface{}) map[string]interface{} {
	rbs := extractResourceItems(rbsRaw)
	crbs := extractResourceItems(crbsRaw)
	clusterAdmins := []string{}
	for _, crb := range crbs {
		roleRef, _ := crb["roleRef"].(map[string]interface{})
		roleName, _ := roleRef["name"].(string)
		if roleName == "cluster-admin" {
			clusterAdmins = append(clusterAdmins, resourceName(crb))
		}
	}
	return map[string]interface{}{
		"rb_count":               len(rbs),
		"crb_count":              len(crbs),
		"cluster_admin_bindings": clusterAdmins,
	}
}

// compactServiceSummary extracts the selector, type, and ports from a service object.
func compactServiceSummary(svc map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{
		"name": resourceName(svc),
		"ns":   resourceNamespace(svc),
	}
	if spec, ok := svc["spec"].(map[string]interface{}); ok {
		out["selector"] = spec["selector"]
		out["type"] = spec["type"]
		out["ports"] = spec["ports"]
	}
	return out
}

// compactNetpolSummary returns {netpol_count, policies:[{name,ns,pod_selector,ingress_count,egress_count}]}.
func compactNetpolSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	policies := make([]map[string]interface{}, 0, len(items))
	for _, np := range items {
		entry := map[string]interface{}{
			"name": resourceName(np),
			"ns":   resourceNamespace(np),
		}
		if spec, ok := np["spec"].(map[string]interface{}); ok {
			entry["pod_selector"] = spec["podSelector"]
			ingressCount := 0
			egressCount := 0
			if ingress, ok := spec["ingress"].([]interface{}); ok {
				ingressCount = len(ingress)
			}
			if egress, ok := spec["egress"].([]interface{}); ok {
				egressCount = len(egress)
			}
			entry["ingress_count"] = ingressCount
			entry["egress_count"] = egressCount
		}
		policies = append(policies, entry)
	}
	return map[string]interface{}{
		"netpol_count": len(items),
		"policies":     policies,
	}
}

// compactPodSecuritySummary returns counts relevant to security posture.
func compactPodSecuritySummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	privileged, root, hostNetwork := 0, 0, 0
	for _, pod := range items {
		spec, _ := pod["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		if hn, ok := spec["hostNetwork"].(bool); ok && hn {
			hostNetwork++
		}
		// Check pod-level security context
		if psc, ok := spec["securityContext"].(map[string]interface{}); ok {
			if runAs, ok := psc["runAsUser"].(float64); ok && runAs == 0 {
				root++
			}
		}
		// Check containers
		if containers, ok := spec["containers"].([]interface{}); ok {
			for _, ci := range containers {
				cm, _ := ci.(map[string]interface{})
				if cm == nil {
					continue
				}
				if sc, ok := cm["securityContext"].(map[string]interface{}); ok {
					if priv, ok := sc["privileged"].(bool); ok && priv {
						privileged++
					}
					if runAs, ok := sc["runAsUser"].(float64); ok && runAs == 0 {
						root++
					}
				}
			}
		}
	}
	return map[string]interface{}{
		"pod_count":        len(items),
		"privileged_count": privileged,
		"root_count":       root,
		"host_network_count": hostNetwork,
	}
}

// compactNetpolNamespaces returns netpol_count and the set of namespaces covered.
func compactNetpolNamespaces(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	nsSet := map[string]struct{}{}
	for _, np := range items {
		ns := resourceNamespace(np)
		if ns != "" {
			nsSet[ns] = struct{}{}
		}
	}
	nsList := make([]string, 0, len(nsSet))
	for ns := range nsSet {
		nsList = append(nsList, ns)
	}
	return map[string]interface{}{
		"netpol_count":       len(items),
		"namespaces_covered": nsList,
	}
}

// compactRBACForSA filters bindings to subjects matching the given service account name.
func compactRBACForSA(rbsRaw, crbsRaw interface{}, sa string) map[string]interface{} {
	rbs := extractResourceItems(rbsRaw)
	crbs := extractResourceItems(crbsRaw)

	type binding struct {
		Name      string `json:"name"`
		Role      string `json:"role"`
		Namespace string `json:"namespace"`
	}

	var saBindings []map[string]interface{}
	clusterAdmin := false

	subjectMatches := func(subjects []interface{}) bool {
		for _, si := range subjects {
			sm, _ := si.(map[string]interface{})
			if sm == nil {
				continue
			}
			name, _ := sm["name"].(string)
			if name == sa {
				return true
			}
		}
		return false
	}

	for _, rb := range rbs {
		subjects, _ := rb["subjects"].([]interface{})
		if !subjectMatches(subjects) {
			continue
		}
		roleRef, _ := rb["roleRef"].(map[string]interface{})
		roleName, _ := roleRef["name"].(string)
		saBindings = append(saBindings, map[string]interface{}{
			"name":      resourceName(rb),
			"role":      roleName,
			"namespace": resourceNamespace(rb),
		})
	}

	for _, crb := range crbs {
		subjects, _ := crb["subjects"].([]interface{})
		if !subjectMatches(subjects) {
			continue
		}
		roleRef, _ := crb["roleRef"].(map[string]interface{})
		roleName, _ := roleRef["name"].(string)
		if roleName == "cluster-admin" {
			clusterAdmin = true
		}
		saBindings = append(saBindings, map[string]interface{}{
			"name":      resourceName(crb),
			"role":      roleName,
			"namespace": "(cluster-wide)",
		})
	}

	return map[string]interface{}{
		"rb_count":        len(rbs),
		"crb_count":       len(crbs),
		"bindings_for_sa": saBindings,
		"cluster_admin":   clusterAdmin,
	}
}

// compactDeploymentSummary returns deployment_count and singleton_count (replicas==1).
func compactDeploymentSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	singletons := 0
	for _, d := range items {
		spec, _ := d["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		replicas := intFromFloat(spec["replicas"])
		if replicas == 1 {
			singletons++
		}
	}
	return map[string]interface{}{
		"deployment_count": len(items),
		"singleton_count":  singletons,
	}
}

// compactPVCSummary returns pvc_count, bound_count, unbound_count.
func compactPVCSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	bound, unbound := 0, 0
	for _, pvc := range items {
		phase := ""
		if status, ok := pvc["status"].(map[string]interface{}); ok {
			phase, _ = status["phase"].(string)
		}
		if phase == "Bound" {
			bound++
		} else {
			unbound++
		}
	}
	return map[string]interface{}{
		"pvc_count":    len(items),
		"bound_count":  bound,
		"unbound_count": unbound,
	}
}

// compactSecretSummary returns secret_count and a type breakdown.
func compactSecretSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	types := map[string]int{}
	for _, s := range items {
		t := ""
		if tp, ok := s["type"].(string); ok {
			t = tp
		}
		if t == "" {
			t = "Opaque"
		}
		types[t]++
	}
	return map[string]interface{}{
		"secret_count": len(items),
		"types":        types,
	}
}

// compactNodeInstanceTypes extracts instance type labels for cost estimation.
func compactNodeInstanceTypes(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	instanceTypes := map[string]int{}
	for _, node := range items {
		meta, _ := node["metadata"].(map[string]interface{})
		if meta == nil {
			continue
		}
		labels, _ := meta["labels"].(map[string]interface{})
		if labels == nil {
			continue
		}
		it := ""
		// Standard K8s labels for instance type
		for _, k := range []string{
			"node.kubernetes.io/instance-type",
			"beta.kubernetes.io/instance-type",
		} {
			if v, ok := labels[k].(string); ok && v != "" {
				it = v
				break
			}
		}
		if it == "" {
			it = "unknown"
		}
		instanceTypes[it]++
	}
	return map[string]interface{}{
		"node_count":     len(items),
		"instance_types": instanceTypes,
	}
}

// compactPVSummary returns pv_count, total_storage_gi, and released_pv_count.
func compactPVSummary(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	totalGi := 0
	released := 0
	for _, pv := range items {
		phase := ""
		if status, ok := pv["status"].(map[string]interface{}); ok {
			phase, _ = status["phase"].(string)
		}
		if phase == "Released" {
			released++
		}
		// Extract storage from spec.capacity.storage (e.g. "10Gi")
		if spec, ok := pv["spec"].(map[string]interface{}); ok {
			if cap, ok := spec["capacity"].(map[string]interface{}); ok {
				if storage, ok := cap["storage"].(string); ok {
					gi := parseStorageGi(storage)
					totalGi += gi
				}
			}
		}
	}
	return map[string]interface{}{
		"pv_count":         len(items),
		"total_storage_gi": totalGi,
		"released_pv_count": released,
	}
}

// parseStorageGi parses a Kubernetes quantity string like "10Gi" or "500Mi" into GiB.
func parseStorageGi(s string) int {
	if len(s) == 0 {
		return 0
	}
	// Simple parser: handle Gi and Mi only
	if len(s) > 2 && s[len(s)-2:] == "Gi" {
		n := 0
		fmt.Sscanf(s[:len(s)-2], "%d", &n)
		return n
	}
	if len(s) > 2 && s[len(s)-2:] == "Mi" {
		n := 0
		fmt.Sscanf(s[:len(s)-2], "%d", &n)
		return n / 1024
	}
	return 0
}

// compactPodByNamespace returns pod_count and a per-namespace breakdown.
func compactPodByNamespace(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	byNS := map[string]int{}
	for _, pod := range items {
		ns := resourceNamespace(pod)
		byNS[ns]++
	}
	return map[string]interface{}{
		"pod_count":    len(items),
		"by_namespace": byNS,
	}
}

// compactPodLabels returns a compact pod list with just name, ns, and labels (top 20).
func compactPodLabels(raw interface{}) map[string]interface{} {
	items := extractResourceItems(raw)
	limit := 20
	if limit > len(items) {
		limit = len(items)
	}
	summaries := make([]map[string]interface{}, 0, limit)
	for _, pod := range items[:limit] {
		entry := map[string]interface{}{
			"name": resourceName(pod),
			"ns":   resourceNamespace(pod),
		}
		if meta, ok := pod["metadata"].(map[string]interface{}); ok {
			entry["labels"] = meta["labels"]
		}
		summaries = append(summaries, entry)
	}
	return map[string]interface{}{
		"pod_count":    len(items),
		"pod_summaries": summaries,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

func (s *mcpServerImpl) routeNarrateTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, bool, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, true, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)
	base := map[string]interface{}{"tool": name, "cluster_id": clusterID}

	switch name {

	// ── narrate_incident_timeline ────────────────────────────────────────────
	case "narrate_incident_timeline":
		window := intArg(args, "window_minutes", 60)
		var rawEv interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, fmt.Sprintf("/events?limit=500&window_minutes=%d", window)), &rawEv)
		base["data_summary"] = compactEventSummary(rawEv, 10)
		base["window_minutes"] = window
		base["narrative_prompt"] = "Write a Slack-ready chronological incident summary from the events above. Group related events. Highlight the first 'Warning' reason. Under 300 words."

	// ── narrate_deploy_diff ──────────────────────────────────────────────────
	case "narrate_deploy_diff":
		ns := strArg(args, "namespace")
		depName := strArg(args, "deployment")
		if ns == "" || depName == "" {
			return nil, true, fmt.Errorf("narrate_deploy_diff: namespace and deployment required")
		}
		var hist map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(ns)+"/"+url.PathEscape(depName)+"/rollout-history"), &hist)
		base["deployment"] = depName
		base["namespace"] = ns
		base["rollout_history"] = hist
		// Count revisions for extra context
		if hist != nil {
			if revisions, ok := hist["revisions"].([]interface{}); ok {
				base["revision_count"] = len(revisions)
			} else {
				base["revision_count"] = len(hist)
			}
		}
		base["narrative_prompt"] = "From the rollout history, describe what changed between the two most recent revisions and the likely user-visible impact. Prefer concrete language over jargon."
		base["advisory_only"] = true

	// ── narrate_weekly_status ────────────────────────────────────────────────
	case "narrate_weekly_status":
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		var rawEvents interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/events?limit=500"), &rawEvents)
		evSummary := compactEventSummary(rawEvents, 5)
		base["overview"] = overview // already compact from /overview endpoint
		base["data_summary"] = evSummary
		base["narrative_prompt"] = "Write an exec-friendly weekly status: health headline, top three changes, top three issues, call-outs. No bullet-point salad — use sentences and one metric per paragraph."

	// ── narrate_onboarding_for_user ──────────────────────────────────────────
	case "narrate_onboarding_for_user":
		sa := strArg(args, "service_account")
		if sa == "" {
			return nil, true, fmt.Errorf("narrate_onboarding_for_user: service_account required")
		}
		var rbsRaw, crbsRaw interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rbsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crbsRaw)
		base["service_account"] = sa
		base["data_summary"] = compactRBACForSA(rbsRaw, crbsRaw, sa)
		base["narrative_prompt"] = "Summarize what this service account can touch: roles bound, resources + verbs covered, namespaces reached. Flag cluster-admin or wildcard grants."

	// ── narrate_service_dependency_graph ────────────────────────────────────
	case "narrate_service_dependency_graph":
		svcName := strArg(args, "service")
		ns := strArg(args, "namespace")
		if svcName == "" || ns == "" {
			return nil, true, fmt.Errorf("narrate_service_dependency_graph: service and namespace required")
		}
		var svcRaw map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(ns)+"/"+url.PathEscape(svcName)), &svcRaw)
		var podsRaw, netpolsRaw interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &podsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &netpolsRaw)
		base["data_summary"] = map[string]interface{}{
			"service":         compactServiceSummary(svcRaw),
			"pods":            compactPodLabels(podsRaw),
			"network_policies": compactNetpolSummary(netpolsRaw),
		}
		base["narrative_prompt"] = "Describe the upstream/downstream dependency chain in plain English — who calls this service, who it depends on, which policies gate each edge."

	// ── narrate_capacity_report ──────────────────────────────────────────────
	case "narrate_capacity_report":
		var nodesRaw, podsRaw interface{}
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodesRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &podsRaw)
		base["data_summary"] = map[string]interface{}{
			"nodes":          compactNodeSummary(nodesRaw),
			"pods":           compactPodByNamespace(podsRaw),
			"metrics_summary": metrics, // already compact
		}
		base["narrative_prompt"] = "Cluster-wide capacity report. Call out per-node utilization, headroom, and whether adding workload X would fit. Include one sentence on trend direction."

	// ── narrate_cost_report ──────────────────────────────────────────────────
	case "narrate_cost_report":
		period := strArg(args, "period")
		if period == "" {
			period = "weekly"
		}
		var nodesRaw, pvsRaw interface{}
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodesRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		base["period"] = period
		base["data_summary"] = map[string]interface{}{
			"nodes":           compactNodeInstanceTypes(nodesRaw),
			"persistent_volumes": compactPVSummary(pvsRaw),
			"metrics_summary": metrics, // already compact
		}
		base["narrative_prompt"] = "Estimate cost breakdown by namespace or workload using the metrics + node counts. Flag the biggest driver + biggest cut opportunity. Explicitly note this is an approximation if no pricing data is attached."

	// ── narrate_security_posture ─────────────────────────────────────────────
	case "narrate_security_posture":
		var podsRaw, netpolsRaw, rbsRaw, crbsRaw interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &podsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &netpolsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rbsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crbsRaw)
		rbac := compactRBACSummary(rbsRaw, crbsRaw)
		base["data_summary"] = map[string]interface{}{
			"pods":            compactPodSecuritySummary(podsRaw),
			"network_policies": compactNetpolNamespaces(netpolsRaw),
			"rbac":            rbac,
		}
		base["narrative_prompt"] = "CISO-ready security posture summary. Score each of: pod security hygiene, network-policy coverage, RBAC least-privilege, secret hygiene. One paragraph per area, one recommended next step per area."

	// ── narrate_migration_readiness ──────────────────────────────────────────
	case "narrate_migration_readiness":
		srcNs := strArg(args, "source_namespace")
		destCluster := strArg(args, "destination_cluster")
		if srcNs == "" {
			return nil, true, fmt.Errorf("narrate_migration_readiness: source_namespace required")
		}
		var deploysRaw, pvcsRaw, configmapsRaw, secretsRaw interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments?namespace="+url.QueryEscape(srcNs)), &deploysRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pvcs?namespace="+url.QueryEscape(srcNs)), &pvcsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/configmaps?namespace="+url.QueryEscape(srcNs)), &configmapsRaw)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets?namespace="+url.QueryEscape(srcNs)), &secretsRaw)
		base["source_namespace"] = srcNs
		base["destination_cluster"] = destCluster
		base["data_summary"] = map[string]interface{}{
			"deployments": compactDeploymentSummary(deploysRaw),
			"pvcs":        compactPVCSummary(pvcsRaw),
			"configmaps":  map[string]interface{}{"configmap_count": len(extractResourceItems(configmapsRaw))},
			"secrets":     compactSecretSummary(secretsRaw),
		}
		base["narrative_prompt"] = "Migration-readiness brief: workloads to move, stateful data (PVCs), config to replicate (ConfigMaps/Secrets), and known risks (singletons, hostPath, cross-ns references)."

	// ── narrate_change_impact ────────────────────────────────────────────────
	case "narrate_change_impact":
		whatIf := strArg(args, "what_if")
		if whatIf == "" {
			return nil, true, fmt.Errorf("narrate_change_impact: what_if required")
		}
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		base["what_if"] = whatIf
		base["cluster_overview"] = overview // already compact from /overview endpoint
		base["narrative_prompt"] = "Given the hypothetical change described in what_if, reason step-by-step about first-order + second-order effects on the cluster state. Be explicit about assumptions."

	default:
		return nil, false, nil
	}
	return base, true, nil
}
