package server

// handlers_plan.go — Phase 3 Category 3 planning tools.
//
// Ten "what would happen if?" planners. Each gathers the raw data
// (current state snapshot + constraints) and emits a `planning_hint`
// that steers the LLM toward the right recommendation. Lightweight by
// design — the real planning logic lives in the LLM's reasoning over
// the data we surface. Matches the existing routeRecommendationTool
// pattern (gather → hint) so we route through it.

import (
	"context"
	"fmt"
)

// fillPlanSlot handles a single plan_* tool inside routeRecommendationTool.
// Called from the default branch; returns (result, true) when it matched.
func (s *mcpServerImpl) fillPlanSlot(ctx context.Context, name string, clusterID, qs string, base map[string]interface{}) (interface{}, bool, error) {
	c := s.http()
	switch name {
	case "plan_scale_deployment":
		var deploys, metrics, hpa map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa)
		base["deployments"] = deploys
		base["metrics_summary"] = metrics
		base["hpas"] = hpa
		base["planning_hint"] = "Compare actual CPU/memory utilization in metrics_summary against each deployment's replicas × requests. Recommend replica count that puts utilization in the 60-75% band. Flag deployments already at HPA maxReplicas as scale-limited."

	case "plan_drain_node":
		var nodes, pods, pdbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets"+qs), &pdbs)
		base["nodes"] = nodes
		base["pods"] = pods
		base["pdbs"] = pdbs
		base["planning_hint"] = "For the target node, list pods that would evict, cross-check against PodDisruptionBudgets, and identify singletons (deployment replicas=1 without PDB). Estimate other-node capacity to accept evictees."

	case "plan_rollout_safety":
		var deploys, svcs, hpa map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa)
		base["deployments"] = deploys
		base["services"] = svcs
		base["hpas"] = hpa
		base["planning_hint"] = "Rank the deployment's blast radius by: number of Services that select its pods × downstream dependencies × whether HPA is at floor. Recommend rolling strategy (maxSurge/maxUnavailable), canary %, and pre-flight checks."

	case "plan_cost_reduction":
		var nodes, pvs, metrics, pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		base["nodes"] = nodes
		base["persistent_volumes"] = pvs
		base["metrics_summary"] = metrics
		base["pods"] = pods
		base["planning_hint"] = "Find: idle nodes (<20% utilization), Released-phase PVs, over-replicated Deployments with low traffic, and containers whose requests exceed actual use by >2x. Estimate $/month savings per recommendation."

	case "plan_ha_upgrade":
		var deploys, sts, pdbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &sts)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets"+qs), &pdbs)
		base["deployments"] = deploys
		base["statefulsets"] = sts
		base["pdbs"] = pdbs
		base["planning_hint"] = "Identify singletons (replicas=1 without PDB, no anti-affinity). Recommend minReplicas=2 + topologySpreadConstraints + PDB minAvailable=1 for each, prioritized by criticality labels."

	case "plan_resource_quota":
		var ns, pods, metrics, existingQuota map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces"), &ns)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/resourcequotas"+qs), &existingQuota)
		base["namespaces"] = ns
		base["pods"] = pods
		base["metrics_summary"] = metrics
		base["existing_quotas"] = existingQuota
		base["planning_hint"] = "For namespaces without a ResourceQuota, suggest one at 1.5x current observed usage (CPU, memory, pod count, PVC count). Flag namespaces whose current usage already exceeds p95 of cluster peer namespaces."

	case "plan_psa_enforcement":
		var ns, pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces"), &ns)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		base["namespaces"] = ns
		base["pods"] = pods
		base["planning_hint"] = "Check each namespace's pods for pod-security violations: privileged, hostNetwork/hostPID/hostIPC, runAsUser=0, writable root fs, CAP_SYS_ADMIN. Namespaces where zero pods violate → safe to label pod-security.kubernetes.io/enforce=restricted."

	case "plan_image_pull_secrets":
		var pods, secrets map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets"+qs), &secrets)
		base["pods"] = pods
		base["secrets"] = secrets
		base["planning_hint"] = "List dockerconfigjson-type secrets used as imagePullSecrets. Group by image registry host. When multiple namespaces have identical content, recommend consolidation via a centralized secret + RBAC replication pattern."

	case "plan_backup_coverage":
		var pvcs, deploys, sts map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pvcs"+qs), &pvcs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &sts)
		base["pvcs"] = pvcs
		base["deployments"] = deploys
		base["statefulsets"] = sts
		base["planning_hint"] = "Workloads with PVCs but no `backup=true` label (or similar convention) are at risk. Recommend adding Velero/Stash annotations + daily snapshot schedule. Prioritize StatefulSets over Deployments."

	case "plan_pdb_coverage":
		var deploys, sts, pdbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &sts)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets"+qs), &pdbs)
		base["deployments"] = deploys
		base["statefulsets"] = sts
		base["pdbs"] = pdbs
		base["planning_hint"] = "Deployments with replicas >= 2 and no PDB whose label selector matches → suggest PDB minAvailable=1 (or 50%% for replicas >= 4). Skip ones with replicas=1 (document as risk instead)."

	default:
		return nil, false, nil
	}

	return base, true, nil
}

// handlePlanRoute is the dispatcher entry point used by routeRecommendationTool
// to check if a name is a plan_* tool before falling through.
func (s *mcpServerImpl) handlePlanRoute(ctx context.Context, name string, args map[string]interface{}) (interface{}, bool, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, true, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)
	base := map[string]interface{}{"tool": name, "cluster_id": clusterID}
	out, matched, err := s.fillPlanSlot(ctx, name, clusterID, qs, base)
	if !matched {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, fmt.Errorf("plan %s: %w", name, err)
	}
	return out, true, nil
}
