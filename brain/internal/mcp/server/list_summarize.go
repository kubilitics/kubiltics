package server

import (
	"encoding/json"
	"strings"
	"time"
)

// toolDataSource classifies a tool by the freshness of its backing data.
// These values are injected into every tool result as "data_source" so the
// LLM can express staleness caveats to the operator when relevant.
//
//   k8s-live    — informer cache (Watch-based, ~0 ms staleness, resyncs every 5 min)
//   metrics-live — metrics cache with 10 s TTL
//   events-live  — event informer cache (same Watch path as k8s-live)
//   logs-live    — direct Kubernetes API call, no cache
//   derived      — computed/analyzed from one or more live sources
func toolDataSource(toolName string) string {
	switch {
	case toolName == "get_logs":
		return "logs-live"
	case toolName == "get_events":
		return "events-live"
	case strings.HasPrefix(toolName, "observe_top_"),
		toolName == "observe_pod_metrics",
		toolName == "get_resource_metrics":
		return "metrics-live"
	case strings.HasPrefix(toolName, "analyze_"),
		strings.HasPrefix(toolName, "diagnose_"),
		strings.HasPrefix(toolName, "troubleshoot_"),
		strings.HasPrefix(toolName, "recommend_"),
		strings.HasPrefix(toolName, "narrate_"),
		strings.HasPrefix(toolName, "plan_"),
		strings.HasPrefix(toolName, "security_"),
		strings.HasPrefix(toolName, "cost_"),
		strings.HasPrefix(toolName, "automation_"),
		toolName == "observe_problem_pods",
		toolName == "observe_services_by_filter",
		toolName == "observe_cluster_risk",
		toolName == "get_cluster_health":
		return "derived"
	default:
		// observe_*, inspect_*, list_*, get_*, resolve_*, execution_*
		return "k8s-live"
	}
}

// toolDerivedFrom returns the list of data sources a tool reads from.
// Used for the "derived_from" lineage field on every tool result.
func toolDerivedFrom(toolName string) []string {
	switch {
	case toolName == "get_logs":
		return []string{"logs-live"}
	case toolName == "get_events":
		return []string{"events-live"}
	case strings.HasPrefix(toolName, "observe_top_"),
		toolName == "observe_pod_metrics",
		toolName == "get_resource_metrics":
		return []string{"metrics-live"}
	// Mixed: k8s-live + metrics
	case toolName == "analyze_blast_radius",
		toolName == "analyze_rollout_risk",
		toolName == "narrate_capacity_report",
		toolName == "cost_optimize_cluster":
		return []string{"k8s-live", "metrics-live"}
	// Mixed: k8s-live + events
	case toolName == "analyze_failure_patterns",
		toolName == "analyze_error_correlation",
		toolName == "narrate_incident_timeline",
		toolName == "narrate_weekly_status",
		toolName == "diagnose_deployment_rollback_needed",
		toolName == "diagnose_pod_not_ready",
		toolName == "diagnose_pvc_pending",
		toolName == "diagnose_ingress_404",
		toolName == "diagnose_node_unschedulable":
		return []string{"k8s-live", "events-live"}
	// Pure derived from k8s-live
	case strings.HasPrefix(toolName, "analyze_"),
		strings.HasPrefix(toolName, "diagnose_"),
		strings.HasPrefix(toolName, "troubleshoot_"),
		strings.HasPrefix(toolName, "recommend_"),
		strings.HasPrefix(toolName, "narrate_"),
		strings.HasPrefix(toolName, "plan_"),
		strings.HasPrefix(toolName, "security_"),
		strings.HasPrefix(toolName, "cost_"),
		strings.HasPrefix(toolName, "automation_"),
		toolName == "observe_problem_pods",
		toolName == "list_problems",
		toolName == "triage_cluster",
		toolName == "observe_services_by_filter",
		toolName == "observe_cluster_risk",
		toolName == "get_cluster_health":
		return []string{"k8s-live"}
	default:
		return []string{"k8s-live"}
	}
}

// injectToolMetadata annotates a successful tool result with data lineage and
// latency. If the result is not a map (e.g. a raw string or array from a legacy
// handler), it is wrapped in one. Existing keys are never overwritten so
// handlers that already set data_source or latency_ms keep their values.
func injectToolMetadata(result interface{}, toolName string, duration time.Duration) interface{} {
	m, ok := result.(map[string]interface{})
	if !ok {
		m = map[string]interface{}{"result": result}
	}
	if _, has := m["data_source"]; !has {
		m["data_source"] = toolDataSource(toolName)
	}
	if _, has := m["derived_from"]; !has {
		m["derived_from"] = toolDerivedFrom(toolName)
	}
	if _, has := m["latency_ms"]; !has {
		m["latency_ms"] = duration.Milliseconds()
	}
	return m
}

// MaxToolOutputBytes is the hard ceiling on the JSON-serialized tool
// result returned to the LLM. gpt-4o-mini's output budget collapses
// beyond ~20KB per tool result — it calls the tool, gets the wall of
// JSON, then emits zero text on the final turn. This cap is enforced
// blanket-fashion by capToolOutput so no single tool handler can
// torpedo the turn regardless of how lazy it is about pre-summarizing.
const MaxToolOutputBytes = 8 * 1024

// capToolOutput ensures a tool result serializes to at most
// MaxToolOutputBytes. Under budget → unchanged. Over budget → trim the
// largest list-valued field (usually "items"), keep a top-level
// item_count if we had one, and set the _truncated / _truncated_reason
// markers so the LLM can tell the operator "showing first N of M".
//
// Preserving item_count is the load-bearing move: for list/count
// questions the model can still truthfully say "49 pods" even when
// per-pod detail has been cut.
func capToolOutput(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return v // can't size it; pass through rather than drop the result
	}
	if len(b) <= MaxToolOutputBytes {
		return v
	}

	m, ok := v.(map[string]interface{})
	if !ok {
		// Non-map (array, string) over budget. Stringify and cut.
		trunc := string(b)
		if len(trunc) > MaxToolOutputBytes-200 {
			trunc = trunc[:MaxToolOutputBytes-200]
		}
		return map[string]interface{}{
			"_truncated":        true,
			"_truncated_reason": "tool returned a large non-object payload; showing the first bytes",
			"preview":           trunc,
		}
	}

	// We have a map. Shallow-copy and trim the largest slice-valued field.
	out := make(map[string]interface{}, len(m))
	for k, val := range m {
		out[k] = val
	}
	out["_truncated"] = true
	out["_truncated_reason"] = "tool output exceeded 8KB; per-item detail reduced"

	trimKey := ""
	if _, ok := out["items"].([]interface{}); ok {
		trimKey = "items"
	} else {
		maxLen := 0
		for k, val := range out {
			if arr, ok := val.([]interface{}); ok && len(arr) > maxLen {
				maxLen = len(arr)
				trimKey = k
			}
		}
	}
	if trimKey != "" {
		arr := out[trimKey].([]interface{})
		for len(arr) > 0 {
			out[trimKey] = arr
			bb, _ := json.Marshal(out)
			if len(bb) <= MaxToolOutputBytes {
				break
			}
			arr = arr[:len(arr)/2]
		}
		if len(arr) == 0 {
			delete(out, trimKey)
		}
	}

	// Final defense: if the map still serializes over budget (e.g. an
	// unexpected shape with a huge non-array field), flatten the whole
	// thing to a truncated JSON string. Preserves item_count + any
	// top-level scalars the LLM needs for counting, and guarantees
	// the string fed back never exceeds the cap.
	if bb, _ := json.Marshal(out); len(bb) > MaxToolOutputBytes {
		keep := map[string]interface{}{
			"_truncated":        true,
			"_truncated_reason": "tool output still over budget after array trim; flattened to preview",
		}
		for _, k := range []string{"item_count", "kind", "apiVersion", "cluster_id", "namespace"} {
			if v, ok := out[k]; ok {
				keep[k] = v
			}
		}
		preview := string(bb)
		if len(preview) > MaxToolOutputBytes-512 {
			preview = preview[:MaxToolOutputBytes-512]
		}
		keep["preview"] = preview
		return keep
	}
	return out
}

// summarizeListForLLM trims a K8s-style list payload (e.g. {items:[...]})
// to the fields an LLM actually needs to answer "list/count" questions:
// kind, name, namespace, labels, creationTimestamp, and a compact status
// slice. managedFields, annotations, the full spec, and status conditions
// are dropped. Without this, "list all pods" on a real cluster returns
// ~200KB of JSON per turn — gpt-4o-mini spends its output budget on
// parsing it and emits no written answer, leaving users with a bare tool
// block and no summary.
//
// The shape is preserved: { items: [...], item_count: N, kind: K? } so
// existing tools that count len(items) continue to work.
func summarizeListForLLM(raw interface{}) interface{} {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return raw
	}
	// Some backend endpoints return a bare slice at the top level.
	itemsAny, hasItems := m["items"]
	if !hasItems {
		if arr, isArr := raw.([]interface{}); isArr {
			summarized := make([]interface{}, 0, len(arr))
			for _, it := range arr {
				summarized = append(summarized, summarizeItem(it))
			}
			return map[string]interface{}{
				"items":      summarized,
				"item_count": len(summarized),
			}
		}
		return raw
	}
	items, ok := itemsAny.([]interface{})
	if !ok {
		return raw
	}
	summarized := make([]interface{}, 0, len(items))
	for _, it := range items {
		summarized = append(summarized, summarizeItem(it))
	}
	out := map[string]interface{}{
		"items":      summarized,
		"item_count": len(summarized),
	}
	for _, k := range []string{"kind", "apiVersion", "cluster_id", "namespace"} {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}

// summarizeItem reduces a single K8s object to the fields an LLM reasoner
// cares about. Everything else — managedFields, annotations, full spec,
// verbose status — is discarded.
//
// Every resource kind produces a non-empty status.health or status.phase so
// the STATUS column in the rendered kubectl-style table is never "Unknown":
//
//   Pod                 → status.phase (Running/Pending/Failed/Succeeded)
//   Deployment/SS/DS/RS → status.health derived from replica counts
//   Job                 → status.health (Completed/Failed/Running/Pending)
//   CronJob             → status.health (Active/Idle)
//   Node                → status.health derived from Ready condition
//   Service             → status.health = spec.type (ClusterIP/NodePort/LoadBalancer)
//   Ingress             → status.health (Provisioned/Pending)
//   Namespace/PVC/PV    → status.phase (Active/Bound/etc. — already in K8s status)
//   ConfigMap/Secret/   → status.health = "Active" (no failure mode; presence = working)
//   Role/SA/etc.
func summarizeItem(raw interface{}) interface{} {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return raw
	}
	out := map[string]interface{}{}
	kind, _ := m["kind"].(string)
	if kind != "" {
		out["kind"] = kind
	}
	if meta, ok := m["metadata"].(map[string]interface{}); ok {
		md := map[string]interface{}{}
		for _, k := range []string{"name", "namespace", "creationTimestamp", "labels"} {
			if v, ok := meta[k]; ok {
				md[k] = v
			}
		}
		out["metadata"] = md
	}

	ss := map[string]interface{}{}
	if st, ok := m["status"].(map[string]interface{}); ok {
		// Pod scalar fields
		for _, k := range []string{"phase", "podIP", "hostIP", "reason", "message", "startTime"} {
			if v, ok := st[k]; ok {
				ss[k] = v
			}
		}
		// Workload replica fields (Deployment, StatefulSet, DaemonSet, ReplicaSet)
		for _, k := range []string{"replicas", "readyReplicas", "availableReplicas", "updatedReplicas", "unavailableReplicas"} {
			if v, ok := st[k]; ok {
				ss[k] = v
			}
		}
		// Container restart / readiness counters
		if cs, ok := st["containerStatuses"].([]interface{}); ok {
			restarts := 0
			notReady := 0
			for _, c := range cs {
				if cm, ok := c.(map[string]interface{}); ok {
					if r, ok := cm["restartCount"].(float64); ok {
						restarts += int(r)
					}
					if ready, ok := cm["ready"].(bool); ok && !ready {
						notReady++
					}
				}
			}
			if restarts > 0 {
				ss["total_restarts"] = restarts
			}
			if notReady > 0 {
				ss["containers_not_ready"] = notReady
			}
		}
		// Workload health: single string derived from replica counts.
		if _, hasReplicas := ss["replicas"]; hasReplicas {
			desired := intFromFloat(ss["replicas"])
			ready := intFromFloat(ss["readyReplicas"])
			if desired == 0 {
				ss["health"] = "ScaledToZero"
			} else if ready >= desired {
				ss["health"] = "Available"
			} else if ready == 0 {
				ss["health"] = "Unavailable"
			} else {
				ss["health"] = "Degraded"
			}
		}
		// Job: derive health from completion/failure/active counters.
		if kind == "Job" {
			succeeded := intFromFloat(st["succeeded"])
			failed := intFromFloat(st["failed"])
			active := intFromFloat(st["active"])
			switch {
			case succeeded > 0:
				ss["health"] = "Completed"
			case failed > 0 && active == 0:
				ss["health"] = "Failed"
			case active > 0:
				ss["health"] = "Running"
			default:
				ss["health"] = "Pending"
			}
		}
		// CronJob: active jobs list indicates scheduling activity.
		if kind == "CronJob" {
			if active, ok := st["active"].([]interface{}); ok && len(active) > 0 {
				ss["health"] = "Active"
			} else {
				ss["health"] = "Idle"
			}
		}
		// Node: derive health from the Ready condition.
		if kind == "Node" {
			nodeHealth := "Unknown"
			if conds, ok := st["conditions"].([]interface{}); ok {
				for _, c := range conds {
					if cm, ok := c.(map[string]interface{}); ok && cm["type"] == "Ready" {
						switch cm["status"] {
						case "True":
							nodeHealth = "Ready"
						case "False":
							nodeHealth = "NotReady"
						}
					}
				}
			}
			ss["health"] = nodeHealth
		}
		// Ingress: provisioned once loadBalancer.ingress is populated.
		if kind == "Ingress" {
			if lb, ok := st["loadBalancer"].(map[string]interface{}); ok {
				if ingresses, ok := lb["ingress"].([]interface{}); ok && len(ingresses) > 0 {
					ss["health"] = "Provisioned"
				} else {
					ss["health"] = "Pending"
				}
			} else {
				ss["health"] = "Pending"
			}
		}
	}

	// Service: type lives in spec, not status. Show ClusterIP/NodePort/LoadBalancer
	// as the STATUS value — more useful than any status field Services expose.
	if kind == "Service" {
		if sp, ok := m["spec"].(map[string]interface{}); ok {
			if svcType, ok := sp["type"].(string); ok && svcType != "" {
				ss["health"] = svcType
			} else {
				ss["health"] = "ClusterIP" // implicit default
			}
		}
	}

	// Fallback: any resource with no phase and no health after all of the
	// above (ConfigMap, Secret, ServiceAccount, Role, RoleBinding,
	// ClusterRole, ClusterRoleBinding, LimitRange, ResourceQuota, etc.)
	// is effectively healthy by virtue of existing — mark it "Active".
	if _, hasPhase := ss["phase"]; !hasPhase {
		if _, hasHealth := ss["health"]; !hasHealth {
			ss["health"] = "Active"
		}
	}

	if len(ss) > 0 {
		out["status"] = ss
	}

	if sp, ok := m["spec"].(map[string]interface{}); ok {
		sp2 := map[string]interface{}{}
		if v, ok := sp["nodeName"]; ok {
			sp2["nodeName"] = v
		}
		if v, ok := sp["containers"].([]interface{}); ok {
			names := make([]string, 0, len(v))
			for _, c := range v {
				if cm, ok := c.(map[string]interface{}); ok {
					if n, ok := cm["name"].(string); ok {
						names = append(names, n)
					}
				}
			}
			if len(names) > 0 {
				sp2["container_names"] = names
			}
		}
		if len(sp2) > 0 {
			out["spec"] = sp2
		}
	}
	return out
}

func intFromFloat(v interface{}) int {
	if f, ok := v.(float64); ok {
		return int(f)
	}
	return 0
}
