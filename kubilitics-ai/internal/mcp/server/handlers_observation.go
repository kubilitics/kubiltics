package server

// handlers_observation.go — full implementation of all 16 observation tool handlers.
//
// Each handler:
//   1. Extracts & validates args
//   2. Calls the kubilitics-backend REST API via backendHTTP
//   3. Returns a structured map the LLM can reason about
//
// All handlers are read-only (no cluster mutations).

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// jsonUnmarshal is a local alias to avoid conflict with potential package-level json var.
var jsonUnmarshal = json.Unmarshal

// kindToRestPlural converts a Kubernetes resource Kind to the lowercase plural form
// expected by the kubilitics-backend REST API (e.g. "Pod" → "pods", "NetworkPolicy" → "networkpolicies").
func kindToRestPlural(kind string) string {
	lower := strings.ToLower(kind)
	switch lower {
	case "networkpolicy":
		return "networkpolicies"
	case "rolebinding":
		return "rolebindings"
	case "clusterrolebinding":
		return "clusterrolebindings"
	case "persistentvolumeclaim":
		return "persistentvolumeclaims"
	case "persistentvolume":
		return "persistentvolumes"
	case "storageclass":
		return "storageclasses"
	case "horizontalpodautoscaler":
		return "horizontalpodautoscalers"
	case "serviceaccount":
		return "serviceaccounts"
	case "configmap":
		return "configmaps"
	case "secret":
		return "secrets"
	case "ingressclass":
		return "ingressclasses"
	case "endpoint", "endpoints":
		return "endpoints"
	case "endpointslice":
		return "endpointslices"
	case "resourcequota":
		return "resourcequotas"
	case "poddisruptionbudget":
		return "poddisruptionbudgets"
	default:
		if !strings.HasSuffix(lower, "s") {
			return lower + "s"
		}
		return lower
	}
}

// httpClient returns a lazy-initialised backendHTTP for this server instance.
// The base URL is taken from the MCP server config.
func (s *mcpServerImpl) http() *backendHTTP {
	baseURL := s.config.Backend.HTTPBaseURL
	if baseURL == "" {
		baseURL = "http://localhost:819"
	}
	return newBackendHTTP(baseURL)
}

// ─── observe_cluster_overview ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleClusterOverview(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"cluster_id": clusterID,
		"timestamp":  time.Now(),
	}

	// /overview gives health, counts, alerts — primary source
	var overview map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview); err == nil {
		result["overview"] = overview
	}

	// /workloads gives richer workload health data — merge in
	var workloads map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/workloads"), &workloads); err == nil {
		result["workloads"] = workloads
	}

	// If we got at least one, return combined result
	if result["overview"] != nil || result["workloads"] != nil {
		return result, nil
	}

	// Final fallback to /summary
	var summary map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/summary"), &summary); err != nil {
		return nil, fmt.Errorf("cluster overview: all endpoints failed")
	}
	result["summary"] = summary
	return result, nil
}

// ─── observe_resource ─────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleObserveResource(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	kind := strArg(args, "kind")
	if kind == "" {
		return nil, fmt.Errorf("observe_resource: 'kind' is required")
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_resource: 'name' is required")
	}
	namespace := strArg(args, "namespace")

	// Backend route: GET /resources/{kindPlural}/{namespace}/{name}
	// The backend uses lowercase plural kind names (e.g. "pods", "deployments").
	var resource map[string]interface{}
	path := c.clusterPath(clusterID, "/resources/"+url.PathEscape(kindToRestPlural(kind))+"/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, path, &resource); err != nil {
		return nil, err
	}
	return resource, nil
}

// ─── observe_resources_by_query ───────────────────────────────────────────────

func (s *mcpServerImpl) handleResourcesByQuery(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	query := strings.TrimSpace(strArg(args, "query"))
	namespace := strArg(args, "namespace")
	kind := strArg(args, "kind")
	limit := intArg(args, "limit", 25)

	// If no search query is given, fall back to listing resources by kind/namespace
	// or returning the cluster overview. This avoids the backend 400 for empty q=.
	// Backend list route: GET /resources/{kindPlural}?namespace={ns}
	if query == "" {
		if kind != "" {
			// Build the correct list path: /resources/{kindPlural}?namespace={ns}
			listPath := c.clusterPath(clusterID, "/resources/"+url.PathEscape(kindToRestPlural(kind)))
			if namespace != "" {
				listPath += "?namespace=" + url.QueryEscape(namespace)
			}
			var listResults interface{}
			if listErr := c.get(ctx, listPath, &listResults); listErr == nil {
				return listResults, nil
			}
		}
		// No kind either — return workloads overview as it's the richest summary.
		var workloads map[string]interface{}
		if wErr := c.get(ctx, c.clusterPath(clusterID, "/workloads"), &workloads); wErr == nil {
			return workloads, nil
		}
		// Fallback chain: overview → summary
		var overview map[string]interface{}
		if ovErr := c.get(ctx, c.clusterPath(clusterID, "/overview"), &overview); ovErr == nil {
			return overview, nil
		}
		var summary map[string]interface{}
		if sumErr := c.get(ctx, c.clusterPath(clusterID, "/summary"), &summary); sumErr == nil {
			return summary, nil
		}
		return nil, fmt.Errorf("observe_resources_by_query: 'query' parameter is required for search")
	}

	q := url.Values{}
	q.Set("q", query)
	q.Set("limit", fmt.Sprint(limit))
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	if kind != "" {
		q.Set("kind", kind)
	}

	var results map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/search?"+q.Encode()), &results); err != nil {
		return nil, err
	}
	return results, nil
}

// ─── observe_pod_logs ─────────────────────────────────────────────────────────

func (s *mcpServerImpl) handlePodLogs(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	if namespace == "" {
		namespace = "default"
	}
	podName := strArg(args, "pod_name")
	if podName == "" {
		return nil, fmt.Errorf("observe_pod_logs: 'pod_name' is required")
	}
	container := strArg(args, "container_name")
	tailLines := intArg(args, "tail_lines", 10)
	filter := strArg(args, "filter")

	q := url.Values{}
	// Increase internal tail if filtering is requested to ensure we find matches
	internalTail := tailLines
	if filter != "" {
		internalTail = 1000 // Look through last 1000 lines for filter
	}
	q.Set("tail", fmt.Sprint(internalTail))
	if container != "" {
		q.Set("container", container)
	}

	path := c.clusterPath(clusterID, "/logs/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)+"?"+q.Encode())

	// Logs endpoint returns plain text
	req, err := newHTTPRequest(ctx, "GET", c.baseURL+path)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pod logs: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	logText := string(body)

	// Apply filtering if specified
	var filteredLogs []string
	lines := strings.Split(logText, "\n")
	if filter != "" {
		filterLower := strings.ToLower(filter)
		for _, line := range lines {
			if strings.Contains(strings.ToLower(line), filterLower) {
				filteredLogs = append(filteredLogs, line)
			}
		}
		// Final tail on filtered results
		if len(filteredLogs) > tailLines {
			filteredLogs = filteredLogs[len(filteredLogs)-tailLines:]
		}
	} else {
		if len(lines) > tailLines {
			filteredLogs = lines[len(lines)-tailLines:]
		} else {
			filteredLogs = lines
		}
	}

	return map[string]interface{}{
		"pod":       podName,
		"namespace": namespace,
		"container": container,
		"filter":    filter,
		"tail":      tailLines,
		"logs":      strings.Join(filteredLogs, "\n"),
	}, nil
}

// ─── observe_pod_detailed ───────────────────────────────────────────────────

func (s *mcpServerImpl) handlePodDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pod_detailed: 'namespace' and 'name' are required")
	}

	// 1. Fetch Pod
	var pod map[string]interface{}
	podPath := c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, podPath, &pod); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Pod %q not found in namespace %q", name, namespace)
		}
		return nil, fmt.Errorf("failed to fetch pod: %w", err)
	}

	// 2. Fetch Metrics (optional)
	var metrics map[string]interface{}
	metricsPath := c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	_ = c.get(ctx, metricsPath, &metrics)

	// 3. Fetch events for this pod (last 10, PRD)
	var podEvents interface{}
	evQ := url.Values{}
	evQ.Set("namespace", namespace)
	evQ.Set("limit", "10")
	evQ.Set("involvedObjectKind", "Pod")
	evQ.Set("involvedObjectName", name)
	_ = c.get(ctx, c.clusterPath(clusterID, "/events?"+evQ.Encode()), &podEvents)

	// 4. Fetch logs per container (keyed by container name; tail 10)
	logsByContainer := s.fetchPodLogsByContainer(ctx, c, clusterID, namespace, name, pod, 10)

	// 5. Services selecting this pod
	var services []string
	var allSvcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services"+nsQuery(namespace)), &allSvcs); err == nil {
		if items, ok := allSvcs["items"].([]interface{}); ok {
			podLabels, _ := pod["metadata"].(map[string]interface{})["labels"].(map[string]interface{})
			for _, item := range items {
				if svc, ok := item.(map[string]interface{}); ok {
					if spec, ok := svc["spec"].(map[string]interface{}); ok {
						if selector, ok := spec["selector"].(map[string]interface{}); ok {
							match := true
							for k, v := range selector {
								if podLabels[k] != v {
									match = false
									break
								}
							}
							if match && len(selector) > 0 {
								services = append(services, svc["metadata"].(map[string]interface{})["name"].(string))
							}
						}
					}
				}
			}
		}
	}

	// 6. Health findings (deterministic risk rules) + metrics-based OOM/CPU throttle
	healthFindings := s.analyzeSinglePodHealth(pod)
	if metrics != nil {
		healthFindings = s.mergeMetricsRisks(healthFindings, pod, metrics)
	}

	// 7. Assemble PRD-aligned output
	spec, _ := pod["spec"].(map[string]interface{})
	status, _ := pod["status"].(map[string]interface{})

	detailed := map[string]interface{}{
		"pod":                 pod,
		"metadata":            s.extractPodMetadata(pod, status),
		"data": map[string]interface{}{
			"containers":       s.extractContainerStatuses(status, spec, false),
			"init_containers":  s.extractContainerStatuses(status, spec, true),
			"security_context": s.extractPodSecurityContext(spec),
			"volumes":          s.extractVolumes(spec),
		},
		"metrics":             s.normalizePodMetrics(metrics),
		"events":              podEvents,
		"logs":                logsByContainer,
		"relationships": s.buildPodRelationships(ctx, c, clusterID, namespace, pod, spec, services),
		"risk_flags":          healthFindings,
		"recommendations":     s.recommendationsFromFindings(healthFindings),
		"timestamp":           time.Now(),
	}

	if spec != nil {
		detailed["resources"] = s.extractHumanResources(spec)
		detailed["image_pull_policy"] = s.extractImagePullPolicy(spec)
		detailed["ownership_chain"] = s.getOwnerChain(ctx, clusterID, pod)
		detailed["dependency_summary"] = s.summarizeDependencies(spec)
	}

	return detailed, nil
}

func (s *mcpServerImpl) handlePodDependencies(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pod_dependencies: 'namespace' and 'name' are required")
	}

	var pod map[string]interface{}
	podPath := c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, podPath, &pod); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Pod %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}

	spec, ok := pod["spec"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid pod spec")
	}

	deps := s.extractPodDependencyLists(ctx, c, clusterID, namespace, spec)

	return map[string]interface{}{
		"pod":          name,
		"namespace":    namespace,
		"dependencies": deps,
		"timestamp":    time.Now(),
	}, nil
}

// buildPodRelationships returns the full relationships block for observe_pod_detailed (PRD: ownership_chain, services_selecting, pvc_chain, config_maps, secrets).
func (s *mcpServerImpl) buildPodRelationships(ctx context.Context, c *backendHTTP, clusterID, namespace string, pod map[string]interface{}, spec map[string]interface{}, services []string) map[string]interface{} {
	deps := s.extractPodDependencyLists(ctx, c, clusterID, namespace, spec)
	return map[string]interface{}{
		"ownership_chain":     s.getOwnerChain(ctx, clusterID, pod),
		"services_selecting":  services,
		"dependency_summary":  s.summarizeDependencies(spec),
		"pvc_chain":           deps["pvc_chains"],
		"config_maps":         deps["config_maps"],
		"secrets":             deps["secrets"],
	}
}

// extractPodDependencyLists returns config_maps, secrets, and pvc_chains (PV → PVC → Pod) for a pod spec.
func (s *mcpServerImpl) extractPodDependencyLists(ctx context.Context, c *backendHTTP, clusterID, namespace string, spec map[string]interface{}) map[string]interface{} {
	deps := map[string]interface{}{
		"config_maps": []string{},
		"secrets":     []string{},
		"pvc_chains":  []map[string]interface{}{},
	}
	if spec == nil {
		return deps
	}
	// Volumes
	if volumes, ok := spec["volumes"].([]interface{}); ok {
		for _, v := range volumes {
			if m, ok := v.(map[string]interface{}); ok {
				if cm, ok := m["configMap"].(map[string]interface{}); ok {
					if n, ok := cm["name"].(string); ok {
						deps["config_maps"] = append(deps["config_maps"].([]string), n)
					}
				}
				if sec, ok := m["secret"].(map[string]interface{}); ok {
					if n, ok := sec["secretName"].(string); ok {
						deps["secrets"] = append(deps["secrets"].([]string), n)
					}
				}
				if pvc, ok := m["persistentVolumeClaim"].(map[string]interface{}); ok {
					if pvcName, ok := pvc["claimName"].(string); ok {
						chain := map[string]interface{}{"pvc": pvcName}
						var pvcObj map[string]interface{}
						if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims/"+url.PathEscape(namespace)+"/"+url.PathEscape(pvcName)), &pvcObj); err == nil {
							if pspec, ok := pvcObj["spec"].(map[string]interface{}); ok {
								if pvName, ok := pspec["volumeName"].(string); ok {
									chain["pv"] = pvName
								}
							}
						}
						deps["pvc_chains"] = append(deps["pvc_chains"].([]map[string]interface{}), chain)
					}
				}
			}
		}
	}
	// envFrom
	if containers, ok := spec["containers"].([]interface{}); ok {
		for _, co := range containers {
			if m, ok := co.(map[string]interface{}); ok {
				if envFrom, ok := m["envFrom"].([]interface{}); ok {
					for _, ef := range envFrom {
						if efm, ok := ef.(map[string]interface{}); ok {
							if cm, ok := efm["configMapRef"].(map[string]interface{}); ok {
								if n, ok := cm["name"].(string); ok {
									deps["config_maps"] = append(deps["config_maps"].([]string), n)
								}
							}
							if sec, ok := efm["secretRef"].(map[string]interface{}); ok {
								if n, ok := sec["name"].(string); ok {
									deps["secrets"] = append(deps["secrets"].([]string), n)
								}
							}
						}
					}
				}
			}
		}
	}
	return deps
}

func (s *mcpServerImpl) getOwnerChain(ctx context.Context, clusterID string, obj map[string]interface{}) []map[string]interface{} {
	chain := []map[string]interface{}{}
	current := obj
	for {
		metadata, ok := current["metadata"].(map[string]interface{})
		if !ok {
			break
		}
		owners, ok := metadata["ownerReferences"].([]interface{})
		if !ok || len(owners) == 0 {
			break
		}
		// Follow the first owner (usually the controller)
		owner := owners[0].(map[string]interface{})
		kind := owner["kind"].(string)
		name := owner["name"].(string)
		namespace := metadata["namespace"].(string)

		chain = append(chain, map[string]interface{}{
			"kind": kind,
			"name": name,
		})

		// Try to fetch the owner to continue the chain
		var next map[string]interface{}
		kindMap := map[string]string{
			"ReplicaSet": "replicasets",
			"Job":        "jobs",
		}
		pluralKind, ok := kindMap[kind]
		if !ok {
			break // Don't know how to fetch next level or it's a top-level (e.g. Deployment)
		}

		path := s.http().clusterPath(clusterID, "/resources/"+pluralKind+"/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
		if err := s.http().get(ctx, path, &next); err != nil {
			break
		}
		current = next
	}
	return chain
}

func (s *mcpServerImpl) summarizeDependencies(spec map[string]interface{}) map[string]int {
	summary := map[string]int{"config_maps": 0, "secrets": 0, "pvcs": 0}
	if spec == nil {
		return summary
	}
	if volumes, ok := spec["volumes"].([]interface{}); ok {
		for _, v := range volumes {
			if m, ok := v.(map[string]interface{}); ok {
				if _, ok := m["configMap"]; ok {
					summary["config_maps"]++
				}
				if _, ok := m["secret"]; ok {
					summary["secrets"]++
				}
				if _, ok := m["persistentVolumeClaim"]; ok {
					summary["pvcs"]++
				}
			}
		}
	}
	return summary
}

// ─── observe_resource_links ──────────────────────────────────────────────────

func (s *mcpServerImpl) handleResourceLinks(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	kind := strArg(args, "kind")
	name := strArg(args, "name")

	// This tool leverages the topology endpoint to find links
	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	path := c.clusterPath(clusterID, "/topology?"+q.Encode())

	var topology map[string]interface{}
	if err := c.get(ctx, path, &topology); err != nil {
		return nil, err
	}

	// Filter topology to find links for the specific resource if provided
	if name != "" && kind != "" {
		return s.filterTopologyForResource(topology, kind, name, namespace), nil
	}

	return topology, nil
}

// Helpers

func (s *mcpServerImpl) extractHumanResources(spec map[string]interface{}) interface{} {
	containers, ok := spec["containers"].([]interface{})
	if !ok {
		return nil
	}
	res := make([]map[string]interface{}, 0)
	for _, c := range containers {
		cont, ok := c.(map[string]interface{})
		if !ok {
			continue
		}

		// Map resources into a more explicit structure for the AI
		resources, _ := cont["resources"].(map[string]interface{})
		res = append(res, map[string]interface{}{
			"container_name": cont["name"],
			"requests":       resources["requests"],
			"limits":         resources["limits"],
			"note":           "Memory is typically in Mi/Gi, CPU in m (millicores) or cores.",
		})
	}
	return res
}

func (s *mcpServerImpl) extractImagePullPolicy(spec map[string]interface{}) interface{} {
	containers, ok := spec["containers"].([]interface{})
	if !ok {
		return nil
	}
	policies := make(map[string]string)
	for _, c := range containers {
		cont, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := cont["name"].(string)
		policy, _ := cont["imagePullPolicy"].(string)
		policies[name] = policy
	}
	return policies
}

func (s *mcpServerImpl) filterTopologyForResource(topo map[string]interface{}, kind, name, ns string) interface{} {
	// Simple implementation: return the full topology but highlight the node
	// Real implementation would prune the graph.
	return topo
}

// fetchPodLogsByContainer fetches logs for each container (and init containers) and returns a map keyed by container name.
func (s *mcpServerImpl) fetchPodLogsByContainer(ctx context.Context, c *backendHTTP, clusterID, namespace, podName string, pod map[string]interface{}, tailLines int) map[string]string {
	out := make(map[string]string)
	spec, _ := pod["spec"].(map[string]interface{})
	if spec == nil {
		return out
	}
	containers := []string{}
	if conts, ok := spec["containers"].([]interface{}); ok {
		for _, co := range conts {
			if m, ok := co.(map[string]interface{}); ok {
				if n, ok := m["name"].(string); ok {
					containers = append(containers, n)
				}
			}
		}
	}
	for _, contName := range containers {
		q := url.Values{}
		q.Set("tail", fmt.Sprint(tailLines))
		q.Set("container", contName)
		path := c.clusterPath(clusterID, "/logs/"+url.PathEscape(namespace)+"/"+url.PathEscape(podName)+"?"+q.Encode())
		req, err := newHTTPRequest(ctx, "GET", c.baseURL+path)
		if err != nil {
			continue
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		out[contName] = string(body)
	}
	return out
}

// extractPodMetadata returns PRD metadata: conditions, qos_class, service_account.
func (s *mcpServerImpl) extractPodMetadata(pod, status map[string]interface{}) map[string]interface{} {
	meta := map[string]interface{}{
		"name":            getStr(pod, "metadata", "name"),
		"namespace":       getStr(pod, "metadata", "namespace"),
		"node":            getStr(pod, "spec", "nodeName"),
		"phase":           getStr(status, "phase"),
		"qos_class":       getStr(status, "qosClass"),
		"service_account": getStr(pod, "spec", "serviceAccountName"),
	}
	if meta["service_account"] == "" {
		meta["service_account"] = getStr(pod, "spec", "deprecatedServiceAccount")
	}
	if status != nil {
		if conditions, ok := status["conditions"].([]interface{}); ok {
		conds := make([]map[string]interface{}, 0, len(conditions))
		for _, c := range conditions {
			if m, ok := c.(map[string]interface{}); ok {
				conds = append(conds, map[string]interface{}{
					"type":   m["type"],
					"status": m["status"],
					"reason": m["reason"],
				})
			}
		}
		meta["conditions"] = conds
		}
	}
	return meta
}

func getStr(m map[string]interface{}, keys ...string) string {
	for i, k := range keys {
		if i == len(keys)-1 {
			if v, ok := m[k].(string); ok {
				return v
			}
			return ""
		}
		if next, ok := m[k].(map[string]interface{}); ok {
			m = next
		} else {
			return ""
		}
	}
	return ""
}

// extractContainerStatuses returns per-container status: name, image, imageID, restartCount, last_termination_reason, ready, started.
func (s *mcpServerImpl) extractContainerStatuses(status, spec map[string]interface{}, init bool) []map[string]interface{} {
	var statuses []interface{}
	var specs []interface{}
	if status != nil {
		if init {
			statuses, _ = status["initContainerStatuses"].([]interface{})
		} else {
			statuses, _ = status["containerStatuses"].([]interface{})
		}
	}
	if spec != nil {
		if init {
			specs, _ = spec["initContainers"].([]interface{})
		} else {
			specs, _ = spec["containers"].([]interface{})
		}
	}
	specMap := make(map[string]map[string]interface{})
	for _, sp := range specs {
		if m, ok := sp.(map[string]interface{}); ok {
			if n, ok := m["name"].(string); ok {
				specMap[n] = m
			}
		}
	}
	out := make([]map[string]interface{}, 0, len(statuses))
	for _, cs := range statuses {
		m, ok := cs.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := m["name"].(string)
		rec := map[string]interface{}{
			"name":          name,
			"image":         m["image"],
			"image_id":      m["imageID"],
			"restart_count": intVal(m["restartCount"]),
			"ready":         m["ready"],
			"started":       m["started"],
		}
		if sp, ok := specMap[name]; ok {
			rec["image_pull_policy"] = sp["imagePullPolicy"]
			if res, ok := sp["resources"].(map[string]interface{}); ok {
				rec["resources"] = res
			}
		}
		if lastState, ok := m["lastState"].(map[string]interface{}); ok {
			if term, ok := lastState["terminated"].(map[string]interface{}); ok {
				rec["last_termination_reason"] = term["reason"]
				rec["last_termination_exit_code"] = term["exitCode"]
			}
		}
		out = append(out, rec)
	}
	return out
}

func intVal(v interface{}) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	}
	return 0
}

// extractPodSecurityContext returns pod-level and per-container security context summary (PRD Layer 1).
func (s *mcpServerImpl) extractPodSecurityContext(spec map[string]interface{}) map[string]interface{} {
	containerList := []map[string]interface{}{}
	out := map[string]interface{}{"pod": nil, "containers": containerList}
	if spec == nil {
		return out
	}
	if sc, ok := spec["securityContext"].(map[string]interface{}); ok {
		out["pod"] = map[string]interface{}{
			"run_as_user":     sc["runAsUser"],
			"run_as_group":    sc["runAsGroup"],
			"run_as_non_root": sc["runAsNonRoot"],
			"seccomp_profile": sc["seccompProfile"],
		}
	}
	if containers, ok := spec["containers"].([]interface{}); ok {
		for _, c := range containers {
			m, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := m["name"].(string)
			sc, _ := m["securityContext"].(map[string]interface{})
			entry := map[string]interface{}{"name": name}
			if sc != nil {
				entry["run_as_user"] = sc["runAsUser"]
				entry["run_as_non_root"] = sc["runAsNonRoot"]
				entry["read_only_root_filesystem"] = sc["readOnlyRootFilesystem"]
				entry["allow_privilege_escalation"] = sc["allowPrivilegeEscalation"]
				entry["capabilities"] = sc["capabilities"]
			}
			containerList = append(containerList, entry)
		}
		out["containers"] = containerList
	}
	return out
}

func (s *mcpServerImpl) extractVolumes(spec map[string]interface{}) []string {
	if spec == nil {
		return nil
	}
	vols, _ := spec["volumes"].([]interface{})
	names := make([]string, 0, len(vols))
	for _, v := range vols {
		if m, ok := v.(map[string]interface{}); ok {
			if n, ok := m["name"].(string); ok {
				names = append(names, n)
			}
		}
	}
	return names
}

// normalizePodMetrics returns cpu_millicores, memory_mb, metrics_available, and humanized display strings.
func (s *mcpServerImpl) normalizePodMetrics(metrics map[string]interface{}) map[string]interface{} {
	if metrics == nil {
		return map[string]interface{}{"metrics_available": false}
	}
	out := map[string]interface{}{
		"metrics_available": true,
		"cpu_millicores":    nil,
		"memory_mb":         nil,
		"memory_display":    nil,
	}
	// Backend may return usage in different shapes; try common ones
	if u, ok := metrics["usage"].(map[string]interface{}); ok {
		if c, ok := u["cpu"].(string); ok {
			out["cpu_millicores"] = c
		}
		if m, ok := u["memory"].(string); ok {
			out["memory_display"] = m
			out["memory_mb"] = m
		}
	}
	if v, ok := metrics["cpu"].(float64); ok {
		out["cpu_millicores"] = int(v * 1000)
	}
	if v, ok := metrics["memory"].(float64); ok {
		out["memory_mb"] = int(v)
		out["memory_display"] = fmt.Sprintf("%dMi", int(v))
	}
	return out
}

// ─── observe_events ───────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	limit := intArg(args, "limit", 50)

	q := url.Values{}
	q.Set("limit", fmt.Sprint(limit))
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	var events map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err != nil {
		return nil, err
	}
	return events, nil
}

// ─── observe_pod_ownership_chain ───────────────────────────────────────────────
// Returns Pod → ReplicaSet → Deployment (and optionally Job) chain. Standalone tool for AI flow "Call observe_pod_ownership_chain".

func (s *mcpServerImpl) handlePodOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pod_ownership_chain: 'namespace' and 'name' are required")
	}
	var pod map[string]interface{}
	podPath := c.clusterPath(clusterID, "/resources/pods/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, podPath, &pod); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Pod %q not found in namespace %q", name, namespace)
		}
		return nil, fmt.Errorf("failed to fetch pod: %w", err)
	}
	chain := s.getOwnerChain(ctx, clusterID, pod)
	return map[string]interface{}{
		"pod":             name,
		"namespace":       namespace,
		"ownership_chain": chain,
		"timestamp":       time.Now(),
	}, nil
}

// ─── observe_pod_events ───────────────────────────────────────────────────────
// Returns last N events for a specific pod (PRD: "last 10 related"). Used for
// "why is this pod restarting?" and crash analysis.

func (s *mcpServerImpl) handlePodEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pod_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Pod", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("pod events: %w", err)
	}
	return map[string]interface{}{
		"pod":       name,
		"namespace": namespace,
		"limit":     limit,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_resource_topology ────────────────────────────────────────────────

func (s *mcpServerImpl) handleResourceTopology(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	depth := intArg(args, "depth", 2) // Default depth 2 (was 3) to reduce data size

	// Try named resource topology first, fall back to cluster-wide.
	kind := strArg(args, "kind")
	name := strArg(args, "name")

	var path string
	if kind != "" && name != "" && namespace != "" {
		// Named resource topology is always fast (single resource)
		path = c.clusterPath(clusterID, fmt.Sprintf("/topology/resource/%s/%s/%s",
			url.PathEscape(kind), url.PathEscape(namespace), url.PathEscape(name)))
	} else {
		q := url.Values{}
		// Cap maxNodes to 50 for cluster-wide to keep response fast.
		// For namespace-scoped queries we can afford slightly more.
		maxNodes := 50
		if namespace != "" {
			maxNodes = depth * 30 // namespace-scoped is much smaller
		}
		q.Set("maxNodes", fmt.Sprint(maxNodes))
		if namespace != "" {
			q.Set("namespace", namespace)
		}
		path = c.clusterPath(clusterID, "/topology?"+q.Encode())
	}

	// Topology can be slow on large clusters — use a dedicated 60-second client
	// to avoid hitting the shared 30-second timeout.
	topoClient := &http.Client{
		Timeout: 60 * time.Second,
		Transport: sharedHTTPClient.Transport,
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("topology request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := topoClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET topology: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET topology: HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var topology map[string]interface{}
	if err := json.Unmarshal(body, &topology); err != nil {
		return nil, fmt.Errorf("topology decode: %w", err)
	}

	// Return a lightweight summary if the topology is very large
	if nodes, ok := topology["nodes"].([]interface{}); ok && len(nodes) > 100 {
		topology["_truncated"] = true
		topology["_note"] = fmt.Sprintf("Cluster topology has %d nodes. Provide namespace= or kind+name+namespace= for a focused view.", len(nodes))
	}

	return topology, nil
}

// ─── observe_metrics ──────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleMetrics(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	// Accept both kind/resource_type and name/resource_name for LLM robustness.
	namespace := strArg(args, "namespace")
	kind := strArg(args, "kind")
	if kind == "" {
		kind = strArg(args, "resource_type")
	}
	name := strArg(args, "name")
	if name == "" {
		name = strArg(args, "resource_name")
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	name = strings.TrimSpace(name)

	// Namespaced resource types require namespace (backend /metrics/summary and path-based endpoints).
	namespacedKinds := map[string]bool{
		"pod": true, "deployment": true, "replicaset": true, "statefulset": true,
		"daemonset": true, "job": true, "cronjob": true,
	}
	if kind != "" && kind != "node" && namespacedKinds[kind] && namespace == "" {
		return nil, fmt.Errorf("observe_metrics: namespace is required for %s metrics; provide namespace (and name) for the resource", kind)
	}
	if kind != "" && kind != "node" && name == "" {
		return nil, fmt.Errorf("observe_metrics: name (or resource_name) is required for %s metrics", kind)
	}
	if kind == "" || name == "" {
		return nil, fmt.Errorf("observe_metrics: kind (or resource_type) and name (or resource_name) are required; for pod, deployment, etc. namespace is also required")
	}

	// Route to the most specific metrics endpoint available.
	var path string
	switch kind {
	case "node":
		path = c.clusterPath(clusterID, "/metrics/nodes/"+url.PathEscape(name))
	case "deployment":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/deployment/"+url.PathEscape(name))
	case "pod":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	case "statefulset":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/statefulset/"+url.PathEscape(name))
	case "daemonset":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/daemonset/"+url.PathEscape(name))
	case "replicaset":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/replicaset/"+url.PathEscape(name))
	case "job":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/job/"+url.PathEscape(name))
	case "cronjob":
		path = c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/cronjob/"+url.PathEscape(name))
	default:
		// Use unified summary API with required query params (backend requires resource_type, resource_name, namespace for namespaced).
		q := url.Values{}
		q.Set("resource_type", kind)
		q.Set("resource_name", name)
		if kind != "node" {
			q.Set("namespace", namespace)
		}
		path = c.clusterPath(clusterID, "/metrics/summary?"+q.Encode())
	}

	var metrics map[string]interface{}
	if err := c.get(ctx, path, &metrics); err != nil {
		return nil, err
	}
	return metrics, nil
}

// ─── observe_node_detailed ─────────────────────────────────────────────────────

func (s *mcpServerImpl) handleNodeDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_node_detailed: 'name' is required")
	}
	ns := "-"
	var node map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes/"+ns+"/"+url.PathEscape(name)), &node); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Node %q not found", name)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Node", name, ns, 10)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/nodes/"+url.PathEscape(name)), &metrics)
	spec, _ := node["spec"].(map[string]interface{})
	status, _ := node["status"].(map[string]interface{})
	metadata, _ := node["metadata"].(map[string]interface{})
	data := extractNodeData(spec, status)
	podsOnNode := listPodsOnNode(ctx, c, clusterID, name)
	relationships := map[string]interface{}{"pods_on_node": podsOnNode}
	riskFlags, recommendations := analyzeNodeRiskFindings(status)
	out := map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}
	if metrics != nil {
		out["metrics"] = metrics
	}
	return out, nil
}

func extractNodeData(spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if taints, ok := spec["taints"].([]interface{}); ok {
			out["taints"] = taints
		}
	}
	if status != nil {
		if cap, ok := status["capacity"].(map[string]interface{}); ok && cap != nil {
			out["capacity"] = cap
		}
		if alloc, ok := status["allocatable"].(map[string]interface{}); ok && alloc != nil {
			out["allocatable"] = alloc
		}
		if addr, ok := status["addresses"].([]interface{}); ok {
			out["addresses"] = addr
		}
		conditions := getNodeConditions(status)
		out["conditions"] = conditions
	}
	return out
}

func getNodeConditions(status map[string]interface{}) map[string]string {
	out := map[string]string{}
	if status == nil {
		return out
	}
	condList, _ := status["conditions"].([]interface{})
	for _, c := range condList {
		m, _ := c.(map[string]interface{})
		if m == nil {
			continue
		}
		t, _ := m["type"].(string)
		s, _ := m["status"].(string)
		if t != "" {
			out[t] = s
		}
	}
	return out
}

func listPodsOnNode(ctx context.Context, c *backendHTTP, clusterID, nodeName string) []map[string]interface{} {
	q := url.Values{}
	q.Set("fieldSelector", "spec.nodeName="+nodeName)
	path := c.clusterPath(clusterID, "/resources/pods") + "?" + q.Encode()
	var podList map[string]interface{}
	if err := c.get(ctx, path, &podList); err != nil {
		return nil
	}
	items, _ := podList["items"].([]interface{})
	result := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if pod, ok := item.(map[string]interface{}); ok {
			meta, _ := pod["metadata"].(map[string]interface{})
			result = append(result, map[string]interface{}{
				"name":      meta["name"],
				"namespace": meta["namespace"],
			})
		}
	}
	return result
}

func analyzeNodeRiskFindings(status map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	conditions := getNodeConditions(status)
	if ready, ok := conditions["Ready"]; ok && ready != "True" {
		flags = append(flags, "NODE_NOT_READY")
		recs = append(recs, "Node Ready condition is not True — check node status and kubelet.")
	}
	if v, ok := conditions["DiskPressure"]; ok && v == "True" {
		flags = append(flags, "DISK_PRESSURE")
		recs = append(recs, "Node has disk pressure — free disk space or expand volume.")
	}
	if v, ok := conditions["MemoryPressure"]; ok && v == "True" {
		flags = append(flags, "MEMORY_PRESSURE")
		recs = append(recs, "Node has memory pressure — reduce workload or add memory.")
	}
	if v, ok := conditions["PIDPressure"]; ok && v == "True" {
		flags = append(flags, "PID_PRESSURE")
		recs = append(recs, "Node has PID pressure — check process count.")
	}
	if len(flags) == 0 {
		recs = append(recs, "Node conditions are healthy.")
	}
	return flags, recs
}

// ─── observe_node_events ──────────────────────────────────────────────────────

func (s *mcpServerImpl) handleNodeEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_node_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Node", name, "-", limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_node_status ──────────────────────────────────────────────────────

func (s *mcpServerImpl) handleNodeStatus(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	name := strArg(args, "name")
	if name != "" {
		var node map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes/-/"+url.PathEscape(name)), &node); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("Node %q not found", name)
			}
			return nil, err
		}
		return node, nil
	}

	// List all nodes with metrics.
	var nodes map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/nodes"), &nodes); err != nil {
		return nil, err
	}
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics"), &metrics)

	return map[string]interface{}{
		"nodes":   nodes,
		"metrics": metrics,
	}, nil
}

// ─── observe_namespace_overview ───────────────────────────────────────────────

func (s *mcpServerImpl) handleNamespaceOverview(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	// Namespace counts endpoint.
	var counts map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces/counts"), &counts)

	// List namespaces.
	var namespaces map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces"), &namespaces); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"namespaces": namespaces,
		"counts":     counts,
	}, nil
}

// ─── observe_namespace_detailed ───────────────────────────────────────────────

func (s *mcpServerImpl) handleNamespaceDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_namespace_detailed: 'name' is required")
	}
	ns := "-"
	var nsResource map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/namespaces/"+ns+"/"+url.PathEscape(name)), &nsResource); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Namespace %q not found", name)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Namespace", name, ns, 10)
	metadata, _ := nsResource["metadata"].(map[string]interface{})
	status, _ := nsResource["status"].(map[string]interface{})
	data := extractNamespaceData(metadata, status)
	podCount := countPodsInNamespace(ctx, c, clusterID, name)
	relationships := map[string]interface{}{"pod_count": podCount}
	riskFlags, recommendations := analyzeNamespaceRiskFindings(status)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractNamespaceData(metadata, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if metadata != nil {
		if labels, ok := metadata["labels"].(map[string]interface{}); ok && labels != nil {
			out["labels"] = labels
		}
		if ann, ok := metadata["annotations"].(map[string]interface{}); ok && ann != nil {
			out["annotations"] = ann
		}
	}
	if status != nil {
		if phase, ok := status["phase"].(string); ok {
			out["phase"] = phase
		}
	}
	return out
}

func countPodsInNamespace(ctx context.Context, c *backendHTTP, clusterID, namespace string) int {
	q := url.Values{}
	q.Set("namespace", namespace)
	path := c.clusterPath(clusterID, "/resources/pods") + "?" + q.Encode()
	var podList map[string]interface{}
	if err := c.get(ctx, path, &podList); err != nil {
		return 0
	}
	items, _ := podList["items"].([]interface{})
	return len(items)
}

func analyzeNamespaceRiskFindings(status map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if status != nil {
		if phase, ok := status["phase"].(string); ok && phase == "Terminating" {
			flags = append(flags, "NAMESPACE_TERMINATING")
			recs = append(recs, "Namespace is terminating — wait for finalization or check finalizers.")
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "Namespace status is normal.")
	}
	return flags, recs
}

// ─── observe_namespace_events ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleNamespaceEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_namespace_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Namespace", name, "-", limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_workload_health ──────────────────────────────────────────────────

func (s *mcpServerImpl) handleWorkloadHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")

	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	qs := ""
	if len(q) > 0 {
		qs = "?" + q.Encode()
	}

	// Collect health data from multiple workload types.
	results := map[string]interface{}{}
	for _, kind := range []string{"deployments", "statefulsets", "daemonsets", "replicasets"} {
		var data map[string]interface{}
		path := c.clusterPath(clusterID, "/resources/"+kind+qs)
		if err := c.get(ctx, path, &data); err == nil {
			results[kind] = data
		}
	}

	// Also grab pod restarts from metrics summary.
	var summary map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/summary"), &summary)
	if summary != nil {
		results["metrics_summary"] = summary
	}

	return results, nil
}

// ─── observe_deployment_rollout_history ──────────────────────────────────────

func (s *mcpServerImpl) handleDeploymentRolloutHistory(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_deployment_rollout_history: 'namespace' and 'name' are required")
	}
	path := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history")
	var history interface{}
	if err := c.get(ctx, path, &history); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Deployment %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	return map[string]interface{}{
		"deployment": name,
		"namespace":  namespace,
		"history":    history,
		"timestamp":  time.Now(),
	}, nil
}

// ─── observe_deployment_events ────────────────────────────────────────────────

func (s *mcpServerImpl) handleDeploymentEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_deployment_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Deployment", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("deployment events: %w", err)
	}
	return map[string]interface{}{
		"deployment": name,
		"namespace":  namespace,
		"limit":      limit,
		"events":     events,
		"timestamp":  time.Now(),
	}, nil
}

// ─── observe_deployment_ownership_chain ──────────────────────────────────────

func (s *mcpServerImpl) handleDeploymentOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_deployment_ownership_chain: 'namespace' and 'name' are required")
	}
	var deploy map[string]interface{}
	deployPath := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, deployPath, &deploy); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Deployment %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	meta, _ := deploy["metadata"].(map[string]interface{})
	uid, _ := meta["uid"].(string)
	var rsList map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+nsQuery(namespace)), &rsList); err != nil {
		return map[string]interface{}{
			"deployment":      name,
			"namespace":       namespace,
			"ownership_chain": []map[string]interface{}{{"kind": "Deployment", "name": name}},
			"replicasets":     []interface{}{},
			"timestamp":       time.Now(),
		}, nil
	}
	items, _ := rsList["items"].([]interface{})
	var replicasets []map[string]interface{}
	for _, it := range items {
		rs, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		rsMeta, _ := rs["metadata"].(map[string]interface{})
		owners, _ := rsMeta["ownerReferences"].([]interface{})
		for _, o := range owners {
			owner, _ := o.(map[string]interface{})
			if owner["uid"] == uid || owner["name"] == name {
				rsStatus, _ := rs["status"].(map[string]interface{})
				replicas := 0
				if r, ok := rsStatus["replicas"].(float64); ok {
					replicas = int(r)
				}
				rsName, _ := rsMeta["name"].(string)
				replicasets = append(replicasets, map[string]interface{}{
					"kind":     "ReplicaSet",
					"name":     rsName,
					"replicas": replicas,
				})
				break
			}
		}
	}
	return map[string]interface{}{
		"deployment":      name,
		"namespace":       namespace,
		"ownership_chain": []map[string]interface{}{{"kind": "Deployment", "name": name}},
		"replicasets":     replicasets,
		"timestamp":       time.Now(),
	}, nil
}

// ─── observe_deployment_detailed ─────────────────────────────────────────────

func (s *mcpServerImpl) handleDeploymentDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_deployment_detailed: 'namespace' and 'name' are required")
	}
	var deploy map[string]interface{}
	deployPath := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, deployPath, &deploy); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Deployment %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}

	var rolloutHistory interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history"), &rolloutHistory)

	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Deployment", name, namespace, 10)

	var metrics map[string]interface{}
	metricsPath := c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/deployment/"+url.PathEscape(name))
	_ = c.get(ctx, metricsPath, &metrics)

	meta, _ := deploy["metadata"].(map[string]interface{})
	uid, _ := meta["uid"].(string)
	var replicasets []map[string]interface{}
	var rsList map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets"+nsQuery(namespace)), &rsList); err == nil {
		if items, ok := rsList["items"].([]interface{}); ok {
			for _, it := range items {
				rs, ok := it.(map[string]interface{})
				if !ok {
					continue
				}
				rsMeta, _ := rs["metadata"].(map[string]interface{})
				owners, _ := rsMeta["ownerReferences"].([]interface{})
				for _, o := range owners {
					owner, _ := o.(map[string]interface{})
					if owner["uid"] == uid || owner["name"] == name {
						rsStatus, _ := rs["status"].(map[string]interface{})
						replicas := 0
						if r, ok := rsStatus["replicas"].(float64); ok {
							replicas = int(r)
						}
						rsName, _ := rsMeta["name"].(string)
						replicasets = append(replicasets, map[string]interface{}{
							"kind":     "ReplicaSet",
							"name":     rsName,
							"replicas": replicas,
						})
						break
					}
				}
			}
		}
	}

	spec, _ := deploy["spec"].(map[string]interface{})
	status, _ := deploy["status"].(map[string]interface{})
	data := s.extractDeploymentData(deploy, spec, status)

	health := s.analyzeSingleDeploymentHealth(ctx, clusterID, deploy)
	riskFlags := health["issues"]
	recommendations := []string{}
	if issues, ok := riskFlags.([]map[string]interface{}); ok {
		for _, i := range issues {
			if rec, ok := i["recommendation"].(string); ok && rec != "" {
				recommendations = append(recommendations, rec)
			}
		}
	}

	return map[string]interface{}{
		"deployment":      name,
		"metadata":        s.extractWorkloadMetadata(deploy, "Deployment"),
		"data":            data,
		"rollout_history": rolloutHistory,
		"metrics":         metrics,
		"events":          events,
		"relationships":  map[string]interface{}{"replicasets": replicasets, "ownership_chain": []map[string]interface{}{{"kind": "Deployment", "name": name}}},
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

// extractDeploymentData returns spec/status summary for deployment detailed view (nil-safe).
func (s *mcpServerImpl) extractDeploymentData(deploy, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if r, ok := spec["replicas"].(float64); ok {
			out["replicas"] = int(r)
		}
		if strategy, ok := spec["strategy"].(map[string]interface{}); ok {
			out["strategy"] = strategy
		}
	}
	if status != nil {
		out["replicas_status"] = map[string]interface{}{
			"replicas":            intValFromMap(status, "replicas"),
			"readyReplicas":       intValFromMap(status, "readyReplicas"),
			"updatedReplicas":     intValFromMap(status, "updatedReplicas"),
			"availableReplicas":   intValFromMap(status, "availableReplicas"),
			"unavailableReplicas": intValFromMap(status, "unavailableReplicas"),
		}
		if conds, ok := status["conditions"].([]interface{}); ok {
			out["conditions"] = conds
		}
	}
	return out
}

// extractWorkloadMetadata returns name, namespace, labels, annotations for any workload (nil-safe).
func (s *mcpServerImpl) extractWorkloadMetadata(obj map[string]interface{}, kind string) map[string]interface{} {
	out := map[string]interface{}{"kind": kind}
	if obj == nil {
		return out
	}
	meta, ok := obj["metadata"].(map[string]interface{})
	if !ok {
		return out
	}
	if n, ok := meta["name"].(string); ok {
		out["name"] = n
	}
	if ns, ok := meta["namespace"].(string); ok {
		out["namespace"] = ns
	}
	if labels, ok := meta["labels"].(map[string]interface{}); ok {
		out["labels"] = labels
	}
	if ann, ok := meta["annotations"].(map[string]interface{}); ok {
		out["annotations"] = ann
	}
	return out
}

// intValFromMap returns m[key] as int (for float64 or int). Used by workload extractors.
func intValFromMap(m map[string]interface{}, key string) int {
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

// ─── observe_replicaset_detailed ────────────────────────────────────────────

func (s *mcpServerImpl) handleReplicaSetDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_replicaset_detailed: 'namespace' and 'name' are required")
	}
	var rs map[string]interface{}
	rsPath := c.clusterPath(clusterID, "/resources/replicasets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, rsPath, &rs); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ReplicaSet %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}

	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "ReplicaSet", name, namespace, 10)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/replicaset/"+url.PathEscape(name)), &metrics)

	// Relationships: owner (Deployment), child Pods (list pods with selector)
	meta, _ := rs["metadata"].(map[string]interface{})
	owners, _ := meta["ownerReferences"].([]interface{})
	var ownershipChain []map[string]interface{}
	for _, o := range owners {
		owner, _ := o.(map[string]interface{})
		ownershipChain = append(ownershipChain, map[string]interface{}{
			"kind": owner["kind"],
			"name": owner["name"],
		})
	}
	spec, _ := rs["spec"].(map[string]interface{})
	selector := spec["selector"]
	var podsSummary []map[string]interface{}
	if sel, ok := selector.(map[string]interface{}); ok {
		if matchLabels, ok := sel["matchLabels"].(map[string]interface{}); ok {
			var parts []string
			for k, v := range matchLabels {
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
						for _, it := range items {
							pod, _ := it.(map[string]interface{})
							pMeta, _ := pod["metadata"].(map[string]interface{})
							pName, _ := pMeta["name"].(string)
							pStatus, _ := pod["status"].(map[string]interface{})
							phase, _ := pStatus["phase"].(string)
							podsSummary = append(podsSummary, map[string]interface{}{"name": pName, "phase": phase})
						}
					}
				}
			}
		}
	}
	if len(ownershipChain) == 0 {
		ownershipChain = []map[string]interface{}{{"kind": "ReplicaSet", "name": name}}
	}

	status, _ := rs["status"].(map[string]interface{})
	data := s.extractReplicaSetData(rs, spec, status)
	riskFlags, recommendations := s.analyzeReplicaSetHealthFindings(rs)

	return map[string]interface{}{
		"replicaset":     name,
		"metadata":       s.extractWorkloadMetadata(rs, "ReplicaSet"),
		"data":           data,
		"metrics":        metrics,
		"events":         events,
		"relationships": map[string]interface{}{"ownership_chain": ownershipChain, "pods": podsSummary},
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":      time.Now(),
	}, nil
}

func (s *mcpServerImpl) extractReplicaSetData(rs, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if r, ok := spec["replicas"].(float64); ok {
			out["replicas"] = int(r)
		}
	}
	if status != nil {
		out["replicas_status"] = map[string]interface{}{
			"replicas":             intValFromMap(status, "replicas"),
			"readyReplicas":       intValFromMap(status, "readyReplicas"),
			"availableReplicas":   intValFromMap(status, "availableReplicas"),
			"fullyLabeledReplicas": intValFromMap(status, "fullyLabeledReplicas"),
		}
	}
	return out
}

func (s *mcpServerImpl) analyzeReplicaSetHealthFindings(rs map[string]interface{}) ([]map[string]interface{}, []string) {
	var findings []map[string]interface{}
	var recs []string
	spec, _ := rs["spec"].(map[string]interface{})
	status, _ := rs["status"].(map[string]interface{})
	if spec == nil || status == nil {
		return findings, recs
	}
	desired := intValFromMap(spec, "replicas")
	available := intValFromMap(status, "availableReplicas")
	if desired > 0 && available < desired {
		findings = append(findings, map[string]interface{}{
			"type":           "UNAVAILABLE_REPLICAS",
			"severity":       "HIGH",
			"message":        fmt.Sprintf("Desired: %d, Available: %d", desired, available),
			"recommendation": "Check pod events and logs for the ReplicaSet's pods.",
		})
		recs = append(recs, "Check pod events and logs for the ReplicaSet's pods.")
	}
	return findings, recs
}

// ─── observe_replicaset_events ──────────────────────────────────────────────

func (s *mcpServerImpl) handleReplicaSetEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_replicaset_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "ReplicaSet", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("replicaset events: %w", err)
	}
	return map[string]interface{}{
		"replicaset": name,
		"namespace":  namespace,
		"limit":      limit,
		"events":     events,
		"timestamp":  time.Now(),
	}, nil
}

// ─── observe_replicaset_ownership_chain ──────────────────────────────────────

func (s *mcpServerImpl) handleReplicaSetOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_replicaset_ownership_chain: 'namespace' and 'name' are required")
	}
	var rs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/replicasets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &rs); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ReplicaSet %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	chain := s.getOwnerChain(ctx, clusterID, rs)
	// Prepend this ReplicaSet
	chain = append([]map[string]interface{}{{"kind": "ReplicaSet", "name": name}}, chain...)
	// Child pods summary
	spec, _ := rs["spec"].(map[string]interface{})
	var pods []map[string]interface{}
	if sel, ok := spec["selector"].(map[string]interface{}); ok {
		if matchLabels, ok := sel["matchLabels"].(map[string]interface{}); ok {
			var parts []string
			for k, v := range matchLabels {
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
						for _, it := range items {
							pod, _ := it.(map[string]interface{})
							pMeta, _ := pod["metadata"].(map[string]interface{})
							pName, _ := pMeta["name"].(string)
							pods = append(pods, map[string]interface{}{"name": pName})
						}
					}
				}
			}
		}
	}
	return map[string]interface{}{
		"replicaset":      name,
		"namespace":       namespace,
		"ownership_chain": chain,
		"pods":            pods,
		"timestamp":       time.Now(),
	}, nil
}

// ─── observe_statefulset_detailed ───────────────────────────────────────────

func (s *mcpServerImpl) handleStatefulSetDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_statefulset_detailed: 'namespace' and 'name' are required")
	}
	var sts map[string]interface{}
	stsPath := c.clusterPath(clusterID, "/resources/statefulsets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, stsPath, &sts); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("StatefulSet %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "StatefulSet", name, namespace, 10)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/statefulset/"+url.PathEscape(name)), &metrics)
	spec, _ := sts["spec"].(map[string]interface{})
	status, _ := sts["status"].(map[string]interface{})
	var podsSummary []map[string]interface{}
	if spec != nil {
		if sel, ok := spec["selector"].(map[string]interface{}); ok {
			if matchLabels, ok := sel["matchLabels"].(map[string]interface{}); ok {
				var parts []string
				for k, v := range matchLabels {
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
							for _, it := range items {
								pod, _ := it.(map[string]interface{})
								pMeta, _ := pod["metadata"].(map[string]interface{})
								pName, _ := pMeta["name"].(string)
								pStatus, _ := pod["status"].(map[string]interface{})
								phase, _ := pStatus["phase"].(string)
								podsSummary = append(podsSummary, map[string]interface{}{"name": pName, "phase": phase})
							}
						}
					}
				}
			}
		}
	}
	data := s.extractStatefulSetData(sts, spec, status)
	riskFlags, recommendations := s.analyzeStatefulSetHealthFindings(sts)
	return map[string]interface{}{
		"statefulset":     name,
		"metadata":       s.extractWorkloadMetadata(sts, "StatefulSet"),
		"data":           data,
		"metrics":        metrics,
		"events":         events,
		"relationships":  map[string]interface{}{"ownership_chain": []map[string]interface{}{{"kind": "StatefulSet", "name": name}}, "pods": podsSummary},
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":      time.Now(),
	}, nil
}

func (s *mcpServerImpl) extractStatefulSetData(sts, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if r, ok := spec["replicas"].(float64); ok {
			out["replicas"] = int(r)
		}
		if svc, ok := spec["serviceName"].(string); ok {
			out["serviceName"] = svc
		}
		if strategy, ok := spec["updateStrategy"].(map[string]interface{}); ok {
			out["updateStrategy"] = strategy
		}
	}
	if status != nil {
		out["replicas_status"] = map[string]interface{}{
			"currentReplicas":  intValFromMap(status, "currentReplicas"),
			"readyReplicas":   intValFromMap(status, "readyReplicas"),
			"updatedReplicas": intValFromMap(status, "updatedReplicas"),
		}
		if rev, ok := status["currentRevision"].(string); ok {
			out["currentRevision"] = rev
		}
		if rev, ok := status["updateRevision"].(string); ok {
			out["updateRevision"] = rev
		}
	}
	return out
}

func (s *mcpServerImpl) analyzeStatefulSetHealthFindings(sts map[string]interface{}) ([]map[string]interface{}, []string) {
	var findings []map[string]interface{}
	var recs []string
	spec, _ := sts["spec"].(map[string]interface{})
	status, _ := sts["status"].(map[string]interface{})
	if spec == nil || status == nil {
		return findings, recs
	}
	desired := intValFromMap(spec, "replicas")
	ready := intValFromMap(status, "readyReplicas")
	if desired > 0 && ready < desired {
		findings = append(findings, map[string]interface{}{
			"type":           "UNAVAILABLE_REPLICAS",
			"severity":       "HIGH",
			"message":        fmt.Sprintf("Desired: %d, Ready: %d", desired, ready),
			"recommendation": "StatefulSet pods must be ready in ordinal order. Check the first non-ready pod's logs and PVC status.",
		})
		recs = append(recs, "StatefulSet pods must be ready in ordinal order. Check the first non-ready pod's logs and PVC status.")
	}
	return findings, recs
}

// ─── observe_statefulset_events ─────────────────────────────────────────────

func (s *mcpServerImpl) handleStatefulSetEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_statefulset_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "StatefulSet", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("statefulset events: %w", err)
	}
	return map[string]interface{}{
		"statefulset": name,
		"namespace":   namespace,
		"limit":       limit,
		"events":      events,
		"timestamp":   time.Now(),
	}, nil
}

// ─── observe_statefulset_ownership_chain ────────────────────────────────────

func (s *mcpServerImpl) handleStatefulSetOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_statefulset_ownership_chain: 'namespace' and 'name' are required")
	}
	var sts map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/statefulsets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &sts); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("StatefulSet %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	spec, _ := sts["spec"].(map[string]interface{})
	var pods []map[string]interface{}
	if spec != nil {
		if sel, ok := spec["selector"].(map[string]interface{}); ok {
			if matchLabels, ok := sel["matchLabels"].(map[string]interface{}); ok {
				var parts []string
				for k, v := range matchLabels {
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
							for _, it := range items {
								pod, _ := it.(map[string]interface{})
								pMeta, _ := pod["metadata"].(map[string]interface{})
								pName, _ := pMeta["name"].(string)
								pods = append(pods, map[string]interface{}{"name": pName})
							}
						}
					}
				}
			}
		}
	}
	return map[string]interface{}{
		"statefulset":     name,
		"namespace":       namespace,
		"ownership_chain": []map[string]interface{}{{"kind": "StatefulSet", "name": name}},
		"pods":            pods,
		"timestamp":       time.Now(),
	}, nil
}

// ─── observe_daemonset_detailed ──────────────────────────────────────────────

func (s *mcpServerImpl) handleDaemonSetDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_daemonset_detailed: 'namespace' and 'name' are required")
	}
	var ds map[string]interface{}
	dsPath := c.clusterPath(clusterID, "/resources/daemonsets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, dsPath, &ds); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("DaemonSet %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "DaemonSet", name, namespace, 10)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/daemonset/"+url.PathEscape(name)), &metrics)
	spec, _ := ds["spec"].(map[string]interface{})
	status, _ := ds["status"].(map[string]interface{})
	var podsSummary []map[string]interface{}
	if spec != nil {
		if sel, ok := spec["selector"].(map[string]interface{}); ok {
			if matchLabels, ok := sel["matchLabels"].(map[string]interface{}); ok {
				var parts []string
				for k, v := range matchLabels {
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
							for _, it := range items {
								pod, _ := it.(map[string]interface{})
								pMeta, _ := pod["metadata"].(map[string]interface{})
								pName, _ := pMeta["name"].(string)
								pStatus, _ := pod["status"].(map[string]interface{})
								phase, _ := pStatus["phase"].(string)
								podsSummary = append(podsSummary, map[string]interface{}{"name": pName, "phase": phase})
							}
						}
					}
				}
			}
		}
	}
	data := s.extractDaemonSetData(ds, spec, status)
	riskFlags, recommendations := s.analyzeDaemonSetHealthFindings(ds)
	return map[string]interface{}{
		"daemonset":       name,
		"metadata":       s.extractWorkloadMetadata(ds, "DaemonSet"),
		"data":           data,
		"metrics":        metrics,
		"events":         events,
		"relationships":  map[string]interface{}{"ownership_chain": []map[string]interface{}{{"kind": "DaemonSet", "name": name}}, "pods": podsSummary},
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":      time.Now(),
	}, nil
}

func (s *mcpServerImpl) extractDaemonSetData(ds, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if strategy, ok := spec["updateStrategy"].(map[string]interface{}); ok {
			out["updateStrategy"] = strategy
		}
	}
	if status != nil {
		out["status"] = map[string]interface{}{
			"desiredNumberScheduled":  intValFromMap(status, "desiredNumberScheduled"),
			"currentNumberScheduled": intValFromMap(status, "currentNumberScheduled"),
			"numberReady":            intValFromMap(status, "numberReady"),
			"numberAvailable":        intValFromMap(status, "numberAvailable"),
			"numberMisscheduled":     intValFromMap(status, "numberMisscheduled"),
		}
	}
	return out
}

func (s *mcpServerImpl) analyzeDaemonSetHealthFindings(ds map[string]interface{}) ([]map[string]interface{}, []string) {
	var findings []map[string]interface{}
	var recs []string
	status, _ := ds["status"].(map[string]interface{})
	if status == nil {
		return findings, recs
	}
	desired := intValFromMap(status, "desiredNumberScheduled")
	ready := intValFromMap(status, "numberReady")
	misscheduled := intValFromMap(status, "numberMisscheduled")
	if desired > 0 && ready < desired {
		findings = append(findings, map[string]interface{}{
			"type":           "UNAVAILABLE_DAEMON_PODS",
			"severity":       "HIGH",
			"message":        fmt.Sprintf("Desired: %d, Ready: %d", desired, ready),
			"recommendation": "Check node taints, resource pressure, or pod events for DaemonSet pods.",
		})
		recs = append(recs, "Check node taints, resource pressure, or pod events for DaemonSet pods.")
	}
	if misscheduled > 0 {
		findings = append(findings, map[string]interface{}{
			"type":           "MISSCHEDULED_PODS",
			"severity":       "MEDIUM",
			"message":        fmt.Sprintf("%d pod(s) misscheduled", misscheduled),
			"recommendation": "Pods are running on nodes that do not match the DaemonSet's node selector or tolerate taints.",
		})
		recs = append(recs, "Pods are running on nodes that do not match the DaemonSet's node selector or tolerate taints.")
	}
	return findings, recs
}

// ─── observe_daemonset_events ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleDaemonSetEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_daemonset_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "DaemonSet", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("daemonset events: %w", err)
	}
	return map[string]interface{}{
		"daemonset": name,
		"namespace": namespace,
		"limit":     limit,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_daemonset_ownership_chain ──────────────────────────────────────

func (s *mcpServerImpl) handleDaemonSetOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_daemonset_ownership_chain: 'namespace' and 'name' are required")
	}
	var ds map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/daemonsets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &ds); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("DaemonSet %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	spec, _ := ds["spec"].(map[string]interface{})
	var pods []map[string]interface{}
	if spec != nil {
		if sel, ok := spec["selector"].(map[string]interface{}); ok {
			if matchLabels, ok := sel["matchLabels"].(map[string]interface{}); ok {
				var parts []string
				for k, v := range matchLabels {
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
							for _, it := range items {
								pod, _ := it.(map[string]interface{})
								pMeta, _ := pod["metadata"].(map[string]interface{})
								pName, _ := pMeta["name"].(string)
								pods = append(pods, map[string]interface{}{"name": pName})
							}
						}
					}
				}
			}
		}
	}
	return map[string]interface{}{
		"daemonset":       name,
		"namespace":      namespace,
		"ownership_chain": []map[string]interface{}{{"kind": "DaemonSet", "name": name}},
		"pods":            pods,
		"timestamp":       time.Now(),
	}, nil
}

// ─── observe_job_detailed ────────────────────────────────────────────────────

func (s *mcpServerImpl) handleJobDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_job_detailed: 'namespace' and 'name' are required")
	}
	var job map[string]interface{}
	jobPath := c.clusterPath(clusterID, "/resources/jobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, jobPath, &job); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Job %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Job", name, namespace, 10)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/job/"+url.PathEscape(name)), &metrics)
	// Child pods: Job-created pods have label job-name=<name>
	path := c.clusterPath(clusterID, "/resources/pods"+nsQuery(namespace)) + "&labelSelector=" + url.QueryEscape("job-name="+name)
	var podList map[string]interface{}
	var podsSummary []map[string]interface{}
	if err := c.get(ctx, path, &podList); err == nil {
		if items, ok := podList["items"].([]interface{}); ok {
			for _, it := range items {
				pod, _ := it.(map[string]interface{})
				pMeta, _ := pod["metadata"].(map[string]interface{})
				pName, _ := pMeta["name"].(string)
				pStatus, _ := pod["status"].(map[string]interface{})
				phase, _ := pStatus["phase"].(string)
				podsSummary = append(podsSummary, map[string]interface{}{"name": pName, "phase": phase})
			}
		}
	}
	meta, _ := job["metadata"].(map[string]interface{})
	owners, _ := meta["ownerReferences"].([]interface{})
	var ownershipChain []map[string]interface{}
	ownershipChain = append(ownershipChain, map[string]interface{}{"kind": "Job", "name": name})
	for _, o := range owners {
		owner, _ := o.(map[string]interface{})
		ownershipChain = append(ownershipChain, map[string]interface{}{"kind": owner["kind"], "name": owner["name"]})
	}
	spec, _ := job["spec"].(map[string]interface{})
	status, _ := job["status"].(map[string]interface{})
	data := s.extractJobData(job, spec, status)
	riskFlags, recommendations := s.analyzeJobHealthFindings(job)
	return map[string]interface{}{
		"job":             name,
		"metadata":       s.extractWorkloadMetadata(job, "Job"),
		"data":           data,
		"metrics":        metrics,
		"events":         events,
		"relationships": map[string]interface{}{"ownership_chain": ownershipChain, "pods": podsSummary},
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":      time.Now(),
	}, nil
}

func (s *mcpServerImpl) extractJobData(job, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		out["parallelism"] = intValFromMap(spec, "parallelism")
		out["completions"] = intValFromMap(spec, "completions")
		out["backoffLimit"] = intValFromMap(spec, "backoffLimit")
	}
	if status != nil {
		out["status"] = map[string]interface{}{
			"succeeded": intValFromMap(status, "succeeded"),
			"failed":    intValFromMap(status, "failed"),
			"active":    intValFromMap(status, "active"),
		}
		if t, ok := status["startTime"].(string); ok {
			out["startTime"] = t
		}
		if t, ok := status["completionTime"].(string); ok {
			out["completionTime"] = t
		}
	}
	return out
}

func (s *mcpServerImpl) analyzeJobHealthFindings(job map[string]interface{}) ([]map[string]interface{}, []string) {
	var findings []map[string]interface{}
	var recs []string
	status, _ := job["status"].(map[string]interface{})
	spec, _ := job["spec"].(map[string]interface{})
	if status == nil {
		return findings, recs
	}
	failed := intValFromMap(status, "failed")
	if failed > 0 {
		findings = append(findings, map[string]interface{}{
			"type":           "JOB_FAILED",
			"severity":       "HIGH",
			"message":        fmt.Sprintf("%d pod(s) failed", failed),
			"recommendation": "Check pod logs and events for failed Job pods. Consider increasing backoffLimit or fixing the workload image.",
		})
		recs = append(recs, "Check pod logs and events for failed Job pods.")
	}
	backoffLimit := 6
	if spec != nil {
		backoffLimit = intValFromMap(spec, "backoffLimit")
	}
	if backoffLimit > 0 && failed >= backoffLimit {
		findings = append(findings, map[string]interface{}{
			"type":           "JOB_BACKOFF_LIMIT_EXCEEDED",
			"severity":       "CRITICAL",
			"message":        "Job has reached backoff limit",
			"recommendation": "Job will not retry. Fix the underlying failure and create a new Job or use CronJob trigger.",
		})
		recs = append(recs, "Job will not retry. Fix the underlying failure and create a new Job or use CronJob trigger.")
	}
	return findings, recs
}

// ─── observe_job_events ─────────────────────────────────────────────────────

func (s *mcpServerImpl) handleJobEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_job_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Job", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("job events: %w", err)
	}
	return map[string]interface{}{
		"job":       name,
		"namespace": namespace,
		"limit":     limit,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_job_ownership_chain ────────────────────────────────────────────

func (s *mcpServerImpl) handleJobOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_job_ownership_chain: 'namespace' and 'name' are required")
	}
	var job map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/jobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &job); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Job %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	chain := s.getOwnerChain(ctx, clusterID, job)
	chain = append([]map[string]interface{}{{"kind": "Job", "name": name}}, chain...)
	path := c.clusterPath(clusterID, "/resources/pods"+nsQuery(namespace)) + "&labelSelector=" + url.QueryEscape("job-name="+name)
	var podList map[string]interface{}
	var pods []map[string]interface{}
	if err := c.get(ctx, path, &podList); err == nil {
		if items, ok := podList["items"].([]interface{}); ok {
			for _, it := range items {
				pod, _ := it.(map[string]interface{})
				pMeta, _ := pod["metadata"].(map[string]interface{})
				pName, _ := pMeta["name"].(string)
				pods = append(pods, map[string]interface{}{"name": pName})
			}
		}
	}
	return map[string]interface{}{
		"job":             name,
		"namespace":       namespace,
		"ownership_chain": chain,
		"pods":            pods,
		"timestamp":       time.Now(),
	}, nil
}

// ─── observe_cronjob_detailed ──────────────────────────────────────────────────

func (s *mcpServerImpl) handleCronJobDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_cronjob_detailed: 'namespace' and 'name' are required")
	}
	var cj map[string]interface{}
	cjPath := c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, cjPath, &cj); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("CronJob %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var childJobs interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/jobs"), &childJobs)
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "CronJob", name, namespace, 10)
	var metrics map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/metrics/"+url.PathEscape(namespace)+"/cronjob/"+url.PathEscape(name)), &metrics)
	spec, _ := cj["spec"].(map[string]interface{})
	status, _ := cj["status"].(map[string]interface{})
	data := s.extractCronJobData(cj, spec, status)
	riskFlags, recommendations := s.analyzeCronJobHealthFindings(cj, childJobs)
	return map[string]interface{}{
		"cronjob":        name,
		"metadata":       s.extractWorkloadMetadata(cj, "CronJob"),
		"data":           data,
		"child_jobs":     childJobs,
		"metrics":        metrics,
		"events":         events,
		"relationships": map[string]interface{}{"ownership_chain": []map[string]interface{}{{"kind": "CronJob", "name": name}}, "jobs": childJobs},
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":      time.Now(),
	}, nil
}

func (s *mcpServerImpl) extractCronJobData(cj, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if schedule, ok := spec["schedule"].(string); ok {
			out["schedule"] = schedule
		}
		if suspend, ok := spec["suspend"].(bool); ok {
			out["suspend"] = suspend
		}
		if policy, ok := spec["concurrencyPolicy"].(string); ok {
			out["concurrencyPolicy"] = policy
		}
	}
	if status != nil {
		if t, ok := status["lastSuccessfulTime"].(string); ok {
			out["lastSuccessfulTime"] = t
		}
		if t, ok := status["lastScheduleTime"].(string); ok {
			out["lastScheduleTime"] = t
		}
	}
	return out
}

func (s *mcpServerImpl) analyzeCronJobHealthFindings(cj map[string]interface{}, childJobs interface{}) ([]map[string]interface{}, []string) {
	var findings []map[string]interface{}
	var recs []string
	spec, _ := cj["spec"].(map[string]interface{})
	if spec != nil {
		if suspend, ok := spec["suspend"].(bool); ok && suspend {
			findings = append(findings, map[string]interface{}{
				"type":           "CRONJOB_SUSPENDED",
				"severity":       "LOW",
				"message":        "CronJob is suspended and will not create new Jobs",
				"recommendation": "Set spec.suspend to false to resume scheduling.",
			})
			recs = append(recs, "Set spec.suspend to false to resume scheduling.")
		}
	}
	// Count failed jobs from child list if available
	if list, ok := childJobs.(map[string]interface{}); ok {
		if items, ok := list["items"].([]interface{}); ok {
			for _, it := range items {
				job, _ := it.(map[string]interface{})
				jStatus, _ := job["status"].(map[string]interface{})
				if intValFromMap(jStatus, "failed") > 0 {
					findings = append(findings, map[string]interface{}{
						"type":           "FAILED_JOBS",
						"severity":       "MEDIUM",
						"message":        "One or more Jobs created by this CronJob have failed",
						"recommendation": "Inspect the failed Job(s) with observe_job_detailed or observe_job_events.",
					})
					recs = append(recs, "Inspect the failed Job(s) with observe_job_detailed or observe_job_events.")
					break
				}
			}
		}
	}
	return findings, recs
}

// ─── observe_cronjob_events ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleCronJobEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_cronjob_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "CronJob", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("cronjob events: %w", err)
	}
	return map[string]interface{}{
		"cronjob":   name,
		"namespace": namespace,
		"limit":     limit,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_cronjob_ownership_chain ──────────────────────────────────────────

func (s *mcpServerImpl) handleCronJobOwnershipChain(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_cronjob_ownership_chain: 'namespace' and 'name' are required")
	}
	var cj map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &cj); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("CronJob %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var childJobs interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/cronjobs/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/jobs"), &childJobs); err != nil {
		childJobs = []interface{}{}
	}
	return map[string]interface{}{
		"cronjob":        name,
		"namespace":      namespace,
		"ownership_chain": []map[string]interface{}{{"kind": "CronJob", "name": name}},
		"jobs":           childJobs,
		"timestamp":      time.Now(),
	}, nil
}

// ─── observe_service_detailed ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleServiceDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_service_detailed: 'namespace' and 'name' are required")
	}
	var svc map[string]interface{}
	svcPath := c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(name))
	if err := c.get(ctx, svcPath, &svc); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Service %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var endpoints map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/endpoints"), &endpoints)
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Service", name, namespace, 10)
	spec, _ := svc["spec"].(map[string]interface{})
	status, _ := svc["status"].(map[string]interface{})
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
				path := c.clusterPath(clusterID, "/resources/pods"+nsQuery(namespace)) + "&labelSelector=" + url.QueryEscape(labelSel)
				var podList map[string]interface{}
				if err := c.get(ctx, path, &podList); err == nil {
					if items, ok := podList["items"].([]interface{}); ok {
						for _, it := range items {
							pod, _ := it.(map[string]interface{})
							pMeta, _ := pod["metadata"].(map[string]interface{})
							pName, _ := pMeta["name"].(string)
							pStatus, _ := pod["status"].(map[string]interface{})
							phase, _ := pStatus["phase"].(string)
							podsSelected = append(podsSelected, map[string]interface{}{"name": pName, "phase": phase})
						}
					}
				}
			}
		}
	}
	data := s.extractServiceData(svc, spec, status, endpoints)
	riskFlags, recommendations := s.analyzeServiceHealthFindings(svc, endpoints, podsSelected)
	return map[string]interface{}{
		"service":        name,
		"metadata":       s.extractWorkloadMetadata(svc, "Service"),
		"data":           data,
		"events":         events,
		"relationships": map[string]interface{}{"endpoints": endpoints, "pods_selected": podsSelected},
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":      time.Now(),
	}, nil
}

func (s *mcpServerImpl) extractServiceData(svc, spec, status map[string]interface{}, endpoints map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if t, ok := spec["type"].(string); ok {
			out["type"] = t
		}
		if ports, ok := spec["ports"].([]interface{}); ok {
			out["ports"] = ports
		}
		out["selector"] = spec["selector"]
	}
	if status != nil {
		if lb, ok := status["loadBalancer"].(map[string]interface{}); ok {
			out["loadBalancer"] = lb
		}
	}
	out["endpoint_addresses_count"] = countEndpointAddresses(endpoints)
	return out
}

func countEndpointAddresses(ep map[string]interface{}) int {
	if ep == nil {
		return 0
	}
	subsets, _ := ep["subsets"].([]interface{})
	var n int
	for _, s := range subsets {
		sub, _ := s.(map[string]interface{})
		if addrs, ok := sub["addresses"].([]interface{}); ok {
			n += len(addrs)
		}
	}
	return n
}

func (s *mcpServerImpl) analyzeServiceHealthFindings(svc, endpoints map[string]interface{}, podsSelected []map[string]interface{}) ([]map[string]interface{}, []string) {
	var findings []map[string]interface{}
	var recs []string
	spec, _ := svc["spec"].(map[string]interface{})
	if spec != nil {
		if t, ok := spec["type"].(string); ok && (t == "LoadBalancer" || t == "NodePort") {
			findings = append(findings, map[string]interface{}{
				"type":           "EXPOSURE_RISK",
				"severity":       "LOW",
				"message":        fmt.Sprintf("Service type is %s; ensure external access is intended", t),
				"recommendation": "Review whether ClusterIP is sufficient; restrict NodePort/LoadBalancer exposure if not needed.",
			})
			recs = append(recs, "Review whether ClusterIP is sufficient; restrict NodePort/LoadBalancer exposure if not needed.")
		}
	}
	n := countEndpointAddresses(endpoints)
	if n == 0 {
		findings = append(findings, map[string]interface{}{
			"type":           "NO_ENDPOINTS",
			"severity":       "HIGH",
			"message":        "Service has no ready endpoints",
			"recommendation": "Check that selector matches running pods and pods are Ready.",
		})
		recs = append(recs, "Check that selector matches running pods and pods are Ready.")
	}
	if len(podsSelected) == 0 && spec != nil {
		if sel, ok := spec["selector"].(map[string]interface{}); ok && len(sel) > 0 {
			findings = append(findings, map[string]interface{}{
				"type":           "ORPHAN_SERVICE",
				"severity":       "MEDIUM",
				"message":        "No pods match the service selector",
				"recommendation": "Deploy workloads with matching labels or fix the selector.",
			})
			recs = append(recs, "Deploy workloads with matching labels or fix the selector.")
		}
	}
	return findings, recs
}

// ─── observe_service_events ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleServiceEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_service_events: 'namespace' and 'name' are required")
	}
	limit := intArg(args, "limit", 10)
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Service", name, namespace, limit)
	if err != nil {
		return nil, fmt.Errorf("service events: %w", err)
	}
	return map[string]interface{}{
		"service":   name,
		"namespace": namespace,
		"limit":     limit,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_service_endpoints ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleServiceEndpoints(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_service_endpoints: 'namespace' and 'name' are required")
	}
	var svc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &svc); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Service %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var endpoints map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/endpoints"), &endpoints); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Endpoints for Service %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	return map[string]interface{}{
		"service":        name,
		"namespace":      namespace,
		"endpoints":      endpoints,
		"address_count": countEndpointAddresses(endpoints),
		"timestamp":      time.Now(),
	}, nil
}

// ─── observe_ingress_detailed ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleIngressDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_ingress_detailed: 'namespace' and 'name' are required")
	}
	var ing map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/ingresses/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &ing); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Ingress %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Ingress", name, namespace, 10)
	spec, _ := ing["spec"].(map[string]interface{})
	status, _ := ing["status"].(map[string]interface{})
	metadata, _ := ing["metadata"].(map[string]interface{})
	data := extractIngressData(ing, spec, status)
	backendServices := extractIngressBackendServices(spec)
	for i := range backendServices {
		svcName := backendServices[i]["service_name"].(string)
		var svc map[string]interface{}
		err := c.get(ctx, c.clusterPath(clusterID, "/resources/services/"+url.PathEscape(namespace)+"/"+url.PathEscape(svcName)), &svc)
		backendServices[i]["exists"] = err == nil
	}
	riskFlags, recommendations := analyzeIngressHealthFindings(spec, backendServices)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   map[string]interface{}{"backend_services": backendServices},
		"risk_flags":       riskFlags,
		"recommendations":  recommendations,
		"timestamp":        time.Now(),
	}, nil
}

func extractIngressData(ing, spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if rules, ok := spec["rules"].([]interface{}); ok {
			out["rules_count"] = len(rules)
		}
		if tls, ok := spec["tls"].([]interface{}); ok {
			out["tls_count"] = len(tls)
		}
		if cn, ok := spec["ingressClassName"].(string); ok {
			out["ingressClassName"] = cn
		}
	}
	if status != nil {
		if lb, ok := status["loadBalancer"].(map[string]interface{}); ok && lb != nil {
			if ing, ok := lb["ingress"].([]interface{}); ok {
				out["loadBalancer_ingress"] = ing
			}
		}
	}
	return out
}

func extractIngressBackendServices(spec map[string]interface{}) []map[string]interface{} {
	var backends []map[string]interface{}
	if spec == nil {
		return backends
	}
	rules, _ := spec["rules"].([]interface{})
	for _, r := range rules {
		rule, _ := r.(map[string]interface{})
		if rule == nil {
			continue
		}
		http, _ := rule["http"].(map[string]interface{})
		if http == nil {
			continue
		}
		paths, _ := http["paths"].([]interface{})
		for _, p := range paths {
			path, _ := p.(map[string]interface{})
			if path == nil {
				continue
			}
			backend, _ := path["backend"].(map[string]interface{})
			if backend == nil {
				continue
			}
			svc, _ := backend["service"].(map[string]interface{})
			if svc == nil {
				continue
			}
			svcName, _ := svc["name"].(string)
			if svcName == "" {
				continue
			}
			portNum := int64(0)
			if port, ok := svc["port"].(map[string]interface{}); ok && port != nil {
				switch n := port["number"].(type) {
				case int64:
					portNum = n
				case float64:
					portNum = int64(n)
				}
			}
			backends = append(backends, map[string]interface{}{
				"service_name": svcName,
				"port":         portNum,
			})
		}
	}
	return backends
}

func analyzeIngressHealthFindings(spec map[string]interface{}, backendServices []map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	rules, _ := spec["rules"].([]interface{})
	if len(rules) == 0 {
		flags = append(flags, "NO_RULES")
		recs = append(recs, "Add at least one Ingress rule with host and path.")
	}
	for _, b := range backendServices {
		exists, _ := b["exists"].(bool)
		if !exists {
			name, _ := b["service_name"].(string)
			flags = append(flags, "BACKEND_SERVICE_NOT_FOUND:"+name)
			recs = append(recs, "Create Service "+name+" in the same namespace or fix the Ingress backend reference.")
		}
	}
	if len(flags) == 0 && len(recs) == 0 {
		recs = append(recs, "Ingress rules and backends look valid.")
	}
	return flags, recs
}

// ─── observe_ingress_events ────────────────────────────────────────────────────

func (s *mcpServerImpl) handleIngressEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_ingress_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Ingress", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_networkpolicy_detailed ────────────────────────────────────────────

func (s *mcpServerImpl) handleNetworkPolicyDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_networkpolicy_detailed: 'namespace' and 'name' are required")
	}
	var np map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/networkpolicies/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &np); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("NetworkPolicy %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "NetworkPolicy", name, namespace, 10)
	spec, _ := np["spec"].(map[string]interface{})
	metadata, _ := np["metadata"].(map[string]interface{})
	data := extractNetworkPolicyData(spec)
	podsSelected := listPodsMatchingSelector(ctx, c, clusterID, namespace, spec)
	return map[string]interface{}{
		"metadata":       metadata,
		"data":           data,
		"events":         events,
		"relationships":  map[string]interface{}{"pods_selected": podsSelected},
		"risk_flags":     []string{},
		"recommendations": []string{},
		"timestamp":      time.Now(),
	}, nil
}

func extractNetworkPolicyData(spec map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec == nil {
		return out
	}
	if ps, ok := spec["podSelector"].(map[string]interface{}); ok && ps != nil {
		out["podSelector"] = ps
	}
	if pt, ok := spec["policyTypes"].([]interface{}); ok {
		out["policyTypes"] = pt
	}
	if ing, ok := spec["ingress"].([]interface{}); ok {
		out["ingress_rules_count"] = len(ing)
	}
	if eg, ok := spec["egress"].([]interface{}); ok {
		out["egress_rules_count"] = len(eg)
	}
	return out
}

func listPodsMatchingSelector(ctx context.Context, c *backendHTTP, clusterID, namespace string, spec map[string]interface{}) []map[string]interface{} {
	if spec == nil {
		return nil
	}
	ps, ok := spec["podSelector"].(map[string]interface{})
	if !ok || len(ps) == 0 {
		return nil
	}
	matchLabels, _ := ps["matchLabels"].(map[string]interface{})
	if matchLabels == nil {
		return nil
	}
	var parts []string
	for k, v := range matchLabels {
		if vs, ok := v.(string); ok {
			parts = append(parts, k+"="+vs)
		}
	}
	if len(parts) == 0 {
		return nil
	}
	labelSel := strings.Join(parts, ",")
	q := url.Values{}
	q.Set("namespace", namespace)
	q.Set("labelSelector", labelSel)
	path := c.clusterPath(clusterID, "/resources/pods") + "?" + q.Encode()
	var podList map[string]interface{}
	if err := c.get(ctx, path, &podList); err != nil {
		return nil
	}
	items, _ := podList["items"].([]interface{})
	result := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if pod, ok := item.(map[string]interface{}); ok {
			meta, _ := pod["metadata"].(map[string]interface{})
			result = append(result, map[string]interface{}{
				"name":      meta["name"],
				"namespace": meta["namespace"],
			})
		}
	}
	return result
}

// ─── observe_networkpolicy_events ────────────────────────────────────────────

func (s *mcpServerImpl) handleNetworkPolicyEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_networkpolicy_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "NetworkPolicy", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_network_policies ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleNetworkPolicies(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}

	var policies map[string]interface{}
	path := c.clusterPath(clusterID, "/resources/networkpolicies")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	if err := c.get(ctx, path, &policies); err != nil {
		return nil, err
	}
	return policies, nil
}

// ─── observe_pvc_detailed ──────────────────────────────────────────────────────

func (s *mcpServerImpl) handlePvcDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pvc_detailed: 'namespace' and 'name' are required")
	}
	var pvc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &pvc); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("PersistentVolumeClaim %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var consumers map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/consumers"), &consumers)
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "PersistentVolumeClaim", name, namespace, 10)
	spec, _ := pvc["spec"].(map[string]interface{})
	status, _ := pvc["status"].(map[string]interface{})
	metadata, _ := pvc["metadata"].(map[string]interface{})
	data := extractPvcData(spec, status)
	relationships := map[string]interface{}{"consumers": consumers}
	if volName := getPvcVolumeName(spec, status); volName != "" {
		relationships["bound_volume"] = map[string]interface{}{"volumeName": volName}
	}
	riskFlags, recommendations := analyzePvcRiskFindings(status)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractPvcData(spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if am, ok := spec["accessModes"].([]interface{}); ok {
			out["accessModes"] = am
		}
		if res, ok := spec["resources"].(map[string]interface{}); ok && res != nil {
			if req, ok := res["requests"].(map[string]interface{}); ok && req != nil {
				out["requested_storage"] = req["storage"]
			}
		}
		if sc, ok := spec["storageClassName"].(string); ok {
			out["storageClassName"] = sc
		}
		if vn, ok := spec["volumeName"].(string); ok && vn != "" {
			out["volumeName"] = vn
		}
	}
	if status != nil {
		if phase, ok := status["phase"].(string); ok {
			out["phase"] = phase
		}
		if cap, ok := status["capacity"].(map[string]interface{}); ok && cap != nil {
			out["capacity"] = cap
		}
	}
	return out
}

func getPvcVolumeName(spec, status map[string]interface{}) string {
	if spec != nil {
		if vn, ok := spec["volumeName"].(string); ok && vn != "" {
			return vn
		}
	}
	return ""
}

func analyzePvcRiskFindings(status map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	phase := ""
	if status != nil {
		phase, _ = status["phase"].(string)
	}
	switch phase {
	case "":
		// no phase
	case "Bound":
		// healthy
	case "Pending":
		flags = append(flags, "PVC_PENDING")
		recs = append(recs, "PVC is Pending — check StorageClass, provisioner, and capacity.")
	case "Lost":
		flags = append(flags, "PVC_LOST")
		recs = append(recs, "PVC is Lost — underlying volume may be deleted; consider reclaiming or recreating the volume.")
	default:
		flags = append(flags, "PVC_"+strings.ToUpper(phase))
		recs = append(recs, "PVC is in "+phase+" state — investigate provisioner and cluster storage.")
	}
	if len(flags) == 0 {
		recs = append(recs, "PVC is Bound and healthy.")
	}
	return flags, recs
}

// ─── observe_pvc_events ────────────────────────────────────────────────────────

func (s *mcpServerImpl) handlePvcEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pvc_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "PersistentVolumeClaim", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_pvc_consumers ────────────────────────────────────────────────────

func (s *mcpServerImpl) handlePvcConsumers(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pvc_consumers: 'namespace' and 'name' are required")
	}
	var pvc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &pvc); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("PersistentVolumeClaim %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var consumers map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/consumers"), &consumers); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"pvc":       name,
		"namespace": namespace,
		"consumers": consumers,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_pv_detailed ──────────────────────────────────────────────────────

const clusterScopedNamespace = "-"

func (s *mcpServerImpl) handlePvDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_pv_detailed: 'name' is required")
	}
	var pv map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes/"+clusterScopedNamespace+"/"+url.PathEscape(name)), &pv); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("PersistentVolume %q not found", name)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "PersistentVolume", name, clusterScopedNamespace, 10)
	spec, _ := pv["spec"].(map[string]interface{})
	status, _ := pv["status"].(map[string]interface{})
	metadata, _ := pv["metadata"].(map[string]interface{})
	data := extractPvData(spec, status)
	claimRef := getPvClaimRef(spec)
	relationships := map[string]interface{}{}
	if claimRef != nil {
		relationships["claim"] = claimRef
		// Optionally verify PVC exists (namespace/name from claimRef)
		if ns, _ := claimRef["namespace"].(string); ns != "" {
			if n, _ := claimRef["name"].(string); n != "" {
				var pvc map[string]interface{}
				_ = c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims/"+url.PathEscape(ns)+"/"+url.PathEscape(n)), &pvc)
				relationships["claim_exists"] = pvc != nil && len(pvc) > 0
			}
		}
	}
	riskFlags, recommendations := analyzePvRiskFindings(pv, spec, status, relationships)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractPvData(spec, status map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec != nil {
		if cap, ok := spec["capacity"].(map[string]interface{}); ok && cap != nil {
			out["capacity"] = cap
		}
		if am, ok := spec["accessModes"].([]interface{}); ok {
			out["accessModes"] = am
		}
		if rp, ok := spec["persistentVolumeReclaimPolicy"].(string); ok {
			out["persistentVolumeReclaimPolicy"] = rp
		}
		if sc, ok := spec["storageClassName"].(string); ok {
			out["storageClassName"] = sc
		}
		if cr, ok := spec["claimRef"].(map[string]interface{}); ok && cr != nil {
			out["claimRef"] = cr
		}
	}
	if status != nil {
		if phase, ok := status["phase"].(string); ok {
			out["phase"] = phase
		}
	}
	return out
}

func getPvClaimRef(spec map[string]interface{}) map[string]interface{} {
	if spec == nil {
		return nil
	}
	cr, ok := spec["claimRef"].(map[string]interface{})
	if !ok || cr == nil {
		return nil
	}
	return map[string]interface{}{
		"namespace": cr["namespace"],
		"name":      cr["name"],
	}
}

func analyzePvRiskFindings(pv map[string]interface{}, spec, status map[string]interface{}, relationships map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	phase := ""
	if status != nil {
		phase, _ = status["phase"].(string)
	}
	claimExists, _ := relationships["claim_exists"].(bool)
	claimRef := getPvClaimRef(spec)
	switch phase {
	case "Available":
		flags = append(flags, "PV_AVAILABLE")
		recs = append(recs, "PV has no bound claim — consider reclaiming or using for a PVC.")
	case "Released":
		flags = append(flags, "PV_RELEASED")
		recs = append(recs, "PV is Released — claim was deleted; check reclaim policy and clean up if needed.")
	case "Bound":
		if claimRef != nil && !claimExists {
			flags = append(flags, "ORPHAN_PV")
			recs = append(recs, "PV is Bound but referenced PVC not found — claim may have been deleted; PV may need manual reclaim.")
		} else {
			recs = append(recs, "PV is Bound and healthy.")
		}
	case "Failed":
		flags = append(flags, "PV_FAILED")
		recs = append(recs, "PV is in Failed state — check provisioner and volume backend.")
	default:
		if phase != "" {
			flags = append(flags, "PV_"+strings.ToUpper(phase))
			recs = append(recs, "PV is in "+phase+" state.")
		}
	}
	return flags, recs
}

// ─── observe_pv_events ────────────────────────────────────────────────────────

func (s *mcpServerImpl) handlePvEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_pv_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "PersistentVolume", name, clusterScopedNamespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_storageclass_detailed ────────────────────────────────────────────

func (s *mcpServerImpl) handleStorageClassDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_storageclass_detailed: 'name' is required")
	}
	var sc map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses/"+clusterScopedNamespace+"/"+url.PathEscape(name)), &sc); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("StorageClass %q not found", name)
		}
		return nil, err
	}
	var pvCounts map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses/pv-counts"), &pvCounts)
	pvCount := int64(0)
	if pvCounts != nil {
		if n, ok := pvCounts[name].(float64); ok {
			pvCount = int64(n)
		}
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "StorageClass", name, clusterScopedNamespace, 10)
	provisioner, _ := sc["provisioner"].(string)
	metadata, _ := sc["metadata"].(map[string]interface{})
	data := extractStorageClassData(sc)
	relationships := map[string]interface{}{"pv_count": pvCount}
	riskFlags, recommendations := analyzeStorageClassRiskFindings(provisioner, data)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractStorageClassData(sc map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if sc == nil {
		return out
	}
	if p, ok := sc["provisioner"].(string); ok {
		out["provisioner"] = p
	}
	if params, ok := sc["parameters"].(map[string]interface{}); ok && params != nil {
		out["parameters"] = params
	}
	if ave, ok := sc["allowVolumeExpansion"].(bool); ok {
		out["allowVolumeExpansion"] = ave
	}
	if vbm, ok := sc["volumeBindingMode"].(string); ok {
		out["volumeBindingMode"] = vbm
	}
	return out
}

func analyzeStorageClassRiskFindings(provisioner string, data map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if provisioner == "" {
		flags = append(flags, "NO_PROVISIONER")
		recs = append(recs, "StorageClass has no provisioner — dynamic provisioning will not work.")
	} else {
		recs = append(recs, "StorageClass is valid; provisioner: "+provisioner)
	}
	return flags, recs
}

// ─── observe_storageclass_events ───────────────────────────────────────────────

func (s *mcpServerImpl) handleStorageClassEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_storageclass_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "StorageClass", name, clusterScopedNamespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_storage_status ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleStorageStatus(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	namespace := strArg(args, "namespace")
	q := url.Values{}
	if namespace != "" {
		q.Set("namespace", namespace)
	}
	qs := ""
	if len(q) > 0 {
		qs = "?" + q.Encode()
	}

	results := map[string]interface{}{}

	var pvcs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumeclaims"+qs), &pvcs); err == nil {
		results["pvcs"] = pvcs
	}

	var pvs map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/persistentvolumes"), &pvs); err == nil {
		results["pvs"] = pvs
	}

	var storageClasses map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses"), &storageClasses); err == nil {
		results["storage_classes"] = storageClasses
	}

	var pvCounts map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/storageclasses/pv-counts"), &pvCounts); err == nil {
		results["pv_counts_by_storageclass"] = pvCounts
	}

	return results, nil
}

// ─── Security: ServiceAccounts ────────────────────────────────────────────────

func (s *mcpServerImpl) handleServiceAccountDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_serviceaccount_detailed: 'namespace' and 'name' are required")
	}
	var sa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/serviceaccounts/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &sa); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ServiceAccount %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "ServiceAccount", name, namespace, 10)
	metadata, _ := sa["metadata"].(map[string]interface{})
	spec, _ := sa["spec"].(map[string]interface{})
	data := map[string]interface{}{}
	if spec != nil {
		data["spec"] = spec
	}
	tokenCount := 0
	var tokenCounts map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/serviceaccounts/token-counts"), &tokenCounts); err == nil && tokenCounts != nil {
		if n, ok := tokenCounts[namespace+"/"+name]; ok {
			switch v := n.(type) {
			case float64:
				tokenCount = int(v)
			case int:
				tokenCount = v
			}
		}
	}
	podsUsingSA := listPodsUsingServiceAccount(ctx, c, clusterID, namespace, name)
	roleBindings := listRoleBindingsForSubject(ctx, c, clusterID, namespace, "ServiceAccount", name, "")
	clusterRoleBindings := listClusterRoleBindingsForSubject(ctx, c, clusterID, "ServiceAccount", name, namespace)
	relationships := map[string]interface{}{
		"token_count":            tokenCount,
		"pods_using_sa":          podsUsingSA,
		"role_bindings":          roleBindings,
		"cluster_role_bindings":  clusterRoleBindings,
	}
	riskFlags, recommendations := analyzeServiceAccountRiskFindings(tokenCount, roleBindings, clusterRoleBindings)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func listPodsUsingServiceAccount(ctx context.Context, c *backendHTTP, clusterID, namespace, saName string) []map[string]interface{} {
	q := url.Values{}
	q.Set("namespace", namespace)
	q.Set("fieldSelector", "spec.serviceAccountName="+saName)
	path := c.clusterPath(clusterID, "/resources/pods") + "?" + q.Encode()
	var list map[string]interface{}
	if err := c.get(ctx, path, &list); err != nil {
		return nil
	}
	items, _ := list["items"].([]interface{})
	out := make([]map[string]interface{}, 0, len(items))
	for _, it := range items {
		pod, _ := it.(map[string]interface{})
		if pod == nil {
			continue
		}
		meta, _ := pod["metadata"].(map[string]interface{})
		out = append(out, map[string]interface{}{"name": meta["name"], "namespace": meta["namespace"]})
	}
	return out
}

func listRoleBindingsForSubject(ctx context.Context, c *backendHTTP, clusterID, namespace, subjectKind, subjectName, subjectNamespace string) []map[string]interface{} {
	var list map[string]interface{}
	q := url.Values{}
	q.Set("namespace", namespace)
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings")+"?"+q.Encode(), &list); err != nil {
		return nil
	}
	items, _ := list["items"].([]interface{})
	var out []map[string]interface{}
	for _, it := range items {
		rb, _ := it.(map[string]interface{})
		if rb == nil {
			continue
		}
		spec, _ := rb["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		subjects, _ := spec["subjects"].([]interface{})
		for _, sub := range subjects {
			sm, _ := sub.(map[string]interface{})
			if sm == nil {
				continue
			}
			kind, _ := sm["kind"].(string)
			n, _ := sm["name"].(string)
			ns, _ := sm["namespace"].(string)
			if kind == subjectKind && n == subjectName && (subjectNamespace == "" || ns == subjectNamespace) {
				meta, _ := rb["metadata"].(map[string]interface{})
				out = append(out, map[string]interface{}{"name": meta["name"], "namespace": namespace})
				break
			}
		}
	}
	return out
}

func listClusterRoleBindingsForSubject(ctx context.Context, c *backendHTTP, clusterID, subjectKind, subjectName, subjectNamespace string) []map[string]interface{} {
	var list map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &list); err != nil {
		return nil
	}
	items, _ := list["items"].([]interface{})
	var out []map[string]interface{}
	for _, it := range items {
		crb, _ := it.(map[string]interface{})
		if crb == nil {
			continue
		}
		spec, _ := crb["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		subjects, _ := spec["subjects"].([]interface{})
		for _, sub := range subjects {
			sm, _ := sub.(map[string]interface{})
			if sm == nil {
				continue
			}
			kind, _ := sm["kind"].(string)
			n, _ := sm["name"].(string)
			ns, _ := sm["namespace"].(string)
			if kind == subjectKind && n == subjectName && ns == subjectNamespace {
				meta, _ := crb["metadata"].(map[string]interface{})
				out = append(out, map[string]interface{}{"name": meta["name"]})
				break
			}
		}
	}
	return out
}

func analyzeServiceAccountRiskFindings(tokenCount int, roleBindings, clusterRoleBindings []map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if tokenCount > 10 {
		flags = append(flags, "EXCESSIVE_TOKEN_COUNT")
		recs = append(recs, "ServiceAccount has many token secrets — consider reducing or rotating.")
	}
	if len(flags) == 0 {
		recs = append(recs, "Review role_bindings and cluster_role_bindings for least-privilege.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleServiceAccountEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_serviceaccount_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "ServiceAccount", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

func (s *mcpServerImpl) handleServiceAccountPermissions(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_serviceaccount_permissions: 'namespace' and 'name' are required")
	}
	var sa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/serviceaccounts/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &sa); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ServiceAccount %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	roleBindings := listRoleBindingsForSubject(ctx, c, clusterID, namespace, "ServiceAccount", name, "")
	clusterRoleBindings := listClusterRoleBindingsForSubject(ctx, c, clusterID, "ServiceAccount", name, namespace)
	var permissionsSummary []map[string]interface{}
	for _, rb := range roleBindings {
		rbName, _ := rb["name"].(string)
		var binding map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings/"+url.PathEscape(namespace)+"/"+url.PathEscape(rbName)), &binding)
		roleRef := getRoleRefFromBinding(binding)
		if roleRef != nil {
			kind, _ := roleRef["kind"].(string)
			rName, _ := roleRef["name"].(string)
			summary := map[string]interface{}{"binding": rbName, "binding_kind": "RoleBinding", "role_kind": kind, "role_name": rName}
			if kind == "Role" {
				var role map[string]interface{}
				_ = c.get(ctx, c.clusterPath(clusterID, "/resources/roles/"+url.PathEscape(namespace)+"/"+url.PathEscape(rName)), &role)
				summary["rules_count"] = countPolicyRules(role)
			} else {
				var cr map[string]interface{}
				_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles/-/"+url.PathEscape(rName)), &cr)
				summary["rules_count"] = countPolicyRules(cr)
			}
			permissionsSummary = append(permissionsSummary, summary)
		}
	}
	for _, crb := range clusterRoleBindings {
		crbName, _ := crb["name"].(string)
		var binding map[string]interface{}
		_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings/-/"+url.PathEscape(crbName)), &binding)
		roleRef := getRoleRefFromBinding(binding)
		if roleRef != nil {
			rName, _ := roleRef["name"].(string)
			summary := map[string]interface{}{"binding": crbName, "binding_kind": "ClusterRoleBinding", "role_name": rName}
			var cr map[string]interface{}
			_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles/-/"+url.PathEscape(rName)), &cr)
			summary["rules_count"] = countPolicyRules(cr)
			permissionsSummary = append(permissionsSummary, summary)
		}
	}
	return map[string]interface{}{
		"service_account":       name,
		"namespace":             namespace,
		"role_bindings":         roleBindings,
		"cluster_role_bindings": clusterRoleBindings,
		"permissions_summary":   permissionsSummary,
		"timestamp":             time.Now(),
	}, nil
}

func getRoleRefFromBinding(binding map[string]interface{}) map[string]interface{} {
	if binding == nil {
		return nil
	}
	spec, _ := binding["spec"].(map[string]interface{})
	if spec == nil {
		return nil
	}
	ref, _ := spec["roleRef"].(map[string]interface{})
	return ref
}

func countPolicyRules(role map[string]interface{}) int {
	if role == nil {
		return 0
	}
	spec, _ := role["spec"].(map[string]interface{})
	if spec == nil {
		return 0
	}
	rules, _ := spec["rules"].([]interface{})
	return len(rules)
}

// ─── Security: Roles ──────────────────────────────────────────────────────────

func (s *mcpServerImpl) handleRoleDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_role_detailed: 'namespace' and 'name' are required")
	}
	var role map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/roles/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &role); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Role %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Role", name, namespace, 10)
	metadata, _ := role["metadata"].(map[string]interface{})
	spec, _ := role["spec"].(map[string]interface{})
	data := extractRoleData(spec)
	roleBindings := listRoleBindingsReferencingRole(ctx, c, clusterID, namespace, name)
	relationships := map[string]interface{}{"role_bindings": roleBindings}
	riskFlags, recommendations := analyzeRoleRiskFindings(spec)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractRoleData(spec map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if spec == nil {
		return out
	}
	if rules, ok := spec["rules"].([]interface{}); ok {
		out["rules"] = rules
	}
	return out
}

func listRoleBindingsReferencingRole(ctx context.Context, c *backendHTTP, clusterID, namespace, roleName string) []map[string]interface{} {
	var list map[string]interface{}
	q := url.Values{}
	q.Set("namespace", namespace)
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings")+"?"+q.Encode(), &list); err != nil {
		return nil
	}
	items, _ := list["items"].([]interface{})
	var out []map[string]interface{}
	for _, it := range items {
		rb, _ := it.(map[string]interface{})
		if rb == nil {
			continue
		}
		spec, _ := rb["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		ref, _ := spec["roleRef"].(map[string]interface{})
		if ref == nil {
			continue
		}
		kind, _ := ref["kind"].(string)
		n, _ := ref["name"].(string)
		if (kind == "Role" || kind == "") && n == roleName {
			meta, _ := rb["metadata"].(map[string]interface{})
			subjects, _ := spec["subjects"].([]interface{})
			out = append(out, map[string]interface{}{"name": meta["name"], "namespace": namespace, "subjects": subjects})
		}
	}
	return out
}

func analyzeRoleRiskFindings(spec map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if spec != nil {
		rules, _ := spec["rules"].([]interface{})
		for _, r := range rules {
			m, _ := r.(map[string]interface{})
			if m == nil {
				continue
			}
			verbs, _ := m["verbs"].([]interface{})
			for _, v := range verbs {
				if sv, ok := v.(string); ok && sv == "*" {
					flags = append(flags, "WILDCARD_VERBS")
					recs = append(recs, "Role contains wildcard verb (*) — prefer least-privilege verbs.")
					break
				}
			}
			resources, _ := m["resources"].([]interface{})
			for _, res := range resources {
				if sres, ok := res.(string); ok && sres == "*" {
					flags = append(flags, "WILDCARD_RESOURCES")
					recs = append(recs, "Role contains wildcard resource (*) — prefer specific resources.")
					break
				}
			}
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "Role has no wildcard rules; review bindings for least-privilege.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleRoleEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_role_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Role", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Security: RoleBindings ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleRoleBindingDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_rolebinding_detailed: 'namespace' and 'name' are required")
	}
	var rb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/rolebindings/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &rb); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("RoleBinding %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "RoleBinding", name, namespace, 10)
	metadata, _ := rb["metadata"].(map[string]interface{})
	spec, _ := rb["spec"].(map[string]interface{})
	data := map[string]interface{}{}
	if spec != nil {
		data["roleRef"] = spec["roleRef"]
		data["subjects"] = spec["subjects"]
	}
	roleRef, _ := spec["roleRef"].(map[string]interface{})
	var resolvedRole map[string]interface{}
	if roleRef != nil {
		kind, _ := roleRef["kind"].(string)
		rName, _ := roleRef["name"].(string)
		if rName != "" {
			if kind == "Role" || kind == "" {
				_ = c.get(ctx, c.clusterPath(clusterID, "/resources/roles/"+url.PathEscape(namespace)+"/"+url.PathEscape(rName)), &resolvedRole)
			} else {
				_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles/-/"+url.PathEscape(rName)), &resolvedRole)
			}
		}
	}
	relationships := map[string]interface{}{"subjects": spec["subjects"]}
	if resolvedRole != nil {
		relationships["role"] = map[string]interface{}{
			"name": roleRef["name"],
			"kind": roleRef["kind"],
			"rules_count": countPolicyRules(resolvedRole),
		}
	}
	riskFlags, recommendations := analyzeRoleBindingRiskFindings(roleRef, resolvedRole)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func analyzeRoleBindingRiskFindings(roleRef, resolvedRole map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if roleRef != nil {
		rName, _ := roleRef["name"].(string)
		kind, _ := roleRef["kind"].(string)
		if rName == "cluster-admin" && (kind == "ClusterRole" || kind == "") {
			flags = append(flags, "CLUSTER_ADMIN_BOUND")
			recs = append(recs, "RoleBinding grants cluster-admin — ensure this is intentional and restricted.")
		}
	}
	if resolvedRole != nil {
		spec, _ := resolvedRole["spec"].(map[string]interface{})
		if spec != nil {
			rules, _ := spec["rules"].([]interface{})
			for _, r := range rules {
				m, _ := r.(map[string]interface{})
				if m == nil {
					continue
				}
				verbs, _ := m["verbs"].([]interface{})
				for _, v := range verbs {
					if sv, ok := v.(string); ok && sv == "*" {
						flags = append(flags, "OVERPRIVILEGED")
						recs = append(recs, "Resolved role has wildcard verbs — consider least-privilege.")
						break
					}
				}
			}
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "Review subjects for least-privilege.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleRoleBindingEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_rolebinding_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "RoleBinding", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Security: ClusterRoles ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleClusterRoleDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_clusterrole_detailed: 'name' is required")
	}
	var cr map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles/-/"+url.PathEscape(name)), &cr); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ClusterRole %q not found", name)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "ClusterRole", name, clusterScopedNamespace, 10)
	metadata, _ := cr["metadata"].(map[string]interface{})
	spec, _ := cr["spec"].(map[string]interface{})
	data := extractRoleData(spec)
	clusterRoleBindings := listClusterRoleBindingsReferencingRole(ctx, c, clusterID, name)
	relationships := map[string]interface{}{"cluster_role_bindings": clusterRoleBindings}
	riskFlags, recommendations := analyzeClusterRoleRiskFindings(name, spec)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func listClusterRoleBindingsReferencingRole(ctx context.Context, c *backendHTTP, clusterID, roleName string) []map[string]interface{} {
	var list map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings"), &list); err != nil {
		return nil
	}
	items, _ := list["items"].([]interface{})
	var out []map[string]interface{}
	for _, it := range items {
		crb, _ := it.(map[string]interface{})
		if crb == nil {
			continue
		}
		spec, _ := crb["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		ref, _ := spec["roleRef"].(map[string]interface{})
		if ref == nil {
			continue
		}
		kind, _ := ref["kind"].(string)
		n, _ := ref["name"].(string)
		if (kind == "ClusterRole" || kind == "") && n == roleName {
			meta, _ := crb["metadata"].(map[string]interface{})
			subjects, _ := spec["subjects"].([]interface{})
			out = append(out, map[string]interface{}{"name": meta["name"], "subjects": subjects})
		}
	}
	return out
}

func analyzeClusterRoleRiskFindings(roleName string, spec map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if roleName == "cluster-admin" {
		flags = append(flags, "CLUSTER_ADMIN_ROLE")
		recs = append(recs, "This is the cluster-admin ClusterRole — audit who is bound to it.")
	}
	if spec != nil {
		rules, _ := spec["rules"].([]interface{})
		for _, r := range rules {
			m, _ := r.(map[string]interface{})
			if m == nil {
				continue
			}
			verbs, _ := m["verbs"].([]interface{})
			for _, v := range verbs {
				if sv, ok := v.(string); ok && sv == "*" {
					flags = append(flags, "WILDCARD_VERBS")
					recs = append(recs, "ClusterRole contains wildcard verb (*).")
					break
				}
			}
			resources, _ := m["resources"].([]interface{})
			for _, res := range resources {
				if sres, ok := res.(string); ok && sres == "*" {
					flags = append(flags, "WILDCARD_RESOURCES")
					recs = append(recs, "ClusterRole contains wildcard resource (*).")
					break
				}
			}
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "Review cluster_role_bindings for least-privilege.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleClusterRoleEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_clusterrole_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "ClusterRole", name, clusterScopedNamespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Security: ClusterRoleBindings ────────────────────────────────────────────

func (s *mcpServerImpl) handleClusterRoleBindingDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_clusterrolebinding_detailed: 'name' is required")
	}
	var crb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/clusterrolebindings/-/"+url.PathEscape(name)), &crb); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ClusterRoleBinding %q not found", name)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "ClusterRoleBinding", name, clusterScopedNamespace, 10)
	metadata, _ := crb["metadata"].(map[string]interface{})
	spec, _ := crb["spec"].(map[string]interface{})
	data := map[string]interface{}{}
	if spec != nil {
		data["roleRef"] = spec["roleRef"]
		data["subjects"] = spec["subjects"]
	}
	roleRef, _ := spec["roleRef"].(map[string]interface{})
	var clusterRole map[string]interface{}
	if roleRef != nil {
		rName, _ := roleRef["name"].(string)
		if rName != "" {
			_ = c.get(ctx, c.clusterPath(clusterID, "/resources/clusterroles/-/"+url.PathEscape(rName)), &clusterRole)
		}
	}
	relationships := map[string]interface{}{"subjects": spec["subjects"]}
	if clusterRole != nil {
		relationships["cluster_role"] = map[string]interface{}{"name": roleRef["name"], "rules_count": countPolicyRules(clusterRole)}
	}
	riskFlags, recommendations := analyzeClusterRoleBindingRiskFindings(roleRef, spec)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func analyzeClusterRoleBindingRiskFindings(roleRef, spec map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if roleRef != nil {
		rName, _ := roleRef["name"].(string)
		if rName == "cluster-admin" {
			flags = append(flags, "CLUSTER_ADMIN_BOUND")
			recs = append(recs, "ClusterRoleBinding grants cluster-admin — audit subjects.")
		}
	}
	if spec != nil {
		subjects, _ := spec["subjects"].([]interface{})
		for _, sub := range subjects {
			sm, _ := sub.(map[string]interface{})
			if sm == nil {
				continue
			}
			kind, _ := sm["kind"].(string)
			ns, _ := sm["namespace"].(string)
			if kind == "ServiceAccount" && ns != "" && ns != "kube-system" && ns != "default" {
				if roleRef != nil {
					rName, _ := roleRef["name"].(string)
					if rName == "cluster-admin" {
						flags = append(flags, "CLUSTER_ADMIN_TO_NON_SYSTEM_SA")
						recs = append(recs, "cluster-admin is bound to a ServiceAccount outside kube-system/default — high risk.")
						break
					}
				}
			}
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "Review subjects for least-privilege.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleClusterRoleBindingEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_clusterrolebinding_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "ClusterRoleBinding", name, clusterScopedNamespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Security: Secrets ───────────────────────────────────────────────────────

func (s *mcpServerImpl) handleSecretDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_secret_detailed: 'namespace' and 'name' are required")
	}
	var secret map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/secrets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &secret); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Secret %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var consumers map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/consumers"), &consumers)
	var tlsInfo map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/secrets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/tls-info"), &tlsInfo)
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "Secret", name, namespace, 10)
	metadata, _ := secret["metadata"].(map[string]interface{})
	data := extractSecretData(secret)
	relationships := map[string]interface{}{"consumers": consumers}
	if tlsInfo != nil && len(tlsInfo) > 0 {
		relationships["tls_info"] = tlsInfo
	}
	consumerCount := countSecretConsumers(consumers)
	riskFlags, recommendations := analyzeSecretRiskFindings(secret, consumers, tlsInfo, consumerCount)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractSecretData(secret map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if secret == nil {
		return out
	}
	if t, ok := secret["type"].(string); ok {
		out["type"] = t
	}
	if data, ok := secret["data"].(map[string]interface{}); ok && data != nil {
		keys := make([]string, 0, len(data))
		for k := range data {
			keys = append(keys, k)
		}
		out["data_keys"] = keys
	}
	return out
}

func countSecretConsumers(consumers map[string]interface{}) int {
	if consumers == nil {
		return 0
	}
	pods, _ := consumers["pods"].([]interface{})
	return len(pods)
}

func analyzeSecretRiskFindings(secret map[string]interface{}, consumers map[string]interface{}, tlsInfo map[string]interface{}, consumerCount int) ([]string, []string) {
	var flags []string
	var recs []string
	if consumerCount > 20 {
		flags = append(flags, "MANY_CONSUMERS")
		recs = append(recs, "Secret is referenced by many pods — consider narrowing access.")
	}
	if tlsInfo != nil {
		if errStr, ok := tlsInfo["error"].(string); ok && errStr != "" {
			// no expiry flags if error
		} else if exp, ok := tlsInfo["notAfter"].(string); ok && exp != "" {
			recs = append(recs, "TLS certificate notAfter: "+exp+" — ensure rotation before expiry.")
		}
	}
	if len(flags) == 0 && len(recs) == 0 {
		recs = append(recs, "Secret metadata and consumers reviewed.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleSecretEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_secret_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "Secret", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

func (s *mcpServerImpl) handleSecretConsumers(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_secret_consumers: 'namespace' and 'name' are required")
	}
	var secret map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/secrets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &secret); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("Secret %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var consumers map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/secrets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/consumers"), &consumers); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"secret":     name,
		"namespace":  namespace,
		"consumers":  consumers,
		"timestamp":  time.Now(),
	}, nil
}

// ─── Resources: ConfigMaps ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleConfigMapDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_configmap_detailed: 'namespace' and 'name' are required")
	}
	var cm map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/configmaps/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &cm); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ConfigMap %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var consumers map[string]interface{}
	_ = c.get(ctx, c.clusterPath(clusterID, "/resources/configmaps/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/consumers"), &consumers)
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "ConfigMap", name, namespace, 10)
	metadata, _ := cm["metadata"].(map[string]interface{})
	dataKeys := extractConfigMapDataKeys(cm)
	relationships := map[string]interface{}{"consumers": consumers}
	if len(dataKeys) > 0 {
		relationships["data_keys"] = dataKeys
	}
	consumerCount := countConfigMapConsumers(consumers)
	riskFlags, recommendations := analyzeConfigMapRiskFindings(consumerCount)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":           map[string]interface{}{"data_keys": dataKeys},
		"events":         events,
		"relationships":  relationships,
		"risk_flags":     riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func extractConfigMapDataKeys(cm map[string]interface{}) []string {
	if cm == nil {
		return nil
	}
	data, _ := cm["data"].(map[string]interface{})
	if data == nil {
		return nil
	}
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	return keys
}

func countConfigMapConsumers(consumers map[string]interface{}) int {
	if consumers == nil {
		return 0
	}
	pods, _ := consumers["pods"].([]interface{})
	return len(pods)
}

func analyzeConfigMapRiskFindings(consumerCount int) ([]string, []string) {
	var flags []string
	var recs []string
	if consumerCount == 0 {
		flags = append(flags, "UNUSED_CONFIGMAP")
		recs = append(recs, "No pods reference this ConfigMap — consider removing if unused.")
	}
	if consumerCount > 20 {
		flags = append(flags, "MANY_CONSUMERS")
		recs = append(recs, "ConfigMap is referenced by many pods — verify scope.")
	}
	if len(flags) == 0 {
		recs = append(recs, "ConfigMap consumers and keys reviewed.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleConfigMapEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_configmap_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "ConfigMap", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

func (s *mcpServerImpl) handleConfigMapConsumers(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_configmap_consumers: 'namespace' and 'name' are required")
	}
	var cm map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/configmaps/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &cm); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ConfigMap %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	var consumers map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/configmaps/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/consumers"), &consumers); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"configmap":  name,
		"namespace":  namespace,
		"consumers":  consumers,
		"timestamp":  time.Now(),
	}, nil
}

// ─── Resources: LimitRanges ───────────────────────────────────────────────────

func (s *mcpServerImpl) handleLimitRangeDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_limitrange_detailed: 'namespace' and 'name' are required")
	}
	var lr map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/limitranges/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &lr); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("LimitRange %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "LimitRange", name, namespace, 10)
	metadata, _ := lr["metadata"].(map[string]interface{})
	spec, _ := lr["spec"].(map[string]interface{})
	data := map[string]interface{}{}
	if spec != nil {
		data["limits"] = spec["limits"]
	}
	return map[string]interface{}{
		"metadata":      metadata,
		"data":          data,
		"events":        events,
		"timestamp":     time.Now(),
	}, nil
}

func (s *mcpServerImpl) handleLimitRangeEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_limitrange_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "LimitRange", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Resources: ResourceQuotas ───────────────────────────────────────────────

func (s *mcpServerImpl) handleResourceQuotaDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_resourcequota_detailed: 'namespace' and 'name' are required")
	}
	var rq map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/resourcequotas/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &rq); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("ResourceQuota %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "ResourceQuota", name, namespace, 10)
	metadata, _ := rq["metadata"].(map[string]interface{})
	spec, _ := rq["spec"].(map[string]interface{})
	status, _ := rq["status"].(map[string]interface{})
	data := map[string]interface{}{}
	if spec != nil {
		data["hard"] = spec["hard"]
	}
	if status != nil {
		data["used"] = status["used"]
	}
	riskFlags, recommendations := analyzeResourceQuotaRiskFindings(spec, status)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func analyzeResourceQuotaRiskFindings(spec, status map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	hard, _ := spec["hard"].(map[string]interface{})
	used, _ := status["used"].(map[string]interface{})
	if hard != nil && used != nil {
		for k, vHard := range hard {
			vUsed, ok := used[k]
			if !ok {
				continue
			}
			// Compare quantity strings; if used >= hard (lexicographically for same format) or numerically
			sHard, _ := vHard.(string)
			sUsed, _ := vUsed.(string)
			if sHard != "" && sUsed != "" && sUsed == sHard {
				flags = append(flags, "QUOTA_EXHAUSTED")
				recs = append(recs, "ResourceQuota is exhausted for at least one resource ("+k+") — increase hard limit or free resources.")
				break
			}
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "ResourceQuota usage within limits.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleResourceQuotaEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_resourcequota_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "ResourceQuota", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Resources: HorizontalPodAutoscalers ──────────────────────────────────────

func (s *mcpServerImpl) handleHPADetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_hpa_detailed: 'namespace' and 'name' are required")
	}
	var hpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/horizontalpodautoscalers/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &hpa); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("HorizontalPodAutoscaler %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "HorizontalPodAutoscaler", name, namespace, 10)
	metadata, _ := hpa["metadata"].(map[string]interface{})
	spec, _ := hpa["spec"].(map[string]interface{})
	status, _ := hpa["status"].(map[string]interface{})
	specData := map[string]interface{}{}
	if spec != nil {
		specData["minReplicas"] = spec["minReplicas"]
		specData["maxReplicas"] = spec["maxReplicas"]
		specData["scaleTargetRef"] = spec["scaleTargetRef"]
	}
	statusData := map[string]interface{}{}
	if status != nil {
		statusData["currentReplicas"] = status["currentReplicas"]
		statusData["desiredReplicas"] = status["desiredReplicas"]
		statusData["currentMetrics"] = status["currentMetrics"]
	}
	scaleTargetRef, _ := spec["scaleTargetRef"].(map[string]interface{})
	var scaleTarget map[string]interface{}
	if scaleTargetRef != nil {
		kind, _ := scaleTargetRef["kind"].(string)
		targetName, _ := scaleTargetRef["name"].(string)
		if targetName != "" {
			kindLower := strings.ToLower(kind) + "s"
			if kind == "" {
				kindLower = "deployments"
			}
			_ = c.get(ctx, c.clusterPath(clusterID, "/resources/"+kindLower+"/"+url.PathEscape(namespace)+"/"+url.PathEscape(targetName)), &scaleTarget)
		}
	}
	relationships := map[string]interface{}{}
	if scaleTargetRef != nil {
		relationships["scale_target"] = map[string]interface{}{
			"kind": scaleTargetRef["kind"],
			"name": scaleTargetRef["name"],
		}
		if scaleTarget != nil {
			relationships["scale_target_exists"] = true
		} else {
			relationships["scale_target_exists"] = false
		}
	}
	riskFlags, recommendations := analyzeHPARiskFindings(spec, status, scaleTarget != nil)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            map[string]interface{}{"spec": specData, "status": statusData},
		"events":          events,
		"relationships":  relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func analyzeHPARiskFindings(spec, status map[string]interface{}, targetExists bool) ([]string, []string) {
	var flags []string
	var recs []string
	if !targetExists {
		flags = append(flags, "TARGET_NOT_FOUND")
		recs = append(recs, "Scale target (Deployment/StatefulSet) not found — fix scaleTargetRef.")
	}
	if status != nil {
		cur, _ := status["currentReplicas"].(float64)
		desired, _ := status["desiredReplicas"].(float64)
		maxR, _ := spec["maxReplicas"].(float64)
		minR := 0.0
		if spec != nil && spec["minReplicas"] != nil {
			minR, _ = spec["minReplicas"].(float64)
		}
		if maxR > 0 && (cur >= maxR || desired >= maxR) {
			flags = append(flags, "HPA_AT_MAX")
			recs = append(recs, "HPA is at maxReplicas — consider increasing max or scaling out.")
		}
		if cur <= minR && desired <= minR && minR > 0 {
			flags = append(flags, "HPA_AT_MIN")
			recs = append(recs, "HPA is at minReplicas — load may be low or target may need tuning.")
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "HPA scale target and replica range look healthy.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleHPAEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_hpa_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "HorizontalPodAutoscaler", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Resources: PodDisruptionBudgets ────────────────────────────────────────

func (s *mcpServerImpl) handlePDBDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pdb_detailed: 'namespace' and 'name' are required")
	}
	var pdb map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/poddisruptionbudgets/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &pdb); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("PodDisruptionBudget %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "PodDisruptionBudget", name, namespace, 10)
	metadata, _ := pdb["metadata"].(map[string]interface{})
	spec, _ := pdb["spec"].(map[string]interface{})
	status, _ := pdb["status"].(map[string]interface{})
	data := map[string]interface{}{}
	if spec != nil {
		data["minAvailable"] = spec["minAvailable"]
		data["maxUnavailable"] = spec["maxUnavailable"]
		data["selector"] = spec["selector"]
	}
	if status != nil {
		data["currentHealthy"] = status["currentHealthy"]
		data["desiredHealthy"] = status["desiredHealthy"]
		data["disruptedPodsAllowed"] = status["disruptedPodsAllowed"]
	}
	matchingCount := countPDBMatchingPods(ctx, c, clusterID, namespace, spec)
	relationships := map[string]interface{}{"matching_pods_count": matchingCount}
	riskFlags, recommendations := analyzePDBRiskFindings(spec, status)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            data,
		"events":          events,
		"relationships":  relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func countPDBMatchingPods(ctx context.Context, c *backendHTTP, clusterID, namespace string, spec map[string]interface{}) int {
	if spec == nil {
		return 0
	}
	selector, _ := spec["selector"].(map[string]interface{})
	if selector == nil {
		return 0
	}
	matchLabels, _ := selector["matchLabels"].(map[string]interface{})
	if matchLabels == nil || len(matchLabels) == 0 {
		return 0
	}
	parts := make([]string, 0, len(matchLabels))
	for k, v := range matchLabels {
		if vs, ok := v.(string); ok {
			parts = append(parts, k+"="+vs)
		}
	}
	if len(parts) == 0 {
		return 0
	}
	q := url.Values{}
	q.Set("namespace", namespace)
	q.Set("labelSelector", strings.Join(parts, ","))
	path := c.clusterPath(clusterID, "/resources/pods") + "?" + q.Encode()
	var list map[string]interface{}
	if err := c.get(ctx, path, &list); err != nil {
		return 0
	}
	items, _ := list["items"].([]interface{})
	return len(items)
}

func analyzePDBRiskFindings(spec, status map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if status != nil {
		allowed, _ := status["disruptedPodsAllowed"].(float64)
		if spec != nil && spec["minAvailable"] != nil && allowed == 0 {
			flags = append(flags, "PDB_BLOCKING_DRAIN")
			recs = append(recs, "PodDisruptionBudget allows zero disruptions — voluntary drains may be blocked.")
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "PDB status and selector reviewed.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handlePDBEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_pdb_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "PodDisruptionBudget", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── Scaling: VerticalPodAutoscalers (VPA) ─────────────────────────────────────

func (s *mcpServerImpl) handleVPADetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_vpa_detailed: 'namespace' and 'name' are required")
	}
	var vpa map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/verticalpodautoscalers/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)), &vpa); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("VerticalPodAutoscaler %q not found in namespace %q", name, namespace)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "VerticalPodAutoscaler", name, namespace, 10)
	metadata, _ := vpa["metadata"].(map[string]interface{})
	spec, _ := vpa["spec"].(map[string]interface{})
	status, _ := vpa["status"].(map[string]interface{})
	specData := map[string]interface{}{}
	if spec != nil {
		specData["targetRef"] = spec["targetRef"]
		specData["updatePolicy"] = spec["updatePolicy"]
		specData["resourcePolicy"] = spec["resourcePolicy"]
	}
	statusData := summarizeVPAStatus(status)
	targetRef, _ := spec["targetRef"].(map[string]interface{})
	var targetExists bool
	if targetRef != nil {
		targetName, _ := targetRef["name"].(string)
		targetKind, _ := targetRef["kind"].(string)
		if targetName != "" {
			kindLower := vpaTargetKindToResource(targetKind)
			var target map[string]interface{}
			err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+kindLower+"/"+url.PathEscape(namespace)+"/"+url.PathEscape(targetName)), &target)
			targetExists = err == nil && target != nil
		}
	}
	relationships := map[string]interface{}{}
	if targetRef != nil {
		relationships["target"] = map[string]interface{}{
			"kind": targetRef["kind"],
			"name": targetRef["name"],
		}
		relationships["target_exists"] = targetExists
	}
	riskFlags, recommendations := analyzeVPARiskFindings(spec, targetExists)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            map[string]interface{}{"spec": specData, "status": statusData},
		"events":          events,
		"relationships":   relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func vpaTargetKindToResource(kind string) string {
	switch kind {
	case "Deployment":
		return "deployments"
	case "StatefulSet":
		return "statefulsets"
	case "DaemonSet":
		return "daemonsets"
	case "ReplicaSet":
		return "replicasets"
	default:
		if kind == "" {
			return "deployments"
		}
		return strings.ToLower(kind) + "s"
	}
}

func summarizeVPAStatus(status map[string]interface{}) map[string]interface{} {
	if status == nil {
		return nil
	}
	out := map[string]interface{}{}
	if c, ok := status["conditions"].([]interface{}); ok && len(c) > 0 {
		out["conditions_count"] = len(c)
	}
	if rec, ok := status["recommendation"].(map[string]interface{}); ok && rec != nil {
		if cont, ok := rec["containerRecommendations"].([]interface{}); ok {
			out["container_recommendations_count"] = len(cont)
		}
	}
	return out
}

func analyzeVPARiskFindings(spec map[string]interface{}, targetExists bool) ([]string, []string) {
	var flags []string
	var recs []string
	if !targetExists {
		flags = append(flags, "TARGET_NOT_FOUND")
		recs = append(recs, "VPA target workload (Deployment/StatefulSet) not found — fix targetRef.")
	}
	if spec != nil {
		if up, ok := spec["updatePolicy"].(map[string]interface{}); ok && up != nil {
			if mode, _ := up["updateMode"].(string); mode == "Off" {
				flags = append(flags, "VPA_OFF")
				recs = append(recs, "VPA update mode is Off — recommendations are not applied.")
			}
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "VPA target and update policy look healthy.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleVPAEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	namespace := strArg(args, "namespace")
	name := strArg(args, "name")
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("observe_vpa_events: 'namespace' and 'name' are required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "VerticalPodAutoscaler", name, namespace, limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"namespace": namespace,
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// ─── observe_api_resources ────────────────────────────────────────────────────

func (s *mcpServerImpl) handleAPIResources(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	// Capabilities endpoint doesn't need a cluster ID.
	var caps map[string]interface{}
	if err := c.get(ctx, "/capabilities", &caps); err != nil {
		return nil, err
	}
	return caps, nil
}

// ─── observe_custom_resources ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleCustomResources(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	crdName := strArg(args, "crd_name")
	if crdName != "" {
		var instances map[string]interface{}
		if err := c.get(ctx, c.clusterPath(clusterID, "/crd-instances/"+url.PathEscape(crdName)), &instances); err != nil {
			return nil, err
		}
		return instances, nil
	}

	// List all CRDs.
	var crds map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/customresourcedefinitions"), &crds); err != nil {
		return nil, err
	}
	return crds, nil
}

// ─── CRDs: CustomResourceDefinitions ───────────────────────────────────────

func (s *mcpServerImpl) handleCRDDetailed(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_crd_detailed: 'name' is required")
	}
	var crd map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/customresourcedefinitions/-/"+url.PathEscape(name)), &crd); err != nil {
		if strings.Contains(err.Error(), "404") {
			return nil, fmt.Errorf("CustomResourceDefinition %q not found", name)
		}
		return nil, err
	}
	events, _ := s.fetchResourceEvents(ctx, c, clusterID, "CustomResourceDefinition", name, "-", 10)
	metadata, _ := crd["metadata"].(map[string]interface{})
	spec, _ := crd["spec"].(map[string]interface{})
	status, _ := crd["status"].(map[string]interface{})
	specData := summarizeCRDSpec(spec)
	statusData := summarizeCRDStatus(status)
	instancesCount := countCRDInstances(ctx, c, clusterID, name)
	relationships := map[string]interface{}{"instances_count": instancesCount}
	riskFlags, recommendations := analyzeCRDRiskFindings(status)
	return map[string]interface{}{
		"metadata":        metadata,
		"data":            map[string]interface{}{"spec": specData, "status": statusData},
		"events":          events,
		"relationships":  relationships,
		"risk_flags":      riskFlags,
		"recommendations": recommendations,
		"timestamp":       time.Now(),
	}, nil
}

func summarizeCRDSpec(spec map[string]interface{}) map[string]interface{} {
	if spec == nil {
		return nil
	}
	out := map[string]interface{}{
		"group":  spec["group"],
		"names":  spec["names"],
		"scope":  spec["scope"],
	}
	if v, ok := spec["versions"].([]interface{}); ok && len(v) > 0 {
		versionNames := make([]string, 0, len(v))
		for _, ver := range v {
			if vm, _ := ver.(map[string]interface{}); vm != nil {
				if n, _ := vm["name"].(string); n != "" {
					versionNames = append(versionNames, n)
				}
			}
		}
		out["version_names"] = versionNames
	}
	return out
}

func summarizeCRDStatus(status map[string]interface{}) map[string]interface{} {
	if status == nil {
		return nil
	}
	out := map[string]interface{}{
		"acceptedNames": status["acceptedNames"],
		"storedVersions": status["storedVersions"],
	}
	if c, ok := status["conditions"].([]interface{}); ok {
		out["conditions_count"] = len(c)
	}
	return out
}

func countCRDInstances(ctx context.Context, c *backendHTTP, clusterID, crdName string) int {
	var list map[string]interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/crd-instances/"+url.PathEscape(crdName)), &list); err != nil {
		return 0
	}
	items, _ := list["items"].([]interface{})
	return len(items)
}

func analyzeCRDRiskFindings(status map[string]interface{}) ([]string, []string) {
	var flags []string
	var recs []string
	if status != nil {
		conditions, _ := status["conditions"].([]interface{})
		established := false
		for _, co := range conditions {
			cm, _ := co.(map[string]interface{})
			if cm == nil {
				continue
			}
			if t, _ := cm["type"].(string); t == "Established" {
				if s, _ := cm["status"].(string); s == "True" {
					established = true
					break
				}
			}
		}
		if !established && len(conditions) > 0 {
			flags = append(flags, "CRD_NOT_ESTABLISHED")
			recs = append(recs, "CRD is not established — check status.conditions and fix schema or versions.")
		}
	}
	if len(flags) == 0 {
		recs = append(recs, "CRD status and spec reviewed.")
	}
	return flags, recs
}

func (s *mcpServerImpl) handleCRDEvents(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	name := strArg(args, "name")
	if name == "" {
		return nil, fmt.Errorf("observe_crd_events: 'name' is required")
	}
	limit := 10
	if n, ok := args["limit"].(float64); ok && n > 0 {
		limit = int(n)
	}
	events, err := s.fetchResourceEvents(ctx, c, clusterID, "CustomResourceDefinition", name, "-", limit)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"name":      name,
		"events":    events,
		"timestamp": time.Now(),
	}, nil
}

// fetchResourceEvents returns events for a specific resource (any kind). Shared by pod and workload event handlers.
func (s *mcpServerImpl) fetchResourceEvents(ctx context.Context, c *backendHTTP, clusterID, involvedObjectKind, involvedObjectName, namespace string, limit int) (interface{}, error) {
	q := url.Values{}
	q.Set("namespace", namespace)
	q.Set("limit", fmt.Sprint(limit))
	q.Set("involvedObjectKind", involvedObjectKind)
	q.Set("involvedObjectName", involvedObjectName)
	var events interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/events?"+q.Encode()), &events); err != nil {
		return nil, err
	}
	return events, nil
}

// ─── observe_resource_history ─────────────────────────────────────────────────

func (s *mcpServerImpl) handleResourceHistory(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	kind := strArg(args, "kind")
	name := strArg(args, "name")
	namespace := strArg(args, "namespace")

	if kind == "" || name == "" {
		return nil, fmt.Errorf("observe_resource_history: 'kind' and 'name' are required")
	}

	// Backend has rollout-history for Deployment only, not "history".
	if strings.EqualFold(kind, "Deployment") {
		var history map[string]interface{}
		path := c.clusterPath(clusterID, "/resources/deployments/"+url.PathEscape(namespace)+"/"+url.PathEscape(name)+"/rollout-history")
		if err := c.get(ctx, path, &history); err != nil {
			if strings.Contains(err.Error(), "404") {
				return nil, fmt.Errorf("Deployment %q not found in namespace %q", name, namespace)
			}
			return nil, err
		}
		return history, nil
	}

	// For other kinds, try generic history path (may 404).
	var history map[string]interface{}
	path := c.clusterPath(clusterID, fmt.Sprintf("/resources/%s/%s/%s/history",
		url.PathEscape(strings.ToLower(kind+"s")),
		url.PathEscape(namespace),
		url.PathEscape(name)))
	if err := c.get(ctx, path, &history); err != nil {
		return s.handleObserveResource(ctx, args)
	}
	return history, nil
}

// ─── export_topology_to_drawio ────────────────────────────────────────────────

func (s *mcpServerImpl) handleExportTopologyToDrawio(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}

	drawioURL := c.baseURL + "/api/v1/clusters/" + url.PathEscape(clusterID) + "/topology/export/drawio?format=mermaid"
	req, err := newHTTPRequest(ctx, "GET", drawioURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get draw.io export: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("draw.io export failed (HTTP %d)", resp.StatusCode)
	}

	var result struct {
		URL     string `json:"url"`
		Mermaid string `json:"mermaid,omitempty"`
	}
	// Decode using json
	buf := make([]byte, 64*1024)
	n, _ := resp.Body.Read(buf)
	if err := jsonUnmarshal(buf[:n], &result); err != nil {
		return nil, fmt.Errorf("failed to decode draw.io response: %w", err)
	}
	return map[string]interface{}{
		"url":     result.URL,
		"message": "Open this URL in a browser to view and edit the architecture diagram in draw.io",
		"mermaid": result.Mermaid,
	}, nil
}

// ─── Updated createObservationHandler ─────────────────────────────────────────

// newObservationHandler replaces the stub createObservationHandler in server.go.
// It is called from registerAllTools via createObservationHandler.
func (s *mcpServerImpl) routeObservationTool(ctx context.Context, name string, args map[string]interface{}) (interface{}, error) {
	switch name {
	// Chat tool names (pod-first subset) — route to same handlers as taxonomy observe_* tools.
	case "list_resources":
		return s.handleResourcesByQuery(ctx, args)
	case "get_resource":
		return s.handleObserveResource(ctx, args)
	case "get_logs":
		return s.handlePodLogs(ctx, args)
	case "get_events":
		return s.handleEvents(ctx, args)
	case "get_cluster_health":
		return s.handleClusterOverview(ctx, args)
	case "observe_cluster_overview":
		return s.handleClusterOverview(ctx, args)
	case "observe_resource":
		return s.handleObserveResource(ctx, args)
	case "observe_resources_by_query":
		return s.handleResourcesByQuery(ctx, args)
	case "observe_pod_logs":
		return s.handlePodLogs(ctx, args)
	case "observe_pod_detailed":
		return s.handlePodDetailed(ctx, args)
	case "observe_pod_dependencies":
		return s.handlePodDependencies(ctx, args)
	case "observe_resource_links":
		return s.handleResourceLinks(ctx, args)
	case "observe_events":
		return s.handleEvents(ctx, args)
	case "observe_pod_events":
		return s.handlePodEvents(ctx, args)
	case "observe_pod_logs_filtered":
		return s.handlePodLogs(ctx, args)
	case "observe_pod_ownership_chain":
		return s.handlePodOwnershipChain(ctx, args)
	case "observe_resource_topology":
		return s.handleResourceTopology(ctx, args)
	case "observe_resource_history":
		return s.handleResourceHistory(ctx, args)
	case "export_topology_to_drawio":
		return s.handleExportTopologyToDrawio(ctx, args)
	case "observe_metrics":
		return s.handleMetrics(ctx, args)
	case "observe_node_detailed":
		return s.handleNodeDetailed(ctx, args)
	case "observe_node_events":
		return s.handleNodeEvents(ctx, args)
	case "observe_node_status":
		return s.handleNodeStatus(ctx, args)
	case "observe_namespace_detailed":
		return s.handleNamespaceDetailed(ctx, args)
	case "observe_namespace_events":
		return s.handleNamespaceEvents(ctx, args)
	case "observe_namespace_overview":
		return s.handleNamespaceOverview(ctx, args)
	case "observe_workload_health":
		return s.handleWorkloadHealth(ctx, args)
	case "observe_deployment_rollout_history":
		return s.handleDeploymentRolloutHistory(ctx, args)
	case "observe_deployment_events":
		return s.handleDeploymentEvents(ctx, args)
	case "observe_deployment_ownership_chain":
		return s.handleDeploymentOwnershipChain(ctx, args)
	case "observe_deployment_detailed":
		return s.handleDeploymentDetailed(ctx, args)
	case "observe_replicaset_detailed":
		return s.handleReplicaSetDetailed(ctx, args)
	case "observe_replicaset_events":
		return s.handleReplicaSetEvents(ctx, args)
	case "observe_replicaset_ownership_chain":
		return s.handleReplicaSetOwnershipChain(ctx, args)
	case "observe_statefulset_detailed":
		return s.handleStatefulSetDetailed(ctx, args)
	case "observe_statefulset_events":
		return s.handleStatefulSetEvents(ctx, args)
	case "observe_statefulset_ownership_chain":
		return s.handleStatefulSetOwnershipChain(ctx, args)
	case "observe_daemonset_detailed":
		return s.handleDaemonSetDetailed(ctx, args)
	case "observe_daemonset_events":
		return s.handleDaemonSetEvents(ctx, args)
	case "observe_daemonset_ownership_chain":
		return s.handleDaemonSetOwnershipChain(ctx, args)
	case "observe_job_detailed":
		return s.handleJobDetailed(ctx, args)
	case "observe_job_events":
		return s.handleJobEvents(ctx, args)
	case "observe_job_ownership_chain":
		return s.handleJobOwnershipChain(ctx, args)
	case "observe_cronjob_detailed":
		return s.handleCronJobDetailed(ctx, args)
	case "observe_cronjob_events":
		return s.handleCronJobEvents(ctx, args)
	case "observe_cronjob_ownership_chain":
		return s.handleCronJobOwnershipChain(ctx, args)
	case "observe_service_detailed":
		return s.handleServiceDetailed(ctx, args)
	case "observe_service_events":
		return s.handleServiceEvents(ctx, args)
	case "observe_service_endpoints":
		return s.handleServiceEndpoints(ctx, args)
	case "observe_ingress_detailed":
		return s.handleIngressDetailed(ctx, args)
	case "observe_ingress_events":
		return s.handleIngressEvents(ctx, args)
	case "observe_networkpolicy_detailed":
		return s.handleNetworkPolicyDetailed(ctx, args)
	case "observe_networkpolicy_events":
		return s.handleNetworkPolicyEvents(ctx, args)
	case "observe_network_policies":
		return s.handleNetworkPolicies(ctx, args)
	case "observe_pvc_detailed":
		return s.handlePvcDetailed(ctx, args)
	case "observe_pvc_events":
		return s.handlePvcEvents(ctx, args)
	case "observe_pvc_consumers":
		return s.handlePvcConsumers(ctx, args)
	case "observe_pv_detailed":
		return s.handlePvDetailed(ctx, args)
	case "observe_pv_events":
		return s.handlePvEvents(ctx, args)
	case "observe_storageclass_detailed":
		return s.handleStorageClassDetailed(ctx, args)
	case "observe_storageclass_events":
		return s.handleStorageClassEvents(ctx, args)
	case "observe_storage_status":
		return s.handleStorageStatus(ctx, args)
	case "observe_serviceaccount_detailed":
		return s.handleServiceAccountDetailed(ctx, args)
	case "observe_serviceaccount_events":
		return s.handleServiceAccountEvents(ctx, args)
	case "observe_serviceaccount_permissions":
		return s.handleServiceAccountPermissions(ctx, args)
	case "observe_role_detailed":
		return s.handleRoleDetailed(ctx, args)
	case "observe_role_events":
		return s.handleRoleEvents(ctx, args)
	case "observe_rolebinding_detailed":
		return s.handleRoleBindingDetailed(ctx, args)
	case "observe_rolebinding_events":
		return s.handleRoleBindingEvents(ctx, args)
	case "observe_clusterrole_detailed":
		return s.handleClusterRoleDetailed(ctx, args)
	case "observe_clusterrole_events":
		return s.handleClusterRoleEvents(ctx, args)
	case "observe_clusterrolebinding_detailed":
		return s.handleClusterRoleBindingDetailed(ctx, args)
	case "observe_clusterrolebinding_events":
		return s.handleClusterRoleBindingEvents(ctx, args)
	case "observe_secret_detailed":
		return s.handleSecretDetailed(ctx, args)
	case "observe_secret_events":
		return s.handleSecretEvents(ctx, args)
	case "observe_secret_consumers":
		return s.handleSecretConsumers(ctx, args)
	case "observe_configmap_detailed":
		return s.handleConfigMapDetailed(ctx, args)
	case "observe_configmap_events":
		return s.handleConfigMapEvents(ctx, args)
	case "observe_configmap_consumers":
		return s.handleConfigMapConsumers(ctx, args)
	case "observe_limitrange_detailed":
		return s.handleLimitRangeDetailed(ctx, args)
	case "observe_limitrange_events":
		return s.handleLimitRangeEvents(ctx, args)
	case "observe_resourcequota_detailed":
		return s.handleResourceQuotaDetailed(ctx, args)
	case "observe_resourcequota_events":
		return s.handleResourceQuotaEvents(ctx, args)
	case "observe_hpa_detailed":
		return s.handleHPADetailed(ctx, args)
	case "observe_hpa_events":
		return s.handleHPAEvents(ctx, args)
	case "observe_pdb_detailed":
		return s.handlePDBDetailed(ctx, args)
	case "observe_pdb_events":
		return s.handlePDBEvents(ctx, args)
	case "observe_vpa_detailed":
		return s.handleVPADetailed(ctx, args)
	case "observe_vpa_events":
		return s.handleVPAEvents(ctx, args)
	case "observe_crd_detailed":
		return s.handleCRDDetailed(ctx, args)
	case "observe_crd_events":
		return s.handleCRDEvents(ctx, args)
	case "observe_api_resources":
		return s.handleAPIResources(ctx, args)
	case "observe_custom_resources":
		return s.handleCustomResources(ctx, args)
	default:
		return nil, fmt.Errorf("observation tool not implemented: %s", name)
	}
}
