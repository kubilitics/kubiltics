package server

// handlers_observability.go — Phase 3 Category 1 observability aggregators.
//
// Ten tools that surface cluster-wide health signals the existing per-resource
// tools can't answer directly: flapping services, noisy neighbors, probe gaps,
// orphaned pods, stuck rollouts, label cardinality, restart storms, scheduler
// failures, zombie finalizers. Each degrades gracefully when the backend
// endpoint is unavailable — we return {items:[], note:"..."} instead of
// surfacing a hard error so the LLM can narrate the gap.

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

// ═══════════════════════════════════════════════════════════════════════════
// observe_flapping_services
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveFlappingServices counts endpoint-churn events per service
// inside a look-back window and flags services whose count exceeds threshold.
// Churn = any Warning/Normal event whose reason mentions "endpoint" or
// "addresses" — covers FailedToUpdateEndpoint, EndpointSliceMissing,
// EndpointAddresses, etc.
func (s *mcpServerImpl) handleObserveFlappingServices(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	window := intArg(args, "window_minutes", 15)
	threshold := intArg(args, "threshold", 5)
	namespace := strArg(args, "namespace")
	cutoff := time.Now().Add(-time.Duration(window) * time.Minute)

	eq := url.Values{}
	eq.Set("limit", "1000")
	if namespace != "" {
		eq.Set("namespace", namespace)
	}
	var rawEvents interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEvents); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("events endpoint unavailable: %v", err),
		}, nil
	}

	counts := map[string]int{}
	keyNs := map[string]string{}
	for _, ev := range extractResourceItems(rawEvents) {
		if ts := eventTimestamp(ev); ts.IsZero() || ts.Before(cutoff) {
			continue
		}
		kind, name, ns := eventInvolvedObject(ev)
		if !strings.EqualFold(kind, "Service") && !strings.EqualFold(kind, "Endpoints") && !strings.EqualFold(kind, "EndpointSlice") {
			continue
		}
		reason, _ := ev["reason"].(string)
		rl := strings.ToLower(reason)
		if !strings.Contains(rl, "endpoint") && !strings.Contains(rl, "address") {
			continue
		}
		if name == "" {
			continue
		}
		key := ns + "/" + name
		counts[key]++
		keyNs[key] = ns
	}

	type flap struct {
		Namespace string `json:"namespace"`
		Service   string `json:"service"`
		Churn     int    `json:"churn_count"`
	}
	var items []flap
	for k, n := range counts {
		if n < threshold {
			continue
		}
		parts := strings.SplitN(k, "/", 2)
		items = append(items, flap{Namespace: keyNs[k], Service: parts[1], Churn: n})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Churn > items[j].Churn })

	return map[string]interface{}{
		"window_minutes": window,
		"threshold":      threshold,
		"items":          items,
		"summary":        fmt.Sprintf("%d flapping service(s) in last %d min (threshold=%d).", len(items), window, threshold),
	}, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_noisy_neighbors
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveNoisyNeighbors surfaces pods using more than `cpu_threshold`
// percent of their node's CPU or `mem_threshold` percent of its memory. Relies
// on the Phase 1 /metrics/summary aggregate which returns {pods:[...], nodes:[...]}.
func (s *mcpServerImpl) handleObserveNoisyNeighbors(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	cpuPct := intArg(args, "cpu_threshold_pct", 80)
	memPct := intArg(args, "mem_threshold_pct", 80)

	var agg map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &agg); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("/metrics/summary unavailable: %v", err),
		}, nil
	}

	// Build node capacity index: name -> {cpuMilli, memMiB}
	type cap struct{ cpu, mem float64 }
	nodeCap := map[string]cap{}
	if nodes, ok := agg["nodes"].([]interface{}); ok {
		for _, n := range nodes {
			nm, _ := n.(map[string]interface{})
			name, _ := nm["name"].(string)
			cpuV, _ := nm["cpu_millicores"].(float64)
			memV, _ := nm["memory_mib"].(float64)
			if name != "" {
				nodeCap[name] = cap{cpu: cpuV, mem: memV}
			}
		}
	}

	type hot struct {
		Namespace string  `json:"namespace"`
		Pod       string  `json:"pod"`
		Node      string  `json:"node,omitempty"`
		CPUPct    float64 `json:"cpu_pct"`
		MemPct    float64 `json:"mem_pct"`
	}
	var items []hot
	pods, _ := agg["pods"].([]interface{})
	for _, p := range pods {
		pm, _ := p.(map[string]interface{})
		ns, _ := pm["namespace"].(string)
		name, _ := pm["name"].(string)
		nodeName, _ := pm["node"].(string)
		cpuV, _ := pm["cpu_millicores"].(float64)
		memV, _ := pm["memory_mib"].(float64)
		nc, ok := nodeCap[nodeName]
		if !ok || nc.cpu == 0 || nc.mem == 0 {
			continue
		}
		cp := 100 * cpuV / nc.cpu
		mp := 100 * memV / nc.mem
		if cp < float64(cpuPct) && mp < float64(memPct) {
			continue
		}
		items = append(items, hot{Namespace: ns, Pod: name, Node: nodeName, CPUPct: cp, MemPct: mp})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CPUPct != items[j].CPUPct {
			return items[i].CPUPct > items[j].CPUPct
		}
		return items[i].MemPct > items[j].MemPct
	})

	return map[string]interface{}{
		"cpu_threshold_pct": cpuPct,
		"mem_threshold_pct": memPct,
		"items":             items,
		"summary":           fmt.Sprintf("%d noisy-neighbor pod(s) found.", len(items)),
	}, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_unhealthy_probes
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveUnhealthyProbes lists pods with probe-failure events in the
// look-back window. Reasons of interest: Unhealthy, ProbeWarning,
// FailedPostStartHook, ContainerNotReady.
func (s *mcpServerImpl) handleObserveUnhealthyProbes(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	window := intArg(args, "window_minutes", 60)
	namespace := strArg(args, "namespace")
	cutoff := time.Now().Add(-time.Duration(window) * time.Minute)

	eq := url.Values{}
	eq.Set("limit", "1000")
	if namespace != "" {
		eq.Set("namespace", namespace)
	}
	var rawEvents interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEvents); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("events endpoint unavailable: %v", err),
		}, nil
	}

	type hit struct {
		Namespace string `json:"namespace"`
		Pod       string `json:"pod"`
		Reason    string `json:"reason"`
		Count     int    `json:"count"`
		LastSeen  string `json:"last_seen"`
		Message   string `json:"message,omitempty"`
	}
	agg := map[string]*hit{}
	for _, ev := range extractResourceItems(rawEvents) {
		ts := eventTimestamp(ev)
		if ts.IsZero() || ts.Before(cutoff) {
			continue
		}
		reason, _ := ev["reason"].(string)
		if !isProbeFailure(reason) {
			continue
		}
		kind, name, ns := eventInvolvedObject(ev)
		if !strings.EqualFold(kind, "Pod") || name == "" {
			continue
		}
		key := ns + "/" + name + "/" + reason
		h, ok := agg[key]
		if !ok {
			msg, _ := ev["message"].(string)
			h = &hit{Namespace: ns, Pod: name, Reason: reason, Message: msg}
			agg[key] = h
		}
		h.Count++
		if whenStr := ts.UTC().Format(time.RFC3339); whenStr > h.LastSeen {
			h.LastSeen = whenStr
		}
	}
	items := make([]hit, 0, len(agg))
	for _, h := range agg {
		items = append(items, *h)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Count > items[j].Count })
	return map[string]interface{}{
		"window_minutes": window,
		"items":          items,
		"summary":        fmt.Sprintf("%d pod/reason combination(s) with probe failures in last %d min.", len(items), window),
	}, nil
}

func isProbeFailure(reason string) bool {
	r := strings.ToLower(reason)
	switch r {
	case "unhealthy", "probewarning", "failedpoststarthook", "containernotready":
		return true
	}
	return false
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_missing_probes
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveMissingProbes walks Deployment / StatefulSet / DaemonSet specs
// and flags containers without BOTH livenessProbe and readinessProbe.
func (s *mcpServerImpl) handleObserveMissingProbes(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	kinds := []string{"deployments", "statefulsets", "daemonsets"}
	type gap struct {
		Namespace string   `json:"namespace"`
		Kind      string   `json:"kind"`
		Name      string   `json:"name"`
		Missing   []string `json:"missing"` // e.g. ["liveness", "readiness"]
		Container string   `json:"container"`
	}
	var items []gap
	for _, kind := range kinds {
		q := url.Values{}
		if namespace != "" {
			q.Set("namespace", namespace)
		}
		var raw interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+kind+"?"+q.Encode()), &raw); err != nil {
			continue
		}
		for _, r := range extractResourceItems(raw) {
			name := resourceName(r)
			ns := resourceNamespace(r)
			if name == "" {
				continue
			}
			containers := podTemplateContainers(r)
			for _, cnt := range containers {
				cm, _ := cnt.(map[string]interface{})
				if cm == nil {
					continue
				}
				cname, _ := cm["name"].(string)
				var missing []string
				if cm["livenessProbe"] == nil {
					missing = append(missing, "liveness")
				}
				if cm["readinessProbe"] == nil {
					missing = append(missing, "readiness")
				}
				if len(missing) == 2 {
					items = append(items, gap{Namespace: ns, Kind: strings.TrimSuffix(kind, "s"), Name: name, Container: cname, Missing: missing})
				}
			}
		}
	}
	return map[string]interface{}{
		"items":   items,
		"summary": fmt.Sprintf("%d workload container(s) missing BOTH liveness+readiness probes.", len(items)),
	}, nil
}

// podTemplateContainers returns spec.template.spec.containers as []interface{}
// for a Deployment/StatefulSet/DaemonSet. Returns nil if the path is missing.
func podTemplateContainers(r map[string]interface{}) []interface{} {
	spec, _ := r["spec"].(map[string]interface{})
	if spec == nil {
		return nil
	}
	tmpl, _ := spec["template"].(map[string]interface{})
	if tmpl == nil {
		return nil
	}
	tspec, _ := tmpl["spec"].(map[string]interface{})
	if tspec == nil {
		return nil
	}
	if cs, ok := tspec["containers"].([]interface{}); ok {
		return cs
	}
	return nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_orphaned_pods
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveOrphanedPods finds pods whose ownerReference points at a
// ReplicaSet/Job that no longer exists. Expensive in large clusters — the
// caller can scope with namespace. We look up each distinct owner once.
func (s *mcpServerImpl) handleObserveOrphanedPods(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	q := url.Values{}
	q.Set("limit", "500")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods?"+q.Encode()), &raw); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("pods endpoint unavailable: %v", err),
		}, nil
	}

	type orph struct {
		Namespace string `json:"namespace"`
		Pod       string `json:"pod"`
		OwnerKind string `json:"owner_kind"`
		OwnerName string `json:"owner_name"`
	}
	var items []orph
	ownerSeen := map[string]bool{} // key = kind/ns/name, true=exists, false=unknown
	for _, p := range extractResourceItems(raw) {
		meta, _ := p["metadata"].(map[string]interface{})
		owners, _ := meta["ownerReferences"].([]interface{})
		if len(owners) == 0 {
			continue
		}
		ns, _ := meta["namespace"].(string)
		podName, _ := meta["name"].(string)
		for _, o := range owners {
			om, _ := o.(map[string]interface{})
			ok, _ := om["kind"].(string)
			on, _ := om["name"].(string)
			if ok == "" || on == "" {
				continue
			}
			plural := kindToRestPlural(ok)
			okey := plural + "/" + ns + "/" + on
			exists, cached := ownerSeen[okey]
			if !cached {
				var owner map[string]interface{}
				err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+plural+"/"+url.PathEscape(ns)+"/"+url.PathEscape(on)), &owner)
				exists = err == nil && owner != nil
				ownerSeen[okey] = exists
			}
			if !exists {
				items = append(items, orph{Namespace: ns, Pod: podName, OwnerKind: ok, OwnerName: on})
			}
		}
	}
	return map[string]interface{}{
		"items":   items,
		"summary": fmt.Sprintf("%d orphaned pod/owner pair(s).", len(items)),
	}, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_stuck_rollouts
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveStuckRollouts flags deployments whose .status.conditions
// Progressing has been non-advancing (last transition > stuck_minutes ago)
// AND readyReplicas < replicas.
func (s *mcpServerImpl) handleObserveStuckRollouts(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	stuckMin := intArg(args, "stuck_minutes", 10)
	namespace := strArg(args, "namespace")
	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments?"+q.Encode()), &raw); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("deployments endpoint unavailable: %v", err),
		}, nil
	}
	cutoff := time.Now().Add(-time.Duration(stuckMin) * time.Minute)

	type stuck struct {
		Namespace      string `json:"namespace"`
		Deployment     string `json:"deployment"`
		Ready          int    `json:"ready_replicas"`
		Desired        int    `json:"replicas"`
		StuckSince     string `json:"stuck_since"`
		ProgressReason string `json:"reason,omitempty"`
	}
	var items []stuck
	for _, d := range extractResourceItems(raw) {
		name := resourceName(d)
		ns := resourceNamespace(d)
		spec, _ := d["spec"].(map[string]interface{})
		status, _ := d["status"].(map[string]interface{})
		if status == nil {
			continue
		}
		ready := intField(status, "readyReplicas")
		desired := intField(spec, "replicas")
		if desired == 0 {
			desired = intField(status, "replicas")
		}
		if ready >= desired && desired > 0 {
			continue
		}
		conds, _ := status["conditions"].([]interface{})
		for _, cnd := range conds {
			cm, _ := cnd.(map[string]interface{})
			ctype, _ := cm["type"].(string)
			if !strings.EqualFold(ctype, "Progressing") {
				continue
			}
			ltt, _ := cm["lastTransitionTime"].(string)
			if ltt == "" {
				continue
			}
			t, err := time.Parse(time.RFC3339, ltt)
			if err != nil || !t.Before(cutoff) {
				continue
			}
			reason, _ := cm["reason"].(string)
			items = append(items, stuck{
				Namespace: ns, Deployment: name,
				Ready: ready, Desired: desired,
				StuckSince: t.UTC().Format(time.RFC3339), ProgressReason: reason,
			})
			break
		}
	}
	return map[string]interface{}{
		"stuck_minutes": stuckMin,
		"items":         items,
		"summary":       fmt.Sprintf("%d deployment(s) stuck > %d min.", len(items), stuckMin),
	}, nil
}

func intField(m map[string]interface{}, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return 0
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_high_cardinality_labels (graceful degradation — no backend endpoint)
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveHighCardinalityLabels would flag label keys whose distinct
// value count exceeds `threshold` cluster-wide (a Prometheus risk). The
// backend has no per-label index endpoint today; we return a graceful-
// degradation note so the LLM can narrate the gap instead of crashing.
func (s *mcpServerImpl) handleObserveHighCardinalityLabels(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	threshold := intArg(args, "threshold", 1000)
	return map[string]interface{}{
		"threshold": threshold,
		"items":     []interface{}{},
		"note":      "backend does not yet expose label-cardinality index; requires /api/v1/clusters/{id}/labels/cardinality endpoint.",
	}, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_restart_storms
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveRestartStorms flags pods whose cumulative container
// restartCount is above threshold. The backend exposes only cumulative
// counts, not per-window history — we return the cumulative view with an
// explicit note so the LLM can pair it with event timestamps if needed.
func (s *mcpServerImpl) handleObserveRestartStorms(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	threshold := intArg(args, "threshold", 5)
	namespace := strArg(args, "namespace")
	q := url.Values{}
	q.Set("limit", "500")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods?"+q.Encode()), &raw); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("pods endpoint unavailable: %v", err),
		}, nil
	}
	type storm struct {
		Namespace string `json:"namespace"`
		Pod       string `json:"pod"`
		Container string `json:"container"`
		Restarts  int    `json:"restarts"`
	}
	var items []storm
	for _, p := range extractResourceItems(raw) {
		meta, _ := p["metadata"].(map[string]interface{})
		ns, _ := meta["namespace"].(string)
		name, _ := meta["name"].(string)
		status, _ := p["status"].(map[string]interface{})
		if status == nil {
			continue
		}
		statuses, _ := status["containerStatuses"].([]interface{})
		for _, cs := range statuses {
			cm, _ := cs.(map[string]interface{})
			cn, _ := cm["name"].(string)
			rc := intField(cm, "restartCount")
			if rc >= threshold {
				items = append(items, storm{Namespace: ns, Pod: name, Container: cn, Restarts: rc})
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Restarts > items[j].Restarts })
	return map[string]interface{}{
		"threshold": threshold,
		"items":     items,
		"summary":   fmt.Sprintf("%d container restart-storm(s) (cumulative restartCount >= %d).", len(items), threshold),
		"note":      "restartCount is cumulative since pod start; no per-window history is available from backend today.",
	}, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_pending_scheduler_events
// ═══════════════════════════════════════════════════════════════════════════

// handleObservePendingSchedulerEvents lists Pending-pod FailedScheduling
// events in the window so the LLM can narrate taint/affinity/capacity root
// cause.
func (s *mcpServerImpl) handleObservePendingSchedulerEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	window := intArg(args, "window_minutes", 60)
	namespace := strArg(args, "namespace")
	cutoff := time.Now().Add(-time.Duration(window) * time.Minute)
	eq := url.Values{}
	eq.Set("limit", "500")
	if namespace != "" {
		eq.Set("namespace", namespace)
	}
	var rawEvents interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+eq.Encode()), &rawEvents); err != nil {
		return map[string]interface{}{
			"items": []interface{}{},
			"note":  fmt.Sprintf("events endpoint unavailable: %v", err),
		}, nil
	}
	type sched struct {
		Namespace string `json:"namespace"`
		Pod       string `json:"pod"`
		Reason    string `json:"reason"`
		Message   string `json:"message"`
		LastSeen  string `json:"last_seen"`
	}
	var items []sched
	for _, ev := range extractResourceItems(rawEvents) {
		ts := eventTimestamp(ev)
		if ts.IsZero() || ts.Before(cutoff) {
			continue
		}
		reason, _ := ev["reason"].(string)
		if !strings.EqualFold(reason, "FailedScheduling") {
			continue
		}
		kind, name, ns := eventInvolvedObject(ev)
		if !strings.EqualFold(kind, "Pod") {
			continue
		}
		msg, _ := ev["message"].(string)
		items = append(items, sched{Namespace: ns, Pod: name, Reason: reason, Message: msg, LastSeen: ts.UTC().Format(time.RFC3339)})
	}
	return map[string]interface{}{
		"window_minutes": window,
		"items":          items,
		"summary":        fmt.Sprintf("%d FailedScheduling event(s) in last %d min.", len(items), window),
	}, nil
}

// ═══════════════════════════════════════════════════════════════════════════
// observe_zombie_finalizers
// ═══════════════════════════════════════════════════════════════════════════

// handleObserveZombieFinalizers finds resources whose deletionTimestamp is
// older than stuck_minutes ago — a strong signal of a finalizer keeping the
// resource in Terminating. Default scope: pods + namespaces + pvcs (kinds
// where zombies bite hardest). Callers can override with `kinds`.
func (s *mcpServerImpl) handleObserveZombieFinalizers(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	stuckMin := intArg(args, "stuck_minutes", 10)
	cutoff := time.Now().Add(-time.Duration(stuckMin) * time.Minute)
	namespace := strArg(args, "namespace")

	defaultKinds := []string{"pods", "namespaces", "pvcs"}
	kinds := defaultKinds
	if v, ok := args["kinds"].([]interface{}); ok && len(v) > 0 {
		kinds = nil
		for _, it := range v {
			if s, ok := it.(string); ok {
				kinds = append(kinds, kindToRestPlural(s))
			}
		}
	}
	type zombie struct {
		Namespace       string   `json:"namespace,omitempty"`
		Kind            string   `json:"kind"`
		Name            string   `json:"name"`
		DeletionStarted string   `json:"deletion_started"`
		StuckMinutes    int      `json:"stuck_minutes"`
		Finalizers      []string `json:"finalizers"`
	}
	var items []zombie
	for _, kind := range kinds {
		q := url.Values{}
		q.Set("limit", "500")
		if namespace != "" && kind != "namespaces" {
			q.Set("namespace", namespace)
		}
		var raw interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+kind+"?"+q.Encode()), &raw); err != nil {
			continue
		}
		for _, r := range extractResourceItems(raw) {
			meta, _ := r["metadata"].(map[string]interface{})
			if meta == nil {
				continue
			}
			ds, _ := meta["deletionTimestamp"].(string)
			if ds == "" {
				continue
			}
			t, err := time.Parse(time.RFC3339, ds)
			if err != nil || !t.Before(cutoff) {
				continue
			}
			var fin []string
			if fs, ok := meta["finalizers"].([]interface{}); ok {
				for _, f := range fs {
					if fstr, ok := f.(string); ok {
						fin = append(fin, fstr)
					}
				}
			}
			name, _ := meta["name"].(string)
			ns, _ := meta["namespace"].(string)
			items = append(items, zombie{
				Namespace: ns, Kind: strings.TrimSuffix(kind, "s"), Name: name,
				DeletionStarted: t.UTC().Format(time.RFC3339),
				StuckMinutes:    int(time.Since(t).Minutes()),
				Finalizers:      fin,
			})
		}
	}
	return map[string]interface{}{
		"stuck_minutes": stuckMin,
		"kinds":         kinds,
		"items":         items,
		"summary":       fmt.Sprintf("%d zombie resource(s) stuck in Terminating > %d min.", len(items), stuckMin),
	}, nil
}
