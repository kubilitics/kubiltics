package server

// handlers_narrate.go — Phase 3 Category 5 narrative/storytelling tools.
//
// Ten narrate_* tools that gather scoped data + emit a
// `narrative_prompt` field the LLM uses to produce a human-ready summary.
// Returned via routeAnalysisTool's default delegate.

import (
	"context"
	"fmt"
	"net/url"
)

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
	case "narrate_incident_timeline":
		window := intArg(args, "window_minutes", 60)
		var rawEv interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, fmt.Sprintf("/events?limit=500&window_minutes=%d", window)), &rawEv)
		base["events"] = rawEv
		base["window_minutes"] = window
		base["narrative_prompt"] = "Write a Slack-ready chronological incident summary from the events above. Group related events. Highlight the first 'Warning' reason. Under 300 words."

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
		base["narrative_prompt"] = "From the rollout history, describe what changed between the two most recent revisions and the likely user-visible impact. Prefer concrete language over jargon."

	case "narrate_weekly_status":
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		var events interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/events?limit=500"), &events)
		base["overview"] = overview
		base["events"] = events
		base["narrative_prompt"] = "Write an exec-friendly weekly status: health headline, top three changes, top three issues, call-outs. No bullet-point salad — use sentences and one metric per paragraph."

	case "narrate_onboarding_for_user":
		sa := strArg(args, "service_account")
		if sa == "" {
			return nil, true, fmt.Errorf("narrate_onboarding_for_user: service_account required")
		}
		var rbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rbs)
		var crbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crbs)
		base["service_account"] = sa
		base["role_bindings"] = rbs
		base["cluster_role_bindings"] = crbs
		base["narrative_prompt"] = "Summarize what this service account can touch: roles bound, resources + verbs covered, namespaces reached. Flag cluster-admin or wildcard grants."

	case "narrate_service_dependency_graph":
		svcName := strArg(args, "service")
		ns := strArg(args, "namespace")
		if svcName == "" || ns == "" {
			return nil, true, fmt.Errorf("narrate_service_dependency_graph: service and namespace required")
		}
		var svc map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(ns)+"/"+url.PathEscape(svcName)), &svc)
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		var netpols map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &netpols)
		base["service"] = svc
		base["pods"] = pods
		base["network_policies"] = netpols
		base["narrative_prompt"] = "Describe the upstream/downstream dependency chain in plain English — who calls this service, who it depends on, which policies gate each edge."

	case "narrate_capacity_report":
		var nodes, metrics, pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		base["nodes"] = nodes
		base["metrics_summary"] = metrics
		base["pods"] = pods
		base["narrative_prompt"] = "Cluster-wide capacity report. Call out per-node utilization, headroom, and whether adding workload X would fit. Include one sentence on trend direction."

	case "narrate_cost_report":
		period := strArg(args, "period")
		if period == "" {
			period = "weekly"
		}
		var nodes, pvs, metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		base["period"] = period
		base["nodes"] = nodes
		base["persistent_volumes"] = pvs
		base["metrics_summary"] = metrics
		base["narrative_prompt"] = "Estimate cost breakdown by namespace or workload using the metrics + node counts. Flag the biggest driver + biggest cut opportunity. Explicitly note this is an approximation if no pricing data is attached."

	case "narrate_security_posture":
		var pods, netpols, rbs, crbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &netpols)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rbs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crbs)
		base["pods"] = pods
		base["network_policies"] = netpols
		base["role_bindings"] = rbs
		base["cluster_role_bindings"] = crbs
		base["narrative_prompt"] = "CISO-ready security posture summary. Score each of: pod security hygiene, network-policy coverage, RBAC least-privilege, secret hygiene. One paragraph per area, one recommended next step per area."

	case "narrate_migration_readiness":
		srcNs := strArg(args, "source_namespace")
		destCluster := strArg(args, "destination_cluster")
		if srcNs == "" {
			return nil, true, fmt.Errorf("narrate_migration_readiness: source_namespace required")
		}
		var deploys, pvcs, configmaps, secrets map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments?namespace="+url.QueryEscape(srcNs)), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pvcs?namespace="+url.QueryEscape(srcNs)), &pvcs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/configmaps?namespace="+url.QueryEscape(srcNs)), &configmaps)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets?namespace="+url.QueryEscape(srcNs)), &secrets)
		base["source_namespace"] = srcNs
		base["destination_cluster"] = destCluster
		base["deployments"] = deploys
		base["pvcs"] = pvcs
		base["configmaps"] = configmaps
		base["secrets"] = secrets
		base["narrative_prompt"] = "Migration-readiness brief: workloads to move, stateful data (PVCs), config to replicate (ConfigMaps/Secrets), and known risks (singletons, hostPath, cross-ns references)."

	case "narrate_change_impact":
		whatIf := strArg(args, "what_if")
		if whatIf == "" {
			return nil, true, fmt.Errorf("narrate_change_impact: what_if required")
		}
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		base["what_if"] = whatIf
		base["cluster_overview"] = overview
		base["narrative_prompt"] = "Given the hypothetical change described in what_if, reason step-by-step about first-order + second-order effects on the cluster state. Be explicit about assumptions."

	default:
		return nil, false, nil
	}
	return base, true, nil
}
