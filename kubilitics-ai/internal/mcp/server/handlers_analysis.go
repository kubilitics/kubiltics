package server

// handlers_analysis.go — implementation of all analysis, troubleshooting,
// recommendation, security, cost, action, and automation tool handlers.
//
// Analysis tools aggregate data from multiple backend endpoints and return
// structured maps that the LLM can reason about. They are all read-only unless
// noted (action tools may mutate cluster state and require explicit approval).

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// ════════════════════════════════════════════════════════════════════════════
// ANALYSIS TOOLS
// ════════════════════════════════════════════════════════════════════════════

// routeAnalysisTool routes all analysis tool names to their handlers.
func (s *mcpServerImpl) routeAnalysisTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	switch name {
	case "analyze_resource_efficiency":
		return s.handleAnalyzeResourceEfficiency(ctx, args)
	case "analyze_failure_patterns":
		return s.handleAnalyzeFailurePatterns(ctx, args)
	case "analyze_dependencies":
		return s.handleAnalyzeDependencies(ctx, args)
	case "analyze_configuration_drift":
		return s.handleAnalyzeConfigurationDrift(ctx, args)
	case "analyze_capacity_trends":
		return s.handleAnalyzeCapacityTrends(ctx, args)
	case "analyze_performance_bottlenecks":
		return s.handleAnalyzePerformanceBottlenecks(ctx, args)
	case "analyze_error_correlation":
		return s.handleAnalyzeErrorCorrelation(ctx, args)
	case "analyze_blast_radius":
		return s.handleAnalyzeBlastRadius(ctx, args)
	case "analyze_rollout_risk":
		return s.handleAnalyzeRolloutRisk(ctx, args)
	case "analyze_pod_scheduling":
		return s.handleAnalyzePodScheduling(ctx, args)
	case "analyze_image_vulnerabilities":
		return s.handleAnalyzeImageVulnerabilities(ctx, args)
	case "analyze_workload_patterns":
		return s.handleAnalyzeWorkloadPatterns(ctx, args)
	case "analyze_pod_health":
		return s.handleAnalyzePodHealth(ctx, args)
	case "analyze_deployment_health":
		return s.handleAnalyzeDeploymentHealth(ctx, args)
	case "analyze_statefulset_health":
		return s.handleAnalyzeStatefulSetHealth(ctx, args)
	case "analyze_daemonset_health":
		return s.handleAnalyzeDaemonSetHealth(ctx, args)
	case "analyze_replicaset_health":
		return s.handleAnalyzeReplicaSetHealth(ctx, args)
	case "analyze_job_health":
		return s.handleAnalyzeJobHealth(ctx, args)
	case "analyze_cronjob_health":
		return s.handleAnalyzeCronJobHealth(ctx, args)
	case "analyze_service_health":
		return s.handleAnalyzeServiceHealth(ctx, args)
	case "analyze_ingress_health":
		return s.handleAnalyzeIngressHealth(ctx, args)
	default:
		return nil, fmt.Errorf("analysis tool not implemented: %s", name)
	}
}

// analyze_resource_efficiency — requests vs. actual usage across workloads
func (s *mcpServerImpl) handleAnalyzeResourceEfficiency(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}

	// Workload resource requests
	for _, kind := range []string{"deployments", "statefulsets", "daemonsets"} {
		var data map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+kind+qs), &data); err == nil {
			result[kind] = data
		}
	}
	// Actual usage summary
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics); err == nil {
		result["metrics_summary"] = metrics
	}
	// Cluster-wide metrics
	var clusterMetrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &clusterMetrics); err == nil {
		result["cluster_metrics"] = clusterMetrics
	}
	result["namespace"] = namespace
	result["analysis_hint"] = "Compare requests/limits in workload specs with actual CPU/memory from metrics_summary to identify over-provisioned or under-provisioned resources."
	return result, nil
}

// analyze_failure_patterns — detect recurring failures via events + pod restarts
func (s *mcpServerImpl) handleAnalyzeFailurePatterns(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	q := url.Values{}
	q.Set("limit", "200")
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	result := map[string]interface{}{}

	// Recent events — Warning events indicate failures
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	// Pod restarts visible in metrics
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics); err == nil {
		result["metrics_summary"] = metrics
	}
	// Pod list to check restartCount
	qs := nsQuery(namespace)
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Look for Warning events with high count, pods with restartCount > 5, and OOMKilled or CrashLoopBackOff statuses."
	return result, nil
}

// analyze_dependencies — service dependency map via topology
func (s *mcpServerImpl) handleAnalyzeDependencies(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	q := url.Values{}
	q.Set("maxNodes", "500")
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	var topology map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/topology?"+q.Encode()), &topology); err != nil {
		return nil, err
	}
	// Also pull services and endpoints to enrich the map
	qs := nsQuery(namespace)
	result := map[string]interface{}{"topology": topology}
	var svcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs); err == nil {
		result["services"] = svcs
	}
	result["analysis_hint"] = "Use the topology graph to identify services without redundancy (single node) and circular dependencies."
	return result, nil
}

// analyze_configuration_drift — compare desired vs. running state
func (s *mcpServerImpl) handleAnalyzeConfigurationDrift(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	// Collect desired state from deployments
	var deploys map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
		result["deployments"] = deploys
	}
	// ReplicaSets reflect rollout state
	var rs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+qs), &rs); err == nil {
		result["replicasets"] = rs
	}
	// Pods show actual running state
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Compare spec.replicas vs. status.availableReplicas in deployments; differences indicate drift. Look for pods with images that differ from deployment spec."
	return result, nil
}

// analyze_capacity_trends — node capacity and workload growth
func (s *mcpServerImpl) handleAnalyzeCapacityTrends(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{}
	// Node capacity
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	// Current utilisation
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics); err == nil {
		result["cluster_metrics"] = metrics
	}
	var summary map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &summary); err == nil {
		result["metrics_summary"] = summary
	}
	// HPAs give scaling signals
	var hpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"), &hpa); err == nil {
		result["hpas"] = hpa
	}
	result["analysis_hint"] = "Extrapolate current growth rate from pod counts and CPU/memory utilisation. If nodes are above 80% capacity, scaling or node addition is imminent."
	return result, nil
}

// analyze_performance_bottlenecks — CPU/memory/network hotspots
func (s *mcpServerImpl) handleAnalyzePerformanceBottlenecks(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")

	result := map[string]interface{}{}
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics); err == nil {
		result["cluster_metrics"] = metrics
	}
	var summary map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &summary); err == nil {
		result["metrics_summary"] = summary
	}
	// Per-node metrics reveal hotspot nodes
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	// Warning events often indicate throttling/OOM
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Nodes with >90% CPU or >85% memory are bottlenecks. OOMKilled events indicate memory pressure. Throttled containers show in cpu.throttling metrics."
	return result, nil
}

// analyze_error_correlation — correlate logs/events across services
func (s *mcpServerImpl) handleAnalyzeErrorCorrelation(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	q := url.Values{}
	q.Set("limit", "300")
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	result := map[string]interface{}{}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	// List failing pods
	qs := nsQuery(namespace)
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Group Warning events by timestamp windows. Simultaneous failures across different namespaces point to node-level or control-plane issues."
	return result, nil
}

// analyze_blast_radius — impact of a resource failing
func (s *mcpServerImpl) handleAnalyzeBlastRadius(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	kind := strArg(args, "kind")
	name := strArg(args, "name")
	namespace := strArg(args, "namespace")

	if kind == "" || name == "" {
		return nil, fmt.Errorf("analyze_blast_radius: 'kind' and 'name' are required")
	}

	result := map[string]interface{}{
		"subject_kind":      kind,
		"subject_name":      name,
		"subject_namespace": namespace,
	}

	// Resource topology shows who depends on this resource
	var path string
	if namespace != "" {
		path = c.clusterPath(clusterID, fmt.Sprintf("/topology/resource/%s/%s/%s",
			url.PathEscape(strings.ToLower(kind)),
			url.PathEscape(namespace),
			url.PathEscape(name)))
	} else {
		path = c.clusterPath(clusterID, "/topology?maxNodes=300")
	}
	var topology map[string]interface{}
	if err := c.get(ctx, path, &topology); err == nil {
		result["topology"] = topology
	}
	// Services that select pods from this workload
	if namespace != "" {
		qs := "?namespace=" + url.QueryEscape(namespace)
		var svcs map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs); err == nil {
			result["services_in_namespace"] = svcs
		}
	}
	result["analysis_hint"] = "Trace outgoing edges in the topology graph to find all dependent services. Services with no alternative upstream are in the blast radius."
	return result, nil
}

// analyze_rollout_risk — assess risk before a deployment rollout
func (s *mcpServerImpl) handleAnalyzeRolloutRisk(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")

	result := map[string]interface{}{}

	if name != "" && namespace != "" {
		// Get deployment details
		var deploy map[string]interface{}
		path := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
		if err := c.get(ctx, path, &deploy); err == nil {
			result["deployment"] = deploy
		}
		// Rollout history
		histPath := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history")
		var history map[string]interface{}
		if err := c.get(ctx, histPath, &history); err == nil {
			result["rollout_history"] = history
		}
		// Metrics for this deployment
		var metrics map[string]interface{}
		mPath := c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/deployment/"+url.PathEscape(name))
		if err := c.get(ctx, mPath, &metrics); err == nil {
			result["metrics"] = metrics
		}
	} else {
		// Cluster-wide: list all deployments for health check
		qs := nsQuery(namespace)
		var deploys map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
			result["deployments"] = deploys
		}
	}
	// Current cluster resource availability
	var clMetrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &clMetrics); err == nil {
		result["cluster_metrics_summary"] = clMetrics
	}
	result["analysis_hint"] = "Check rollout strategy (RollingUpdate vs Recreate), minReadySeconds, and cluster headroom. High restart count in history = risky rollout."
	return result, nil
}

// analyze_pod_scheduling — scheduling decisions and node affinity
func (s *mcpServerImpl) handleAnalyzePodScheduling(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	// Pending pods appear in events
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Pods in Pending state with FailedScheduling events indicate node pressure or affinity mismatches. Compare taints/tolerations and resource requests."
	return result, nil
}

// analyze_image_vulnerabilities — scan images in running workloads
func (s *mcpServerImpl) handleAnalyzeImageVulnerabilities(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	// Gather all images from pods
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err != nil {
		return nil, fmt.Errorf("could not list pods: %w", err)
	}
	return map[string]interface{}{
		"pods":          pods,
		"analysis_hint": "Extract spec.containers[].image from each pod. Cross-reference with CVE databases or run trivy/grype against each image tag. Prioritise images with known Critical CVEs.",
	}, nil
}

// analyze_workload_patterns — traffic and scaling patterns
func (s *mcpServerImpl) handleAnalyzeWorkloadPatterns(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics); err == nil {
		result["metrics_summary"] = metrics
	}
	var hpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa); err == nil {
		result["hpas"] = hpa
	}
	var deploys map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
		result["deployments"] = deploys
	}
	result["analysis_hint"] = "HPA currentReplicas vs minReplicas shows scaling activity. Steady high CPU indicates sustained load; spikes suggest bursty workloads needing KEDA or KUPE."
	return result, nil
}

// handleAnalyzePodHealth — intelligent pod health diagnostics (A-CORE-003)
func (s *mcpServerImpl) handleAnalyzePodHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")

	path := c.clusterPath(clusterID, "/resources/pods"+nsQuery(namespace))
	if name != "" {
		path = c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	}

	var podsData interface{}
	if err := c.get(ctx, path, &podsData); err != nil {
		return nil, err
	}

	var pods []map[string]interface{}
	if name != "" {
		if p, ok := podsData.(map[string]interface{}); ok {
			pods = append(pods, p)
		}
	} else if pData, ok := podsData.(map[string]interface{}); ok {
		if items, ok := pData["items"].([]interface{}); ok {
			for _, item := range items {
				if m, ok := item.(map[string]interface{}); ok {
					pods = append(pods, m)
				}
			}
		}
	}

	findings := []map[string]interface{}{}
	for _, pod := range pods {
		podFindings := s.analyzeSinglePodHealth(pod)
		if len(podFindings) > 0 {
			findings = append(findings, map[string]interface{}{
				"pod":       pod["metadata"].(map[string]interface{})["name"],
				"namespace": pod["metadata"].(map[string]interface{})["namespace"],
				"status":    pod["status"].(map[string]interface{})["phase"],
				"issues":    podFindings,
			})
		}
	}

	return map[string]interface{}{
		"namespace":    namespace,
		"findings":     findings,
		"total_pods":   len(pods),
		"unhealthy":    len(findings),
		"timestamp":    time.Now(),
		"analysis_key": "Look for OOMKilled, ImagePullBackOff, or excessive restarts. These findings are deterministic and mapped to senior-level recommendations.",
	}, nil
}

func (s *mcpServerImpl) analyzeSinglePodHealth(pod map[string]interface{}) []map[string]interface{} {
	findings := []map[string]interface{}{}

	status, ok := pod["status"].(map[string]interface{})
	if !ok {
		return findings
	}

	// 1. Check Container Statuses for restarts, last termination reason, and errors
	if cStatuses, ok := status["containerStatuses"].([]interface{}); ok {
		for _, cs := range cStatuses {
			if m, ok := cs.(map[string]interface{}); ok {
				name, _ := m["name"].(string)
				restarts := intVal(m["restartCount"])

				// Risk: High Restarts (pod-intelligence: > 3)
				if restarts > 3 {
					findings = append(findings, map[string]interface{}{
						"type":           "HIGH_RESTART_COUNT",
						"severity":       "MEDIUM",
						"container":      name,
						"restart_count":  restarts,
						"recommendation": "Inspect logs and investigate crash reasons. Use observe_pod_logs_filtered(filter=error) and observe_pod_events.",
					})
				}

				// Last termination reason (PRD: Restart count with reason)
				if lastState, ok := m["lastState"].(map[string]interface{}); ok {
					if term, ok := lastState["terminated"].(map[string]interface{}); ok {
						reason, _ := term["reason"].(string)
						exitCode := term["exitCode"]
						findings = append(findings, map[string]interface{}{
							"type":                    "LAST_TERMINATION",
							"severity":                "INFO",
							"container":               name,
							"last_termination_reason": reason,
							"exit_code":               exitCode,
						})
						if reason == "OOMKilled" {
							findings = append(findings, map[string]interface{}{
								"type":           "OOM_KILLED",
								"severity":       "CRITICAL",
								"container":      name,
								"recommendation": "Increase memory limits in the pod spec or optimize application memory usage.",
							})
						}
					}
				}

				// Risk: Waiting (CrashLoopBackOff, ImagePullBackOff, etc.) — PRD: CRASH_LOOP
				if state, ok := m["state"].(map[string]interface{}); ok {
					if waiting, ok := state["waiting"].(map[string]interface{}); ok {
						reason, _ := waiting["reason"].(string)
						if reason == "CrashLoopBackOff" {
							findings = append(findings, map[string]interface{}{
								"type":           "CRASH_LOOP",
								"severity":       "HIGH",
								"container":      name,
								"reason":         reason,
								"message":        waiting["message"],
								"recommendation": s.getRecommendation(reason),
							})
						} else if reason == "ImagePullBackOff" || reason == "CreateContainerConfigError" {
							findings = append(findings, map[string]interface{}{
								"type":           "CONTAINER_STUCK",
								"severity":       "HIGH",
								"container":      name,
								"reason":         reason,
								"message":        waiting["message"],
								"recommendation": s.getRecommendation(reason),
							})
						}
					}
				}
			}
		}
	}

	// 2. Pod Conditions (Ready=False while Running)
	if conditions, ok := status["conditions"].([]interface{}); ok {
		for _, cond := range conditions {
			if m, ok := cond.(map[string]interface{}); ok {
				cType, _ := m["type"].(string)
				cStatus, _ := m["status"].(string)
				if cType == "Ready" && cStatus == "False" {
					phase, _ := status["phase"].(string)
					if phase == "Running" {
						findings = append(findings, map[string]interface{}{
							"type":           "POD_NOT_READY",
							"severity":       "MEDIUM",
							"message":        m["message"],
							"recommendation": "Check readiness probes and application startup time.",
						})
					}
				}
			}
		}
	}

	// 3. Image :latest tag (IMAGE_LATEST_TAG_USED)
	if spec, ok := pod["spec"].(map[string]interface{}); ok {
		if containers, ok := spec["containers"].([]interface{}); ok {
			for _, c := range containers {
				if m, ok := c.(map[string]interface{}); ok {
					image, _ := m["image"].(string)
					if strings.HasSuffix(image, ":latest") {
						findings = append(findings, map[string]interface{}{
							"type":           "IMAGE_LATEST_TAG_USED",
							"severity":       "LOW",
							"container":      m["name"],
							"recommendation": "Avoid using ':latest' in production; use specific version tags or digests for immutability.",
						})
					}
					// 4. NO_RESOURCE_LIMITS_DEFINED (pod-intelligence Rule 5)
					hasLimits := false
					if res, ok := m["resources"].(map[string]interface{}); ok {
						if limits, ok := res["limits"].(map[string]interface{}); ok && len(limits) > 0 {
							hasLimits = true
						}
					}
					if !hasLimits {
						findings = append(findings, map[string]interface{}{
							"type":           "NO_RESOURCE_LIMITS_DEFINED",
							"severity":       "MEDIUM",
							"container":      m["name"],
							"recommendation": "Set resource limits to avoid noisy-neighbour and OOM. Prefer requests and limits for both CPU and memory.",
						})
					}
				}
			}
		}
	}

	return findings
}

// analyze_deployment_health — deep analysis of deployment rollouts and health
func (s *mcpServerImpl) handleAnalyzeDeploymentHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	if name != "" {
		var deploy map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &deploy); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("Deployment %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		out := s.analyzeSingleDeploymentHealth(ctx, clusterID, deploy)
		// Align with observe_deployment_detailed shape: risk_flags + recommendations
		out["risk_flags"] = out["issues"]
		recs := []string{}
		if issues, ok := out["issues"].([]map[string]interface{}); ok {
			for _, i := range issues {
				if r, ok := i["recommendation"].(string); ok && r != "" {
					recs = append(recs, r)
				}
			}
		}
		out["recommendations"] = recs
		return out, nil
	}

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &data); err != nil {
		return nil, err
	}

	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if deploy, ok := item.(map[string]interface{}); ok {
			analysis := s.analyzeSingleDeploymentHealth(ctx, clusterID, deploy)
			if len(analysis["issues"].([]map[string]interface{})) > 0 || analysis["status"] != "Healthy" {
				findings = append(findings, analysis)
			}
		}
	}

	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"total":     len(items),
		"unhealthy": len(findings),
		"timestamp": time.Now(),
	}, nil
}

func (s *mcpServerImpl) analyzeSingleDeploymentHealth(ctx context.Context, clusterID string, deploy map[string]interface{}) map[string]interface{} {
	name := deploy["metadata"].(map[string]interface{})["name"].(string)
	ns := deploy["metadata"].(map[string]interface{})["namespace"].(string)
	status, _ := deploy["status"].(map[string]interface{})
	spec, _ := deploy["spec"].(map[string]interface{})

	replicas := int(status["replicas"].(float64))
	ready := int(status["readyReplicas"].(float64))
	updated := int(status["updatedReplicas"].(float64))
	available := int(status["availableReplicas"].(float64))
	desired := int(spec["replicas"].(float64))

	issues := []map[string]interface{}{}
	healthStatus := "Healthy"

	// 1. Check for unavailable replicas
	if available < desired {
		healthStatus = "Degraded"
		issues = append(issues, map[string]interface{}{
			"type":           "UNAVAILABLE_REPLICAS",
			"severity":       "HIGH",
			"message":        fmt.Sprintf("Desired: %d, Available: %d", desired, available),
			"recommendation": "Check pod events for OOMKilled or probe failures.",
		})
	}

	// 2. Check for Progressing=False (Rollout stalled)
	if conditions, ok := status["conditions"].([]interface{}); ok {
		for _, cond := range conditions {
			if m, ok := cond.(map[string]interface{}); ok {
				if m["type"] == "Progressing" && m["status"] == "False" {
					healthStatus = "Critical"
					issues = append(issues, map[string]interface{}{
						"type":           "ROLLOUT_STALLED",
						"severity":       "CRITICAL",
						"reason":         m["reason"],
						"message":        m["message"],
						"recommendation": "Rollout has exceeded its deadline. Check for image pull errors or insufficient resource quota.",
					})
				}
			}
		}
	}

	// 3. Image drift (simple check)
	// In a real scenario, we'd compare with historical RS, but here we can flag if updated < desired
	if updated < desired && healthStatus == "Healthy" {
		healthStatus = "Progressing"
	}

	return map[string]interface{}{
		"name":      name,
		"namespace": ns,
		"status":    healthStatus,
		"replicas": map[string]int{
			"desired":   desired,
			"current":   replicas,
			"ready":     ready,
			"updated":   updated,
			"available": available,
		},
		"issues": issues,
	}
}

// analyze_statefulset_health
func (s *mcpServerImpl) handleAnalyzeStatefulSetHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets"+qs), &data); err != nil {
		return nil, err
	}

	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if sts, ok := item.(map[string]interface{}); ok {
			status, _ := sts["status"].(map[string]interface{})
			ready := int(status["readyReplicas"].(float64))
			replicas := int(status["replicas"].(float64))

			if ready < replicas {
				findings = append(findings, map[string]interface{}{
					"name":           sts["metadata"].(map[string]interface{})["name"],
					"namespace":      sts["metadata"].(map[string]interface{})["namespace"],
					"issue":          "ORDINAL_NOT_READY",
					"severity":       "HIGH",
					"ready":          ready,
					"desired":        replicas,
					"recommendation": "StatefulSet pods must be ready in ordinal order. Check the first non-ready pod's logs and PVC status.",
				})
			}
		}
	}

	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"timestamp": time.Now(),
	}, nil
}

// analyze_replicaset_health
func (s *mcpServerImpl) handleAnalyzeReplicaSetHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	if name != "" {
		var rs map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &rs); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("ReplicaSet %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		riskFlags, recommendations := s.analyzeReplicaSetHealthFindings(rs)
		spec, _ := rs["spec"].(map[string]interface{})
		status, _ := rs["status"].(map[string]interface{})
		desired := 0
		if spec != nil {
			if r, ok := spec["replicas"].(float64); ok {
				desired = int(r)
			}
		}
		available := 0
		if status != nil {
			if a, ok := status["availableReplicas"].(float64); ok {
				available = int(a)
			}
		}
		healthStatus := "Healthy"
		if desired > 0 && available < desired {
			healthStatus = "Degraded"
		}
		return map[string]interface{}{
			"name":            name,
			"namespace":       namespace,
			"status":         healthStatus,
			"replicas":       map[string]interface{}{"desired": desired, "available": available},
			"issues":          riskFlags,
			"risk_flags":      riskFlags,
			"recommendations": recommendations,
			"timestamp":       time.Now(),
		}, nil
	}

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+qs), &data); err != nil {
		return nil, err
	}
	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if rs, ok := item.(map[string]interface{}); ok {
			riskFlags, recs := s.analyzeReplicaSetHealthFindings(rs)
			if len(riskFlags) > 0 {
				meta, _ := rs["metadata"].(map[string]interface{})
				findings = append(findings, map[string]interface{}{
					"name":            meta["name"],
					"namespace":       meta["namespace"],
					"issues":          riskFlags,
					"recommendations": recs,
				})
			}
		}
	}
	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"total":     len(items),
		"unhealthy": len(findings),
		"timestamp": time.Now(),
	}, nil
}

// analyze_job_health
func (s *mcpServerImpl) handleAnalyzeJobHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	if name != "" {
		var job map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/jobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &job); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("Job %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		riskFlags, recommendations := s.analyzeJobHealthFindings(job)
		status, _ := job["status"].(map[string]interface{})
		succeeded := 0
		failed := 0
		active := 0
		if status != nil {
			succeeded = intValFromMap(status, "succeeded")
			failed = intValFromMap(status, "failed")
			active = intValFromMap(status, "active")
		}
		healthStatus := "Succeeded"
		if failed > 0 {
			healthStatus = "Failed"
		} else if active > 0 {
			healthStatus = "Running"
		}
		return map[string]interface{}{
			"name":            name,
			"namespace":       namespace,
			"status":         healthStatus,
			"succeeded":       succeeded,
			"failed":          failed,
			"active":          active,
			"issues":          riskFlags,
			"risk_flags":      riskFlags,
			"recommendations": recommendations,
			"timestamp":       time.Now(),
		}, nil
	}

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/jobs"+qs), &data); err != nil {
		return nil, err
	}
	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if job, ok := item.(map[string]interface{}); ok {
			riskFlags, recs := s.analyzeJobHealthFindings(job)
			if len(riskFlags) > 0 {
				meta, _ := job["metadata"].(map[string]interface{})
				findings = append(findings, map[string]interface{}{
					"name":            meta["name"],
					"namespace":       meta["namespace"],
					"issues":          riskFlags,
					"recommendations": recs,
				})
			}
		}
	}
	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"total":     len(items),
		"unhealthy": len(findings),
		"timestamp": time.Now(),
	}, nil
}

// analyze_cronjob_health
func (s *mcpServerImpl) handleAnalyzeCronJobHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	if name != "" {
		var cj map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &cj); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("CronJob %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		var childJobs interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/jobs"), &childJobs)
		riskFlags, recommendations := s.analyzeCronJobHealthFindings(cj, childJobs)
		spec, _ := cj["spec"].(map[string]interface{})
		suspend := false
		if spec != nil {
			if s, ok := spec["suspend"].(bool); ok {
				suspend = s
			}
		}
		status := "Active"
		if suspend {
			status = "Suspended"
		}
		return map[string]interface{}{
			"name":            name,
			"namespace":       namespace,
			"status":         status,
			"issues":          riskFlags,
			"risk_flags":      riskFlags,
			"recommendations": recommendations,
			"timestamp":       time.Now(),
		}, nil
	}

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs"+qs), &data); err != nil {
		return nil, err
	}
	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if cj, ok := item.(map[string]interface{}); ok {
			riskFlags, recs := s.analyzeCronJobHealthFindings(cj, nil)
			if len(riskFlags) > 0 {
				meta, _ := cj["metadata"].(map[string]interface{})
				findings = append(findings, map[string]interface{}{
					"name":            meta["name"],
					"namespace":       meta["namespace"],
					"issues":          riskFlags,
					"recommendations": recs,
				})
			}
		}
	}
	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"total":     len(items),
		"unhealthy": len(findings),
		"timestamp": time.Now(),
	}, nil
}

// analyze_service_health
func (s *mcpServerImpl) handleAnalyzeServiceHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	if name != "" {
		var svc map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &svc); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("Service %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		var endpoints map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/endpoints"), &endpoints)
		var podsSelected []map[string]interface{}
		spec, _ := svc["spec"].(map[string]interface{})
		if spec != nil {
			if sel, ok := spec["selector"].(map[string]interface{}); ok && len(sel) > 0 {
				var parts []string
				for k, v := range sel {
					if vs, ok := v.(string); ok {
						parts = append(parts, k+"="+vs)
					}
				}
				if len(parts) > 0 {
					labelSel := strings.Join(parts, ",")
					path := c.clusterPath(clusterID, "/resources/pods"+nsQuery(namespace)) + "&labelSelector=" + url.QueryEscape(labelSel)
					var podList map[string]interface{}
					if err := c.get(ctx, path, &podList); err == nil {
						if items, ok := podList["items"].([]interface{}); ok {
							for range items {
								podsSelected = append(podsSelected, map[string]interface{}{})
							}
						}
					}
				}
			}
		}
		riskFlags, recommendations := s.analyzeServiceHealthFindings(svc, endpoints, podsSelected)
		status := "OK"
		if countEndpointAddresses(endpoints) == 0 {
			status = "Degraded"
		}
		return map[string]interface{}{
			"name":            name,
			"namespace":       namespace,
			"status":         status,
			"issues":          riskFlags,
			"risk_flags":      riskFlags,
			"recommendations": recommendations,
			"timestamp":       time.Now(),
		}, nil
	}

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &data); err != nil {
		return nil, err
	}
	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if svc, ok := item.(map[string]interface{}); ok {
			meta, _ := svc["metadata"].(map[string]interface{})
			svcName, _ := meta["name"].(string)
			svcNs, _ := meta["namespace"].(string)
			if svcNs == "" {
				svcNs = namespace
			}
			var endpoints map[string]interface{}
			_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(svcNs)+"/"+url.PathEscape(svcName)+"/endpoints"), &endpoints)
			spec, _ := svc["spec"].(map[string]interface{})
			var podsSelected []map[string]interface{}
			if spec != nil {
				if sel, ok := spec["selector"].(map[string]interface{}); ok && len(sel) > 0 {
					var parts []string
					for k, v := range sel {
						if vs, ok := v.(string); ok {
							parts = append(parts, k+"="+vs)
						}
					}
					if len(parts) > 0 {
						labelSel := strings.Join(parts, ",")
						path := c.clusterPath(clusterID, "/resources/pods"+nsQuery(svcNs)) + "&labelSelector=" + url.QueryEscape(labelSel)
						var podList map[string]interface{}
						if err := c.get(ctx, path, &podList); err == nil {
							if listItems, ok := podList["items"].([]interface{}); ok {
								for range listItems {
									podsSelected = append(podsSelected, map[string]interface{}{})
								}
							}
						}
					}
				}
			}
			riskFlags, recs := s.analyzeServiceHealthFindings(svc, endpoints, podsSelected)
			if len(riskFlags) > 0 {
				findings = append(findings, map[string]interface{}{
					"name":            svcName,
					"namespace":       svcNs,
					"issues":          riskFlags,
					"recommendations": recs,
				})
			}
		}
	}
	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"total":     len(items),
		"unhealthy": len(findings),
		"timestamp": time.Now(),
	}, nil
}

// analyze_ingress_health
func (s *mcpServerImpl) handleAnalyzeIngressHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	if name != "" {
		var ing map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &ing); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("Ingress %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		spec, _ := ing["spec"].(map[string]interface{})
		backendServices := extractIngressBackendServices(spec)
		for i := range backendServices {
			svcName := backendServices[i]["service_name"].(string)
			var svc map[string]interface{}
			err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(svcName)), &svc)
			backendServices[i]["exists"] = err == nil
		}
		riskFlags, recommendations := analyzeIngressHealthFindings(spec, backendServices)
		status := "OK"
		if len(riskFlags) > 0 {
			status = "Degraded"
		}
		return map[string]interface{}{
			"name":            name,
			"namespace":       namespace,
			"status":         status,
			"issues":          riskFlags,
			"risk_flags":      riskFlags,
			"recommendations": recommendations,
			"timestamp":       time.Now(),
		}, nil
	}

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses"+qs), &data); err != nil {
		return nil, err
	}
	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if ing, ok := item.(map[string]interface{}); ok {
			meta, _ := ing["metadata"].(map[string]interface{})
			ingName, _ := meta["name"].(string)
			ingNs, _ := meta["namespace"].(string)
			if ingNs == "" {
				ingNs = namespace
			}
			spec, _ := ing["spec"].(map[string]interface{})
			backendServices := extractIngressBackendServices(spec)
			for i := range backendServices {
				svcName := backendServices[i]["service_name"].(string)
				var svc map[string]interface{}
				errGet := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(ingNs)+"/"+url.PathEscape(svcName)), &svc)
				backendServices[i]["exists"] = errGet == nil
			}
			riskFlags, recs := analyzeIngressHealthFindings(spec, backendServices)
			if len(riskFlags) > 0 {
				findings = append(findings, map[string]interface{}{
					"name":            ingName,
					"namespace":       ingNs,
					"issues":          riskFlags,
					"recommendations": recs,
				})
			}
		}
	}
	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"total":     len(items),
		"unhealthy": len(findings),
		"timestamp": time.Now(),
	}, nil
}

// analyze_daemonset_health
func (s *mcpServerImpl) handleAnalyzeDaemonSetHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	var data map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/daemonsets"+qs), &data); err != nil {
		return nil, err
	}

	items, _ := data["items"].([]interface{})
	findings := []map[string]interface{}{}
	for _, item := range items {
		if ds, ok := item.(map[string]interface{}); ok {
			status, _ := ds["status"].(map[string]interface{})
			desired := int(status["desiredNumberScheduled"].(float64))
			ready := int(status["numberReady"].(float64))

			if ready < desired {
				findings = append(findings, map[string]interface{}{
					"name":           ds["metadata"].(map[string]interface{})["name"],
					"namespace":      ds["metadata"].(map[string]interface{})["namespace"],
					"issue":          "NODE_COVERAGE_GAP",
					"severity":       "MEDIUM",
					"ready":          ready,
					"desired":        desired,
					"recommendation": "DaemonSet is not running on all target nodes. Check node taints or resource pressure on schedule-failed nodes.",
				})
			}
		}
	}

	return map[string]interface{}{
		"namespace": namespace,
		"findings":  findings,
		"timestamp": time.Now(),
	}, nil
}

func (s *mcpServerImpl) getRecommendation(reason string) string {
	switch reason {
	case "CrashLoopBackOff":
		return "Application is crashing immediately. Check logs using observe_pod_logs with filter=error and observe_pod_events."
	case "ImagePullBackOff":
		return "Kubernetes cannot pull the image. Verify image name, tag, and registry credentials."
	case "CreateContainerConfigError":
		return "Check for missing ConfigMaps or Secrets referenced in the pod spec."
	default:
		return "Investigate resource events for more details."
	}
}

// recommendationsFromFindings maps each risk flag (type) to deterministic recommendation text (pod_risk_rules.yaml).
func (s *mcpServerImpl) recommendationsFromFindings(findings []map[string]interface{}) []string {
	seen := make(map[string]bool)
	var recs []string
	for _, f := range findings {
		typ, _ := f["type"].(string)
		if typ == "" || seen[typ] {
			continue
		}
		if sev, _ := f["severity"].(string); sev == "INFO" {
			continue
		}
		seen[typ] = true
		if r, ok := f["recommendation"].(string); ok && r != "" {
			recs = append(recs, r)
			continue
		}
		switch typ {
		case "OOM_RISK", "OOM_KILLED":
			recs = append(recs, "Increase memory limit or optimize memory consumption. Check observe_pod_logs_filtered(filter=error) for OOM patterns.")
		case "HIGH_RESTART_COUNT":
			recs = append(recs, "Inspect logs and investigate crash reasons. Use observe_pod_logs_filtered(filter=error) and observe_pod_events.")
		case "CRASH_LOOP", "CONTAINER_STUCK":
			recs = append(recs, "Container is in CrashLoopBackOff. Check observe_pod_logs and last termination reason; consider rollback or fix image/config.")
		case "IMAGE_LATEST_TAG_USED", "IMAGE_LATEST_TAG":
			recs = append(recs, "Avoid :latest in production; use specific version tags or digests for immutability.")
		case "NO_RESOURCE_LIMITS_DEFINED":
			recs = append(recs, "Set resource limits to avoid noisy-neighbour and OOM. Prefer requests and limits for both CPU and memory.")
		case "CPU_THROTTLE_RISK":
			recs = append(recs, "CPU usage near limit may cause throttling. Increase CPU limit or optimize workload.")
		case "POD_NOT_READY":
			recs = append(recs, "Check readiness probes and application startup time.")
		default:
			recs = append(recs, "Investigate resource events and logs for more details.")
		}
	}
	return recs
}

// mergeMetricsRisks appends OOM_RISK and CPU_THROTTLE_RISK when metrics show usage near limits.
func (s *mcpServerImpl) mergeMetricsRisks(findings []map[string]interface{}, pod, metrics map[string]interface{}) []map[string]interface{} {
	if metrics == nil || pod == nil {
		return findings
	}
	spec, _ := pod["spec"].(map[string]interface{})
	if spec == nil {
		return findings
	}
	containers, _ := spec["containers"].([]interface{})
	// Backend metrics shape may be per-container or aggregated; try to get usage vs limit
	memUsage, _ := metrics["memory"].(float64)
	memLimit, _ := metrics["memoryLimit"].(float64)
	cpuUsage, _ := metrics["cpu"].(float64)
	cpuLimit, _ := metrics["cpuLimit"].(float64)
	if len(containers) > 0 {
		// If we have per-container metrics they might be in containers array
		if conts, ok := metrics["containers"].([]interface{}); ok && len(conts) > 0 {
			for _, c := range conts {
				cm, ok := c.(map[string]interface{})
				if !ok {
					continue
				}
				usage, _ := cm["usage"].(map[string]interface{})
				limit, _ := cm["limits"].(map[string]interface{})
				if usage != nil && limit != nil {
					// Simplified: if usage/limit > 0.9 flag risk
					mU, _ := toFloat(usage["memory"])
					mL, _ := toFloat(limit["memory"])
					if mL > 0 && mU/mL > 0.9 {
						findings = append(findings, map[string]interface{}{
							"type":           "OOM_RISK",
							"severity":       "HIGH",
							"container":      cm["name"],
							"recommendation": "Increase memory limit or optimize memory consumption.",
						})
					}
					cU, _ := toFloat(usage["cpu"])
					cL, _ := toFloat(limit["cpu"])
					if cL > 0 && cU/cL > 0.9 {
						findings = append(findings, map[string]interface{}{
							"type":           "CPU_THROTTLE_RISK",
							"severity":       "MEDIUM",
							"container":      cm["name"],
							"recommendation": "CPU usage near limit may cause throttling. Increase CPU limit or optimize workload.",
						})
					}
				}
			}
			return findings
		}
	}
	if memLimit > 0 && memUsage > 0 && memUsage/memLimit > 0.9 {
		findings = append(findings, map[string]interface{}{
			"type":           "OOM_RISK",
			"severity":       "HIGH",
			"recommendation": "Increase memory limit or optimize memory consumption.",
		})
	}
	if cpuLimit > 0 && cpuUsage > 0 && cpuUsage/cpuLimit > 0.9 {
		findings = append(findings, map[string]interface{}{
			"type":           "CPU_THROTTLE_RISK",
			"severity":       "MEDIUM",
			"recommendation": "CPU usage near limit may cause throttling. Increase CPU limit or optimize workload.",
		})
	}
	return findings
}

func toFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

// ════════════════════════════════════════════════════════════════════════════
// TROUBLESHOOTING TOOLS
// ════════════════════════════════════════════════════════════════════════════

// routeTroubleshootingTool routes all troubleshooting tool names to their handlers.
func (s *mcpServerImpl) routeTroubleshootingTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	switch name {
	case "troubleshoot_pod_failures":
		return s.handleTroubleshootPodFailures(ctx, args)
	case "troubleshoot_network_issues":
		return s.handleTroubleshootNetworkIssues(ctx, args)
	case "troubleshoot_performance_degradation":
		return s.handleTroubleshootPerformanceDegradation(ctx, args)
	case "troubleshoot_deployment_failures":
		return s.handleTroubleshootDeploymentFailures(ctx, args)
	case "troubleshoot_resource_constraints":
		return s.handleTroubleshootResourceConstraints(ctx, args)
	case "troubleshoot_rbac_issues":
		return s.handleTroubleshootRBACIssues(ctx, args)
	case "troubleshoot_storage_issues":
		return s.handleTroubleshootStorageIssues(ctx, args)
	default:
		return nil, fmt.Errorf("troubleshooting tool not implemented: %s", name)
	}
}

func (s *mcpServerImpl) handleTroubleshootPodFailures(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	podName := strArg(args, "pod_name")

	result := map[string]interface{}{}

	if podName != "" && namespace != "" {
		// Detailed single pod investigation
		var pod map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)), &pod); err == nil {
			result["pod"] = pod
		}
		// Logs
		req, _ := newHTTPRequest(ctx, "GET", c.baseURL+c.clusterPath(clusterID, "/logs/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)+"?tail=200"))
		if req != nil {
			if resp, err := c.httpClient.Do(req); err == nil {
				defer resp.Body.Close()
				buf := make([]byte, 32*1024)
				n, _ := resp.Body.Read(buf)
				result["recent_logs"] = string(buf[:n])
			}
		}
	}

	// Events scoped to namespace or pod
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	// All pods to see restartCounts
	qs := nsQuery(namespace)
	var pods map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods); err == nil {
		result["pods"] = pods
	}
	result["analysis_hint"] = "Check pod.status.containerStatuses[].state for Waiting/Terminated reasons. CrashLoopBackOff = app crash; ImagePullBackOff = registry issue; OOMKilled = memory limit too low."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootNetworkIssues(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var svcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+qs), &svcs); err == nil {
		result["services"] = svcs
	}
	var policies map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &policies); err == nil {
		result["network_policies"] = policies
	}
	var ingresses map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses"+qs), &ingresses); err == nil {
		result["ingresses"] = ingresses
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Check for NetworkPolicies blocking traffic, Services with no matching endpoints, and Ingress misconfigurations. DNS issues: look for coredns pod restarts."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootPerformanceDegradation(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	return s.handleAnalyzePerformanceBottlenecks(ctx, args)
}

func (s *mcpServerImpl) handleTroubleshootDeploymentFailures(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	if name != "" && namespace != "" {
		var deploy map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &deploy); err == nil {
			result["deployment"] = deploy
		}
		var history map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history"), &history); err == nil {
			result["rollout_history"] = history
		}
	} else {
		var deploys map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys); err == nil {
			result["deployments"] = deploys
		}
	}
	var replicasets map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+qs), &replicasets); err == nil {
		result["replicasets"] = replicasets
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "Look for ReplicaSet with 0 available replicas; check deployment conditions for Progressing=False. Common causes: image pull failure, resource limits, or PodDisruptionBudget blocks."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootResourceConstraints(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err == nil {
		result["nodes"] = nodes
	}
	var metrics map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics); err == nil {
		result["cluster_metrics"] = metrics
	}
	var quotas map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/resourcequotas"+qs), &quotas); err == nil {
		result["resource_quotas"] = quotas
	}
	var limits map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/limitranges"+qs), &limits); err == nil {
		result["limit_ranges"] = limits
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "ResourceQuota exceeded blocks pod creation. LimitRange default limits may cause OOM. Node pressure taints prevent scheduling. Check events for 'Insufficient CPU/memory'."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootRBACIssues(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var roles map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/roles"+qs), &roles); err == nil {
		result["roles"] = roles
	}
	var rb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rb); err == nil {
		result["role_bindings"] = rb
	}
	var croles map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles"), &croles); err == nil {
		result["cluster_roles"] = croles
	}
	var crb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crb); err == nil {
		result["cluster_role_bindings"] = crb
	}
	var sa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/serviceaccounts"+qs), &sa); err == nil {
		result["service_accounts"] = sa
	}
	result["analysis_hint"] = "Match the serviceAccountName in the failing pod with RoleBindings/ClusterRoleBindings. Check if the bound Role has the required verbs for the needed resources."
	return result, nil
}

func (s *mcpServerImpl) handleTroubleshootStorageIssues(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{}
	var pvcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims"+qs), &pvcs); err == nil {
		result["pvcs"] = pvcs
	}
	var pvs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs); err == nil {
		result["pvs"] = pvs
	}
	var sc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses"), &sc); err == nil {
		result["storage_classes"] = sc
	}
	q := url.Values{}
	q.Set("limit", "100")
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err == nil {
		result["events"] = events
	}
	result["analysis_hint"] = "PVC Pending = no matching PV or StorageClass provisioner unavailable. PVC Terminating stuck = finalizer or data-protection webhook blocking. Check events for FailedMount errors."
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION TOOLS (stub implementations — AI synthesises from obs data)
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeRecommendationTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	// Recommendation tools are AI-synthesis tools; they gather raw data then let
	// the LLM generate the recommendations.
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	base := map[string]interface{}{"tool": name, "cluster_id": clusterID}

	switch name {
	case "recommend_resource_optimization":
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		var deploys map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		base["metrics_summary"] = metrics
		base["deployments"] = deploys
		base["recommendation_hint"] = "Identify containers with requests >> actual usage and suggest rightsizing. Recommend VPA for variable workloads."

	case "recommend_cost_reduction":
		var nodes map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
		var pvs map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics)
		base["nodes"] = nodes
		base["persistent_volumes"] = pvs
		base["cluster_metrics"] = metrics
		base["recommendation_hint"] = "Look for idle nodes (low CPU/memory), Released PVs, and over-replicated workloads. Spot/preemptible nodes for stateless workloads."

	case "recommend_security_hardening":
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		var netpol map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies"+qs), &netpol)
		var rb map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rb)
		base["pods"] = pods
		base["network_policies"] = netpol
		base["role_bindings"] = rb
		base["recommendation_hint"] = "Flag containers running as root, privileged containers, hostNetwork/hostPID, missing NetworkPolicies, and overly broad ClusterRoleBindings."

	case "recommend_scaling_strategy":
		var hpa map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers"+qs), &hpa)
		var deploys map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
		var metrics map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
		base["hpas"] = hpa
		base["deployments"] = deploys
		base["metrics_summary"] = metrics
		base["recommendation_hint"] = "Deployments without HPA and variable load → suggest HPA with CPU/memory targets. Predictable load → KEDA event-driven autoscaling."

	default:
		// For remaining recommendation tools, return cluster overview
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		base["overview"] = overview
		base["recommendation_hint"] = fmt.Sprintf("Generate %s recommendations based on the cluster state above.", name)
	}
	return base, nil
}

// ════════════════════════════════════════════════════════════════════════════
// SECURITY TOOLS
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeSecurityTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{"tool": name, "cluster_id": clusterID}

	switch name {
	case "security_scan_cluster", "security_check_pod_security":
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		var psp map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/podsecuritypolicies"), &psp)
		result["pods"] = pods
		result["pod_security_policies"] = psp
		result["security_hint"] = "Check for privileged:true, runAsRoot, hostNetwork, hostPID, missing securityContext, and wildcard RBAC verbs."

	case "security_audit_rbac":
		var croles map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles"), &croles)
		var crb map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &crb)
		var roles map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/roles"+qs), &roles)
		var rb map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings"+qs), &rb)
		result["cluster_roles"] = croles
		result["cluster_role_bindings"] = crb
		result["roles"] = roles
		result["role_bindings"] = rb
		result["security_hint"] = "Flag cluster-admin bindings to non-system accounts, wildcard resource/verb rules, and service accounts with unnecessary permissions."

	case "security_scan_secrets":
		var secrets map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets"+qs), &secrets)
		result["secrets"] = secrets
		result["security_hint"] = "Identify secrets of type Opaque that may contain plaintext credentials, secrets mounted in too many pods, and secrets older than 90 days."

	case "security_compliance_report":
		var overview map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)
		var pods map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/pods"+qs), &pods)
		result["overview"] = overview
		result["pods"] = pods
		result["security_hint"] = "Map findings to CIS Benchmark controls: network segmentation (5.3), least-privilege RBAC (5.1), pod security (5.2), and audit logging (3.2)."
	}
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// COST TOOLS
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeCostTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	qs := nsQuery(namespace)

	result := map[string]interface{}{"tool": name, "cluster_id": clusterID}
	// All cost tools need nodes + workload counts + metrics
	var nodes map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &metrics)
	var deploys map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments"+qs), &deploys)
	var pvs map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs)

	result["nodes"] = nodes
	result["metrics_summary"] = metrics
	result["deployments"] = deploys
	result["persistent_volumes"] = pvs

	switch name {
	case "cost_identify_waste":
		result["cost_hint"] = "Nodes <20% CPU utilisation are idle candidates. PVs in Released state are unused. Deployments with replica count > needed waste compute."
	case "cost_forecast_spending":
		result["cost_hint"] = "Use current node count × cloud instance price as baseline. Factor replica growth rate from HPA metrics to project 30/60/90 day spend."
	case "cost_optimization_plan":
		result["cost_hint"] = "Prioritise: (1) rightsize over-provisioned pods, (2) consolidate idle nodes, (3) delete Released PVs, (4) move dev workloads to spot/preemptible."
	default:
		result["cost_hint"] = "Analyse the workload resource requests vs actual usage to estimate monthly compute cost."
	}
	return result, nil
}

// ════════════════════════════════════════════════════════════════════════════
// ACTION TOOLS (mutating — require explicit approval in calling UI)
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeActionTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	// NOTE: Action tools mutate cluster state. The AI server enforces that action
	// tools are only executed when the autonomy level grants permission. The LLM
	// must present the proposed action to the user and receive approval before
	// calling these tools.
	return nil, fmt.Errorf("action tool '%s' requires explicit user approval — not auto-executed", name)
}

// ════════════════════════════════════════════════════════════════════════════
// AUTOMATION TOOLS
// ════════════════════════════════════════════════════════════════════════════

func (s *mcpServerImpl) routeAutomationTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	// Automation tools generate runbooks / workflow definitions — they are
	// read-only planning tools that produce YAML/Markdown outputs.
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	var overview map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview)

	return map[string]interface{}{
		"tool":             name,
		"cluster_id":       clusterID,
		"cluster_overview": overview,
		"automation_hint":  fmt.Sprintf("Generate a %s based on the cluster state above. Output as structured YAML or Markdown runbook.", name),
	}, nil
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════
