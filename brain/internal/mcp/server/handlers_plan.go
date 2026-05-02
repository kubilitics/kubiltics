package server

// handlers_plan.go — Phase 3 Category 3 planning tools.
//
// Ten "what would happen if?" planners. Each gathers the raw data
// (current state snapshot + constraints), extracts compact summaries
// (never raw K8s objects), and emits a `planning_hint` that steers the
// LLM toward the right recommendation. Lightweight by design — the real
// planning logic lives in the LLM's reasoning over the data we surface.
// Matches the existing routeRecommendationTool pattern (gather → hint).

import (
	"context"
	"fmt"
)

// fillPlanSlot handles a single plan_* tool inside routeRecommendationTool.
// Called from the default branch; returns (result, true) when it matched.
func (s *mcpServerImpl) fillPlanSlot(ctx context.Context, name string, clusterID, qs string, base map[string]interface{}) (interface{}, bool, error) {
	c := s.http()
	switch name {

	// ------------------------------------------------------------------ //
	case "plan_scale_deployment":
		var deploys, hpa map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa)

		// Build set of deployment names covered by an HPA.
		hpaTargets := map[string]bool{}
		for _, h := range extractResourceItems(hpa) {
			spec, _ := h["spec"].(map[string]interface{})
			ref, _ := spec["scaleTargetRef"].(map[string]interface{})
			if n, _ := ref["name"].(string); n != "" {
				hpaTargets[n] = true
			}
		}

		type depSummary struct {
			Name     string `json:"name"`
			NS       string `json:"namespace"`
			Replicas int    `json:"replicas"`
			Ready    int    `json:"ready"`
			HasHPA   bool   `json:"has_hpa"`
		}
		var summaries []map[string]interface{}
		for _, m := range extractResourceItems(deploys) {
			ns := resourceNamespace(m)
			n := resourceName(m)
			spec, _ := m["spec"].(map[string]interface{})
			status, _ := m["status"].(map[string]interface{})
			replicas := intFromFloat(spec["replicas"])
			ready := intFromFloat(status["readyReplicas"])
			summaries = append(summaries, map[string]interface{}{
				"name":      n,
				"namespace": ns,
				"replicas":  replicas,
				"ready":     ready,
				"has_hpa":   hpaTargets[n],
			})
		}
		if summaries == nil {
			summaries = []map[string]interface{}{}
		}
		base["deployment_count"] = len(summaries)
		base["deployment_summaries"] = summaries
		base["planning_hint"] = "Compare actual CPU/memory utilization in metrics_summary against each deployment's replicas × requests. Recommend replica count that puts utilization in the 60-75% band. Flag deployments already at HPA maxReplicas as scale-limited."

	// ------------------------------------------------------------------ //
	case "plan_drain_node":
		var nodes, pods, pdbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets"+qs), &pdbs)

		// Build set of namespaces that have at least one PDB.
		pdbNS := map[string]bool{}
		for _, p := range extractResourceItems(pdbs) {
			pdbNS[resourceNamespace(p)] = true
		}

		// Find singleton deployments (replicas=1) in namespaces without a PDB.
		var singletons []map[string]interface{}
		for _, p := range extractResourceItems(pods) {
			meta, _ := p["metadata"].(map[string]interface{})
			owners, _ := meta["ownerReferences"].([]interface{})
			ns := resourceNamespace(p)
			n := resourceName(p)
			for _, o := range owners {
				om, _ := o.(map[string]interface{})
				kind, _ := om["kind"].(string)
				if kind == "ReplicaSet" && !pdbNS[ns] {
					singletons = append(singletons, map[string]interface{}{
						"name":      n,
						"namespace": ns,
					})
					break
				}
			}
		}
		if singletons == nil {
			singletons = []map[string]interface{}{}
		}
		base["node_count"] = len(extractResourceItems(nodes))
		base["pod_count"] = len(extractResourceItems(pods))
		base["pdb_count"] = len(extractResourceItems(pdbs))
		base["singleton_deployments"] = singletons
		base["planning_hint"] = "For the target node, list pods that would evict, cross-check against PodDisruptionBudgets, and identify singletons (deployment replicas=1 without PDB). Estimate other-node capacity to accept evictees."

	// ------------------------------------------------------------------ //
	case "plan_rollout_safety":
		var deploys, svcs, hpa map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa)

		hpaTargets := map[string]bool{}
		for _, h := range extractResourceItems(hpa) {
			spec, _ := h["spec"].(map[string]interface{})
			ref, _ := spec["scaleTargetRef"].(map[string]interface{})
			if n, _ := ref["name"].(string); n != "" {
				hpaTargets[n] = true
			}
		}

		var noHPA []map[string]interface{}
		for _, m := range extractResourceItems(deploys) {
			n := resourceName(m)
			if !hpaTargets[n] {
				spec, _ := m["spec"].(map[string]interface{})
				replicas := intFromFloat(spec["replicas"])
				noHPA = append(noHPA, map[string]interface{}{
					"name":      n,
					"namespace": resourceNamespace(m),
					"replicas":  replicas,
				})
			}
		}
		if noHPA == nil {
			noHPA = []map[string]interface{}{}
		}
		base["deployment_count"] = len(extractResourceItems(deploys))
		base["service_count"] = len(extractResourceItems(svcs))
		base["hpa_count"] = len(extractResourceItems(hpa))
		base["deployments_without_hpa"] = noHPA
		base["planning_hint"] = "Rank the deployment's blast radius by: number of Services that select its pods × downstream dependencies × whether HPA is at floor. Recommend rolling strategy (maxSurge/maxUnavailable), canary %, and pre-flight checks."

	// ------------------------------------------------------------------ //
	case "plan_cost_reduction":
		var nodes, pvs, pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)

		// Released-phase PVs.
		var releasedPVs []map[string]interface{}
		for _, pv := range extractResourceItems(pvs) {
			status, _ := pv["status"].(map[string]interface{})
			phase, _ := status["phase"].(string)
			if phase == "Released" {
				spec, _ := pv["spec"].(map[string]interface{})
				sc, _ := spec["storageClassName"].(string)
				releasedPVs = append(releasedPVs, map[string]interface{}{
					"name":         resourceName(pv),
					"storageClass": sc,
				})
			}
		}
		if releasedPVs == nil {
			releasedPVs = []map[string]interface{}{}
		}

		// Pods with containers missing resource limits.
		podsNoLimits := 0
		for _, pod := range extractResourceItems(pods) {
			spec, _ := pod["spec"].(map[string]interface{})
			containers, _ := spec["containers"].([]interface{})
			missing := false
			for _, cont := range containers {
				cm, ok := cont.(map[string]interface{})
				if !ok {
					continue
				}
				res, _ := cm["resources"].(map[string]interface{})
				limits, hasLimits := res["limits"].(map[string]interface{})
				if !hasLimits || len(limits) == 0 {
					missing = true
					break
				}
			}
			if missing {
				podsNoLimits++
			}
		}

		base["node_count"] = len(extractResourceItems(nodes))
		base["pv_count"] = len(extractResourceItems(pvs))
		base["pod_count"] = len(extractResourceItems(pods))
		base["released_pvs"] = releasedPVs
		base["pods_no_limits"] = podsNoLimits
		base["planning_hint"] = "Find: idle nodes (<20% utilization), Released-phase PVs, over-replicated Deployments with low traffic, and containers whose requests exceed actual use by >2x. Estimate $/month savings per recommendation."

	// ------------------------------------------------------------------ //
	case "plan_ha_upgrade":
		var deploys, sts, pdbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &sts)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets"+qs), &pdbs)

		// Build set of namespaces that have at least one PDB (proxy for coverage).
		pdbNS := map[string]bool{}
		for _, p := range extractResourceItems(pdbs) {
			pdbNS[resourceNamespace(p)] = true
		}

		var singletons []map[string]interface{}
		for _, m := range extractResourceItems(deploys) {
			spec, _ := m["spec"].(map[string]interface{})
			if intFromFloat(spec["replicas"]) <= 1 {
				singletons = append(singletons, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": resourceNamespace(m),
					"kind":      "Deployment",
				})
			}
		}
		for _, m := range extractResourceItems(sts) {
			spec, _ := m["spec"].(map[string]interface{})
			if intFromFloat(spec["replicas"]) <= 1 {
				singletons = append(singletons, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": resourceNamespace(m),
					"kind":      "StatefulSet",
				})
			}
		}
		if singletons == nil {
			singletons = []map[string]interface{}{}
		}

		var deplsNoPDB []map[string]interface{}
		for _, m := range extractResourceItems(deploys) {
			ns := resourceNamespace(m)
			if !pdbNS[ns] {
				deplsNoPDB = append(deplsNoPDB, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": ns,
				})
			}
		}
		if deplsNoPDB == nil {
			deplsNoPDB = []map[string]interface{}{}
		}

		base["deployment_count"] = len(extractResourceItems(deploys))
		base["statefulset_count"] = len(extractResourceItems(sts))
		base["pdb_count"] = len(extractResourceItems(pdbs))
		base["singletons"] = singletons
		base["deployments_without_pdb"] = deplsNoPDB
		base["planning_hint"] = "Identify singletons (replicas=1 without PDB, no anti-affinity). Recommend minReplicas=2 + topologySpreadConstraints + PDB minAvailable=1 for each, prioritized by criticality labels."

	// ------------------------------------------------------------------ //
	case "plan_resource_quota":
		var nsData, pods, existingQuota map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces"), &nsData)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/resourcequotas"+qs), &existingQuota)

		// Build set of namespaces that already have a ResourceQuota.
		quotaNS := map[string]bool{}
		for _, q := range extractResourceItems(existingQuota) {
			quotaNS[resourceNamespace(q)] = true
		}

		var nsNoQuota []string
		for _, ns := range extractResourceItems(nsData) {
			n := resourceName(ns)
			if !quotaNS[n] {
				nsNoQuota = append(nsNoQuota, n)
			}
		}
		if nsNoQuota == nil {
			nsNoQuota = []string{}
		}

		base["namespace_count"] = len(extractResourceItems(nsData))
		base["pod_count"] = len(extractResourceItems(pods))
		base["namespaces_without_quota"] = nsNoQuota
		base["planning_hint"] = "For namespaces without a ResourceQuota, suggest one at 1.5x current observed usage (CPU, memory, pod count, PVC count). Flag namespaces whose current usage already exceeds p95 of cluster peer namespaces."

	// ------------------------------------------------------------------ //
	case "plan_psa_enforcement":
		var nsData, pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces"), &nsData)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)

		privilegedCount := 0
		violatingNS := map[string]bool{}
		for _, pod := range extractResourceItems(pods) {
			ns := resourceNamespace(pod)
			spec, _ := pod["spec"].(map[string]interface{})
			// Check pod-level security context.
			podSC, _ := spec["securityContext"].(map[string]interface{})
			runAsRoot := false
			if uid, ok := podSC["runAsUser"].(float64); ok && uid == 0 {
				runAsRoot = true
			}
			// Check container-level security contexts.
			containers, _ := spec["containers"].([]interface{})
			for _, cont := range containers {
				cm, ok := cont.(map[string]interface{})
				if !ok {
					continue
				}
				sc, _ := cm["securityContext"].(map[string]interface{})
				privileged, _ := sc["privileged"].(bool)
				if uid, ok := sc["runAsUser"].(float64); ok && uid == 0 {
					runAsRoot = true
				}
				if privileged || runAsRoot {
					privilegedCount++
					violatingNS[ns] = true
					break
				}
			}
			if runAsRoot {
				violatingNS[ns] = true
			}
		}

		nsViolations := make([]string, 0, len(violatingNS))
		for ns := range violatingNS {
			nsViolations = append(nsViolations, ns)
		}

		base["namespace_count"] = len(extractResourceItems(nsData))
		base["pod_count"] = len(extractResourceItems(pods))
		base["privileged_pod_count"] = privilegedCount
		base["namespaces_with_violations"] = nsViolations
		base["planning_hint"] = "Check each namespace's pods for pod-security violations: privileged, hostNetwork/hostPID/hostIPC, runAsUser=0, writable root fs, CAP_SYS_ADMIN. Namespaces where zero pods violate → safe to label pod-security.kubernetes.io/enforce=restricted."

	// ------------------------------------------------------------------ //
	case "plan_image_pull_secrets":
		var pods, secrets map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets"+qs), &secrets)

		// Count dockerconfigjson secrets.
		pullSecretCount := 0
		for _, sec := range extractResourceItems(secrets) {
			tp, _ := sec["type"].(string)
			if tp == "kubernetes.io/dockerconfigjson" {
				pullSecretCount++
			}
		}

		// Pods where no imagePullSecrets are configured.
		var podsNoPull []map[string]interface{}
		for _, pod := range extractResourceItems(pods) {
			spec, _ := pod["spec"].(map[string]interface{})
			ips, _ := spec["imagePullSecrets"].([]interface{})
			if len(ips) == 0 {
				podsNoPull = append(podsNoPull, map[string]interface{}{
					"name":      resourceName(pod),
					"namespace": resourceNamespace(pod),
				})
			}
		}
		if podsNoPull == nil {
			podsNoPull = []map[string]interface{}{}
		}

		base["pod_count"] = len(extractResourceItems(pods))
		base["pull_secret_count"] = pullSecretCount
		base["pods_without_pull_secrets"] = podsNoPull
		base["planning_hint"] = "List dockerconfigjson-type secrets used as imagePullSecrets. Group by image registry host. When multiple namespaces have identical content, recommend consolidation via a centralized secret + RBAC replication pattern."

	// ------------------------------------------------------------------ //
	case "plan_backup_coverage":
		var pvcs, deploys, sts map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pvcs"+qs), &pvcs)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &sts)

		// Find StatefulSets with PVC volume mounts.
		var stsPVCs []map[string]interface{}
		for _, m := range extractResourceItems(sts) {
			spec, _ := m["spec"].(map[string]interface{})
			vcts, _ := spec["volumeClaimTemplates"].([]interface{})
			podSpec, _ := spec["template"].(map[string]interface{})
			podSpecInner, _ := podSpec["spec"].(map[string]interface{})
			vols, _ := podSpecInner["volumes"].([]interface{})
			hasPVC := len(vcts) > 0
			for _, v := range vols {
				vm, _ := v.(map[string]interface{})
				if _, ok := vm["persistentVolumeClaim"]; ok {
					hasPVC = true
					break
				}
			}
			if hasPVC {
				stsPVCs = append(stsPVCs, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": resourceNamespace(m),
				})
			}
		}
		if stsPVCs == nil {
			stsPVCs = []map[string]interface{}{}
		}

		// Find Deployments with PVC volumes.
		var depPVCs []map[string]interface{}
		for _, m := range extractResourceItems(deploys) {
			spec, _ := m["spec"].(map[string]interface{})
			podTpl, _ := spec["template"].(map[string]interface{})
			podSpec, _ := podTpl["spec"].(map[string]interface{})
			vols, _ := podSpec["volumes"].([]interface{})
			hasPVC := false
			for _, v := range vols {
				vm, _ := v.(map[string]interface{})
				if _, ok := vm["persistentVolumeClaim"]; ok {
					hasPVC = true
					break
				}
			}
			if hasPVC {
				depPVCs = append(depPVCs, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": resourceNamespace(m),
				})
			}
		}
		if depPVCs == nil {
			depPVCs = []map[string]interface{}{}
		}

		base["pvc_count"] = len(extractResourceItems(pvcs))
		base["deployment_count"] = len(extractResourceItems(deploys))
		base["statefulset_count"] = len(extractResourceItems(sts))
		base["statefulsets_with_pvcs"] = stsPVCs
		base["deployments_with_pvcs"] = depPVCs
		base["planning_hint"] = "Workloads with PVCs but no `backup=true` label (or similar convention) are at risk. Recommend adding Velero/Stash annotations + daily snapshot schedule. Prioritize StatefulSets over Deployments."

	// ------------------------------------------------------------------ //
	case "plan_pdb_coverage":
		var deploys, sts, pdbs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &sts)
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets"+qs), &pdbs)

		// Proxy: namespaces that have at least one PDB.
		pdbNS := map[string]bool{}
		for _, p := range extractResourceItems(pdbs) {
			pdbNS[resourceNamespace(p)] = true
		}

		var deplsNoPDB []map[string]interface{}
		for _, m := range extractResourceItems(deploys) {
			spec, _ := m["spec"].(map[string]interface{})
			replicas := intFromFloat(spec["replicas"])
			ns := resourceNamespace(m)
			if replicas >= 2 && !pdbNS[ns] {
				deplsNoPDB = append(deplsNoPDB, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": ns,
					"replicas":  replicas,
				})
			}
		}
		if deplsNoPDB == nil {
			deplsNoPDB = []map[string]interface{}{}
		}

		var stsNoPDB []map[string]interface{}
		for _, m := range extractResourceItems(sts) {
			spec, _ := m["spec"].(map[string]interface{})
			replicas := intFromFloat(spec["replicas"])
			ns := resourceNamespace(m)
			if replicas >= 2 && !pdbNS[ns] {
				stsNoPDB = append(stsNoPDB, map[string]interface{}{
					"name":      resourceName(m),
					"namespace": ns,
					"replicas":  replicas,
				})
			}
		}
		if stsNoPDB == nil {
			stsNoPDB = []map[string]interface{}{}
		}

		base["deployment_count"] = len(extractResourceItems(deploys))
		base["statefulset_count"] = len(extractResourceItems(sts))
		base["pdb_count"] = len(extractResourceItems(pdbs))
		base["deployments_without_pdb"] = deplsNoPDB
		base["statefulsets_without_pdb"] = stsNoPDB
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
