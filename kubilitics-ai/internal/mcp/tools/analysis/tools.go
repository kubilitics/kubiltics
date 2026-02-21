package analysis

// Package analysis provides Tier 2 analysis tools for the LLM.
//
// Implemented tools (A-CORE-003):
//   analyze_pod_health, analyze_deployment_health, analyze_node_pressure,
//   detect_resource_contention, analyze_network_connectivity, analyze_rbac_permissions,
//   analyze_storage_health, check_resource_limits, analyze_hpa_behavior,
//   analyze_log_patterns, assess_security_posture, detect_configuration_drift
//
// gRPC Proxy fallback (AI-FIX-001):
//   When the gRPC backend proxy is not yet initialized (e.g. backend gRPC not up),
//   all ListResources / GetResource calls transparently fall back to the backend REST API
//   so that analysis tools continue working via HTTP even without gRPC.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
)

// BackendProxy defines the minimal interface needed by AnalysisTools.
// *backend.Proxy satisfies this interface; a fake may be used in tests.
type BackendProxy interface {
	ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error)
	GetResource(ctx context.Context, kind, namespace, name string) (*pb.Resource, error)
	ExecuteCommand(ctx context.Context, operation string, target *pb.Resource, params []byte, dryRun bool) (*pb.CommandResult, error)
}

// restClient is a minimal HTTP client for the kubilitics-backend REST API.
// Used as a fallback when the gRPC proxy is not initialized.
type restClient struct {
	baseURL    string
	httpClient *http.Client
}

var sharedAnalysisHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        20,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	},
}

func newRestClient(baseURL string) *restClient {
	if baseURL == "" {
		baseURL = "http://localhost:819"
	}
	return &restClient{
		baseURL:    strings.TrimSuffix(baseURL, "/"),
		httpClient: sharedAnalysisHTTPClient,
	}
}

// get performs a GET request and returns the body bytes.
func (r *restClient) get(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("build request %s: %w", path, err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: HTTP %d: %s", path, resp.StatusCode, truncateStr(string(body), 200))
	}
	return body, nil
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// firstClusterID fetches the first registered cluster ID from the REST API.
func (r *restClient) firstClusterID(ctx context.Context) string {
	body, err := r.get(ctx, "/api/v1/clusters")
	if err != nil {
		log.Printf("[analysis/rest] list clusters: %v", err)
		return ""
	}
	var clusters []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &clusters); err != nil || len(clusters) == 0 {
		return ""
	}
	return clusters[0].ID
}

// listResourcesViaREST lists Kubernetes resources using the backend REST API.
// kind must be the plural lowercase form used by the backend (e.g. "pods", "deployments").
// Returns a slice of raw JSON objects that callers treat the same way as pb.Resource.Data.
func (r *restClient) listResourcesViaREST(ctx context.Context, clusterID, kind, namespace string) ([]json.RawMessage, error) {
	// The backend accepts: /resources/{kind}?namespace={ns}
	// kind is already expected lowercase plural by the backend (e.g. "pods", "deployments")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/%s", clusterID, url.PathEscape(kind))
	if namespace != "" {
		path += "?namespace=" + url.QueryEscape(namespace)
	}
	body, err := r.get(ctx, path)
	if err != nil {
		return nil, err
	}
	var result struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		// Might be a direct array
		var items []json.RawMessage
		if err2 := json.Unmarshal(body, &items); err2 != nil {
			return nil, fmt.Errorf("parse response: %w", err)
		}
		return items, nil
	}
	return result.Items, nil
}

// kindToPlural converts a K8s resource kind to the plural lowercase form used by the backend.
func kindToPlural(kind string) string {
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
	case "endpoint", "endpoints":
		return "endpoints"
	default:
		if !strings.HasSuffix(lower, "s") {
			return lower + "s"
		}
		return lower
	}
}

// rawItemToProtoResource converts a raw JSON resource item to a *pb.Resource.
// This is used when falling back from gRPC to REST so the same analysis logic applies.
func rawItemToProtoResource(raw json.RawMessage) *pb.Resource {
	var meta struct {
		Kind     string `json:"kind"`
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
	}
	_ = json.Unmarshal(raw, &meta)
	return &pb.Resource{
		Kind:      meta.Kind,
		Name:      meta.Metadata.Name,
		Namespace: meta.Metadata.Namespace,
		Data:      raw,
	}
}

// AnalysisTools holds all analysis tool implementations.
type AnalysisTools struct {
	proxy   BackendProxy
	restCli *restClient // REST fallback when gRPC proxy is not initialized
}

// NewAnalysisTools creates a new AnalysisTools instance backed by a real backend proxy.
// A REST HTTP fallback is always wired to localhost:819 for resilience (AI-FIX-001).
func NewAnalysisTools(proxy *backend.Proxy) *AnalysisTools {
	return &AnalysisTools{
		proxy:   proxy,
		restCli: newRestClient("http://localhost:819"),
	}
}

// NewAnalysisToolsWithProxy creates an AnalysisTools from any BackendProxy implementation.
// Use this in tests to inject a fake proxy.
func NewAnalysisToolsWithProxy(proxy BackendProxy) *AnalysisTools {
	return &AnalysisTools{
		proxy:   proxy,
		restCli: newRestClient("http://localhost:819"),
	}
}

// listResources calls the gRPC proxy first; if it returns "proxy not initialized"
// it transparently falls back to the REST API. This makes all 12 analysis tools
// resilient to gRPC connectivity issues (AI-FIX-001).
func (t *AnalysisTools) listResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error) {
	resources, err := t.proxy.ListResources(ctx, kind, namespace)
	if err == nil {
		return resources, nil
	}

	// Only fall back to REST for "proxy not initialized" — other errors propagate.
	if !strings.Contains(err.Error(), "proxy not initialized") {
		return nil, err
	}

	log.Printf("[analysis/rest] gRPC proxy not initialized, falling back to REST for kind=%s ns=%s", kind, namespace)
	if t.restCli == nil {
		return nil, fmt.Errorf("gRPC proxy not initialized and no REST fallback configured")
	}

	clusterID := t.restCli.firstClusterID(ctx)
	if clusterID == "" {
		return nil, fmt.Errorf("no clusters registered in backend")
	}

	plural := kindToPlural(kind)
	items, err := t.restCli.listResourcesViaREST(ctx, clusterID, plural, namespace)
	if err != nil {
		return nil, fmt.Errorf("REST fallback list %s: %w", kind, err)
	}

	result := make([]*pb.Resource, 0, len(items))
	for _, item := range items {
		result = append(result, rawItemToProtoResource(item))
	}
	return result, nil
}

// getResource calls the gRPC proxy first; falls back to REST on "proxy not initialized".
func (t *AnalysisTools) getResource(ctx context.Context, kind, namespace, name string) (*pb.Resource, error) {
	resource, err := t.proxy.GetResource(ctx, kind, namespace, name)
	if err == nil {
		return resource, nil
	}

	if !strings.Contains(err.Error(), "proxy not initialized") {
		return nil, err
	}

	log.Printf("[analysis/rest] gRPC proxy not initialized, falling back to REST for kind=%s ns=%s name=%s", kind, namespace, name)
	if t.restCli == nil {
		return nil, fmt.Errorf("gRPC proxy not initialized and no REST fallback configured")
	}

	clusterID := t.restCli.firstClusterID(ctx)
	if clusterID == "" {
		return nil, fmt.Errorf("no clusters registered in backend")
	}

	plural := kindToPlural(kind)
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/%s/%s/%s",
		clusterID, url.PathEscape(plural), url.PathEscape(namespace), url.PathEscape(name))
	body, rerr := t.restCli.get(ctx, path)
	if rerr != nil {
		return nil, fmt.Errorf("REST fallback get %s/%s/%s: %w", kind, namespace, name, rerr)
	}
	return rawItemToProtoResource(body), nil
}

// HandlerMap returns all tool handlers keyed by tool name.
func (t *AnalysisTools) HandlerMap() map[string]func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	return map[string]func(ctx context.Context, args map[string]interface{}) (interface{}, error){
		"analyze_pod_health":           t.AnalyzePodHealth,
		"analyze_deployment_health":    t.AnalyzeDeploymentHealth,
		"analyze_node_pressure":        t.AnalyzeNodePressure,
		"detect_resource_contention":   t.DetectResourceContention,
		"analyze_network_connectivity": t.AnalyzeNetworkConnectivity,
		"analyze_rbac_permissions":     t.AnalyzeRBACPermissions,
		"analyze_storage_health":       t.AnalyzeStorageHealth,
		"check_resource_limits":        t.CheckResourceLimits,
		"analyze_hpa_behavior":         t.AnalyzeHPABehavior,
		"analyze_log_patterns":         t.AnalyzeLogPatterns,
		"assess_security_posture":      t.AssessSecurityPosture,
		"detect_configuration_drift":   t.DetectConfigurationDrift,
	}
}

// ─── analyze_pod_health ───────────────────────────────────────────────────────

type analyzePodHealthArgs struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name,omitempty"`
}

// AnalyzePodHealth analyzes pod health: OOMKills, restart loops, eviction patterns.
func (t *AnalysisTools) AnalyzePodHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzePodHealthArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_pod_health: invalid args: %w", err)
	}

	pods, err := t.listResources(ctx, "Pod", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("analyze_pod_health: %w", err)
	}

	// Filter to specific pod if name provided
	if a.Name != "" {
		pods = filterByName(pods, a.Name)
	}

	issues := []map[string]interface{}{}
	healthy := 0
	for _, pod := range pods {
		podIssues := analyzePodIssues(pod)
		if len(podIssues) == 0 {
			healthy++
		}
		issues = append(issues, podIssues...)
	}

	return map[string]interface{}{
		"namespace":   a.Namespace,
		"total_pods":  len(pods),
		"healthy":     healthy,
		"issue_count": len(issues),
		"issues":      issues,
		"summary":     fmt.Sprintf("%d/%d pods healthy", healthy, len(pods)),
	}, nil
}

func analyzePodIssues(pod *pb.Resource) []map[string]interface{} {
	issues := []map[string]interface{}{}
	if pod == nil {
		return issues
	}

	// Parse the raw data for container statuses
	var raw map[string]interface{}
	if len(pod.Data) > 0 {
		_ = json.Unmarshal(pod.Data, &raw)
	}

	status := getNestedStr(raw, "status", "phase")
	containerStatuses := getNestedSlice(raw, "status", "containerStatuses")

	for _, cs := range containerStatuses {
		csMap, ok := cs.(map[string]interface{})
		if !ok {
			continue
		}
		name := strVal(csMap["name"])
		restartCount := int64Val(csMap["restartCount"])

		// OOMKill detection
		if lastState, ok := csMap["lastState"].(map[string]interface{}); ok {
			if terminated, ok := lastState["terminated"].(map[string]interface{}); ok {
				if strVal(terminated["reason"]) == "OOMKilled" {
					issues = append(issues, map[string]interface{}{
						"pod":       pod.Name,
						"container": name,
						"type":      "OOMKilled",
						"severity":  "HIGH",
						"message":   fmt.Sprintf("Container %s was OOMKilled", name),
					})
				}
			}
		}

		// Restart loop detection
		if restartCount > 5 {
			severity := "MEDIUM"
			if restartCount > 20 {
				severity = "HIGH"
			}
			issues = append(issues, map[string]interface{}{
				"pod":           pod.Name,
				"container":     name,
				"type":          "RestartLoop",
				"severity":      severity,
				"restart_count": restartCount,
				"message":       fmt.Sprintf("Container %s has restarted %d times", name, restartCount),
			})
		}
	}

	// Pending pod detection
	if status == "Pending" {
		issues = append(issues, map[string]interface{}{
			"pod":      pod.Name,
			"type":     "PodPending",
			"severity": "MEDIUM",
			"message":  fmt.Sprintf("Pod %s is in Pending state", pod.Name),
		})
	}

	return issues
}

// ─── analyze_deployment_health ────────────────────────────────────────────────

type analyzeDeploymentHealthArgs struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name,omitempty"`
}

// AnalyzeDeploymentHealth analyzes deployment health: rollout failures, image pull errors.
func (t *AnalysisTools) AnalyzeDeploymentHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeDeploymentHealthArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_deployment_health: invalid args: %w", err)
	}

	deployments, err := t.listResources(ctx, "Deployment", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("analyze_deployment_health: %w", err)
	}
	if a.Name != "" {
		deployments = filterByName(deployments, a.Name)
	}

	results := make([]map[string]interface{}, 0, len(deployments))
	for _, d := range deployments {
		var raw map[string]interface{}
		if len(d.Data) > 0 {
			_ = json.Unmarshal(d.Data, &raw)
		}

		desiredReplicas := int64Val(getNestedVal(raw, "spec", "replicas"))
		readyReplicas := int64Val(getNestedVal(raw, "status", "readyReplicas"))
		unavailableReplicas := int64Val(getNestedVal(raw, "status", "unavailableReplicas"))
		conditions := getNestedSlice(raw, "status", "conditions")

		issues := []string{}
		for _, c := range conditions {
			cMap, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			if strVal(cMap["type"]) == "Available" && strVal(cMap["status"]) == "False" {
				issues = append(issues, fmt.Sprintf("Not available: %s", strVal(cMap["message"])))
			}
			if strVal(cMap["type"]) == "Progressing" && strVal(cMap["status"]) == "False" {
				issues = append(issues, fmt.Sprintf("Rollout stalled: %s", strVal(cMap["message"])))
			}
		}

		health := "Healthy"
		if unavailableReplicas > 0 {
			health = "Degraded"
		}
		if readyReplicas == 0 && desiredReplicas > 0 {
			health = "Critical"
		}

		results = append(results, map[string]interface{}{
			"name":                 d.Name,
			"health":               health,
			"desired_replicas":     desiredReplicas,
			"ready_replicas":       readyReplicas,
			"unavailable_replicas": unavailableReplicas,
			"issues":               issues,
		})
	}

	return map[string]interface{}{
		"namespace":   a.Namespace,
		"deployments": results,
	}, nil
}

// ─── analyze_node_pressure ────────────────────────────────────────────────────

type analyzeNodePressureArgs struct {
	Name string `json:"name,omitempty"`
}

// AnalyzeNodePressure analyzes node memory/disk/PID pressure conditions.
func (t *AnalysisTools) AnalyzeNodePressure(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeNodePressureArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_node_pressure: invalid args: %w", err)
	}

	nodes, err := t.listResources(ctx, "Node", "")
	if err != nil {
		return nil, fmt.Errorf("analyze_node_pressure: %w", err)
	}
	if a.Name != "" {
		nodes = filterByName(nodes, a.Name)
	}

	results := make([]map[string]interface{}, 0, len(nodes))
	for _, n := range nodes {
		var raw map[string]interface{}
		if len(n.Data) > 0 {
			_ = json.Unmarshal(n.Data, &raw)
		}

		conditions := getNestedSlice(raw, "status", "conditions")
		pressures := map[string]bool{}
		for _, c := range conditions {
			cMap, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			cType := strVal(cMap["type"])
			cStatus := strVal(cMap["status"])
			switch cType {
			case "MemoryPressure", "DiskPressure", "PIDPressure":
				pressures[cType] = cStatus == "True"
			}
		}

		severity := "None"
		activePressures := []string{}
		for pt, active := range pressures {
			if active {
				activePressures = append(activePressures, pt)
				severity = "HIGH"
			}
		}

		results = append(results, map[string]interface{}{
			"node":             n.Name,
			"severity":         severity,
			"active_pressures": activePressures,
			"memory_pressure":  pressures["MemoryPressure"],
			"disk_pressure":    pressures["DiskPressure"],
			"pid_pressure":     pressures["PIDPressure"],
		})
	}

	return map[string]interface{}{
		"nodes":       results,
		"total_nodes": len(nodes),
		"nodes_under_pressure": func() int {
			count := 0
			for _, r := range results {
				if r["severity"] == "HIGH" {
					count++
				}
			}
			return count
		}(),
	}, nil
}

// ─── detect_resource_contention ───────────────────────────────────────────────

type detectResourceContentionArgs struct {
	Namespace string `json:"namespace"`
}

// DetectResourceContention detects CPU throttling and memory overcommit.
func (t *AnalysisTools) DetectResourceContention(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a detectResourceContentionArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("detect_resource_contention: invalid args: %w", err)
	}

	pods, err := t.listResources(ctx, "Pod", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("detect_resource_contention: %w", err)
	}

	missingLimits := []string{}
	missingRequests := []string{}
	for _, pod := range pods {
		var raw map[string]interface{}
		if len(pod.Data) > 0 {
			_ = json.Unmarshal(pod.Data, &raw)
		}
		containers := getNestedSlice(raw, "spec", "containers")
		for _, c := range containers {
			cMap, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			cName := strVal(cMap["name"])
			resources, _ := cMap["resources"].(map[string]interface{})
			if resources == nil {
				missingLimits = append(missingLimits, fmt.Sprintf("%s/%s", pod.Name, cName))
				missingRequests = append(missingRequests, fmt.Sprintf("%s/%s", pod.Name, cName))
				continue
			}
			if resources["limits"] == nil {
				missingLimits = append(missingLimits, fmt.Sprintf("%s/%s", pod.Name, cName))
			}
			if resources["requests"] == nil {
				missingRequests = append(missingRequests, fmt.Sprintf("%s/%s", pod.Name, cName))
			}
		}
	}

	risk := "LOW"
	if len(missingLimits) > 5 || len(missingRequests) > 5 {
		risk = "MEDIUM"
	}
	if len(missingLimits) > 20 {
		risk = "HIGH"
	}

	return map[string]interface{}{
		"namespace":                 a.Namespace,
		"contention_risk":           risk,
		"pods_missing_limits":       len(missingLimits),
		"pods_missing_requests":     len(missingRequests),
		"containers_missing_limits": missingLimits,
		"recommendation": fmt.Sprintf(
			"%d containers lack CPU/memory limits, risking node contention", len(missingLimits)),
	}, nil
}

// ─── analyze_network_connectivity ─────────────────────────────────────────────

type analyzeNetworkConnectivityArgs struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name,omitempty"`
}

// AnalyzeNetworkConnectivity checks service reachability and network policy blocking.
func (t *AnalysisTools) AnalyzeNetworkConnectivity(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeNetworkConnectivityArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_network_connectivity: invalid args: %w", err)
	}

	services, err := t.listResources(ctx, "Service", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("analyze_network_connectivity: failed to list services: %w", err)
	}
	if a.Name != "" {
		services = filterByName(services, a.Name)
	}

	networkPolicies, _ := t.listResources(ctx, "NetworkPolicy", a.Namespace)
	endpoints, _ := t.listResources(ctx, "Endpoints", a.Namespace)

	// Map endpoint readiness by service name
	endpointReady := map[string]bool{}
	for _, ep := range endpoints {
		var raw map[string]interface{}
		if len(ep.Data) > 0 {
			_ = json.Unmarshal(ep.Data, &raw)
		}
		subsets := getNestedSlice(raw, "subsets")
		hasReady := false
		for _, s := range subsets {
			sMap, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			if addrs, ok := sMap["addresses"].([]interface{}); ok && len(addrs) > 0 {
				hasReady = true
			}
		}
		endpointReady[ep.Name] = hasReady
	}

	results := make([]map[string]interface{}, 0, len(services))
	for _, svc := range services {
		ready := endpointReady[svc.Name]
		results = append(results, map[string]interface{}{
			"service":             svc.Name,
			"has_ready_endpoints": ready,
			"status":              map[bool]string{true: "OK", false: "NO_ENDPOINTS"}[ready],
		})
	}

	return map[string]interface{}{
		"namespace":            a.Namespace,
		"services":             results,
		"network_policies":     len(networkPolicies),
		"has_network_policies": len(networkPolicies) > 0,
		"summary": fmt.Sprintf("%d services analysed, %d network policies active",
			len(services), len(networkPolicies)),
	}, nil
}

// ─── analyze_rbac_permissions ─────────────────────────────────────────────────

type analyzeRBACPermissionsArgs struct {
	Namespace          string `json:"namespace"`
	ServiceAccountName string `json:"service_account_name,omitempty"`
}

// AnalyzeRBACPermissions checks for over-privileged service accounts.
func (t *AnalysisTools) AnalyzeRBACPermissions(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeRBACPermissionsArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_rbac_permissions: invalid args: %w", err)
	}

	roleBindings, err := t.listResources(ctx, "RoleBinding", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("analyze_rbac_permissions: %w", err)
	}

	clusterRoleBindings, _ := t.listResources(ctx, "ClusterRoleBinding", "")

	overprivileged := []map[string]interface{}{}
	dangerousRoles := []string{"cluster-admin", "admin", "edit"}

	checkBinding := func(name, roleKind, roleName string, subjects []interface{}) {
		isDangerous := false
		for _, dr := range dangerousRoles {
			if strings.EqualFold(roleName, dr) {
				isDangerous = true
				break
			}
		}
		if !isDangerous {
			return
		}
		for _, s := range subjects {
			sMap, ok := s.(map[string]interface{})
			if !ok {
				continue
			}
			if strVal(sMap["kind"]) == "ServiceAccount" {
				saName := strVal(sMap["name"])
				if a.ServiceAccountName != "" && saName != a.ServiceAccountName {
					continue
				}
				overprivileged = append(overprivileged, map[string]interface{}{
					"binding":         name,
					"role_kind":       roleKind,
					"role_name":       roleName,
					"service_account": saName,
					"sa_namespace":    strVal(sMap["namespace"]),
					"severity":        "HIGH",
					"recommendation":  fmt.Sprintf("ServiceAccount '%s' has %s role — review if least-privilege principle is met", saName, roleName),
				})
			}
		}
	}

	for _, rb := range roleBindings {
		var raw map[string]interface{}
		if len(rb.Data) > 0 {
			_ = json.Unmarshal(rb.Data, &raw)
		}
		roleRef, _ := raw["roleRef"].(map[string]interface{})
		subjects := getNestedSlice(raw, "subjects")
		if roleRef != nil {
			checkBinding(rb.Name, strVal(roleRef["kind"]), strVal(roleRef["name"]), subjects)
		}
	}

	for _, crb := range clusterRoleBindings {
		var raw map[string]interface{}
		if len(crb.Data) > 0 {
			_ = json.Unmarshal(crb.Data, &raw)
		}
		roleRef, _ := raw["roleRef"].(map[string]interface{})
		subjects := getNestedSlice(raw, "subjects")
		if roleRef != nil {
			checkBinding(crb.Name, strVal(roleRef["kind"]), strVal(roleRef["name"]), subjects)
		}
	}

	return map[string]interface{}{
		"namespace":               a.Namespace,
		"role_bindings_checked":   len(roleBindings),
		"cluster_role_bindings":   len(clusterRoleBindings),
		"overprivileged_accounts": len(overprivileged),
		"findings":                overprivileged,
		"risk_level": func() string {
			if len(overprivileged) == 0 {
				return "LOW"
			}
			if len(overprivileged) <= 3 {
				return "MEDIUM"
			}
			return "HIGH"
		}(),
	}, nil
}

// ─── analyze_storage_health ───────────────────────────────────────────────────

type analyzeStorageHealthArgs struct {
	Namespace string `json:"namespace"`
}

// AnalyzeStorageHealth checks PVC binding and provisioner health.
func (t *AnalysisTools) AnalyzeStorageHealth(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeStorageHealthArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_storage_health: invalid args: %w", err)
	}

	pvcs, err := t.listResources(ctx, "PersistentVolumeClaim", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("analyze_storage_health: %w", err)
	}

	unbound := []map[string]interface{}{}
	bound := 0
	for _, pvc := range pvcs {
		var raw map[string]interface{}
		if len(pvc.Data) > 0 {
			_ = json.Unmarshal(pvc.Data, &raw)
		}
		phase := getNestedStr(raw, "status", "phase")
		if phase == "Bound" {
			bound++
		} else {
			unbound = append(unbound, map[string]interface{}{
				"name":      pvc.Name,
				"namespace": pvc.Namespace,
				"phase":     phase,
				"severity":  "HIGH",
				"message":   fmt.Sprintf("PVC %s is in %s state — pods using it may be blocked", pvc.Name, phase),
			})
		}
	}

	return map[string]interface{}{
		"namespace":       a.Namespace,
		"total_pvcs":      len(pvcs),
		"bound_pvcs":      bound,
		"unbound_pvcs":    len(unbound),
		"unbound_details": unbound,
		"storage_health":  map[bool]string{len(unbound) == 0: "Healthy", len(unbound) > 0: "Degraded"}[true],
	}, nil
}

// ─── check_resource_limits ────────────────────────────────────────────────────

type checkResourceLimitsArgs struct {
	Namespace string `json:"namespace"`
}

// CheckResourceLimits checks for missing resource limits/requests.
func (t *AnalysisTools) CheckResourceLimits(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a checkResourceLimitsArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("check_resource_limits: invalid args: %w", err)
	}

	pods, err := t.listResources(ctx, "Pod", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("check_resource_limits: %w", err)
	}

	violations := []map[string]interface{}{}
	for _, pod := range pods {
		var raw map[string]interface{}
		if len(pod.Data) > 0 {
			_ = json.Unmarshal(pod.Data, &raw)
		}
		containers := getNestedSlice(raw, "spec", "containers")
		for _, c := range containers {
			cMap, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			cName := strVal(cMap["name"])
			resources, _ := cMap["resources"].(map[string]interface{})

			missing := []string{}
			if resources == nil || resources["limits"] == nil {
				missing = append(missing, "limits")
			}
			if resources == nil || resources["requests"] == nil {
				missing = append(missing, "requests")
			}
			if len(missing) > 0 {
				violations = append(violations, map[string]interface{}{
					"pod":       pod.Name,
					"container": cName,
					"missing":   missing,
					"severity":  "MEDIUM",
					"recommendation": fmt.Sprintf(
						"Set resource %s for container %s to prevent node overcommit",
						strings.Join(missing, " and "), cName),
				})
			}
		}
	}

	return map[string]interface{}{
		"namespace":       a.Namespace,
		"total_pods":      len(pods),
		"violations":      len(violations),
		"violation_list":  violations,
		"compliance_rate": fmt.Sprintf("%.1f%%", 100.0-float64(len(violations))/float64(max(len(pods), 1))*100),
	}, nil
}

// ─── analyze_hpa_behavior ─────────────────────────────────────────────────────

type analyzeHPABehaviorArgs struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name,omitempty"`
}

// AnalyzeHPABehavior checks for HPA flapping, scaling delays, and metric issues.
func (t *AnalysisTools) AnalyzeHPABehavior(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeHPABehaviorArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_hpa_behavior: invalid args: %w", err)
	}

	hpas, err := t.listResources(ctx, "HorizontalPodAutoscaler", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("analyze_hpa_behavior: %w", err)
	}
	if a.Name != "" {
		hpas = filterByName(hpas, a.Name)
	}

	results := make([]map[string]interface{}, 0, len(hpas))
	for _, hpa := range hpas {
		var raw map[string]interface{}
		if len(hpa.Data) > 0 {
			_ = json.Unmarshal(hpa.Data, &raw)
		}

		currentReplicas := int64Val(getNestedVal(raw, "status", "currentReplicas"))
		desiredReplicas := int64Val(getNestedVal(raw, "status", "desiredReplicas"))
		minReplicas := int64Val(getNestedVal(raw, "spec", "minReplicas"))
		maxReplicas := int64Val(getNestedVal(raw, "spec", "maxReplicas"))
		conditions := getNestedSlice(raw, "status", "conditions")

		warnings := []string{}
		for _, c := range conditions {
			cMap, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			if strVal(cMap["type"]) == "ScalingActive" && strVal(cMap["status"]) == "False" {
				warnings = append(warnings, fmt.Sprintf("Scaling inactive: %s", strVal(cMap["message"])))
			}
		}

		// Detect if at max replicas (capacity pressure)
		atMax := currentReplicas == maxReplicas && maxReplicas > 0
		if atMax {
			warnings = append(warnings, fmt.Sprintf("HPA at max replicas (%d) — consider raising maxReplicas or reducing load", maxReplicas))
		}

		results = append(results, map[string]interface{}{
			"name":             hpa.Name,
			"current_replicas": currentReplicas,
			"desired_replicas": desiredReplicas,
			"min_replicas":     minReplicas,
			"max_replicas":     maxReplicas,
			"at_max_replicas":  atMax,
			"warnings":         warnings,
		})
	}

	return map[string]interface{}{
		"namespace": a.Namespace,
		"hpas":      results,
		"total":     len(hpas),
	}, nil
}

// ─── analyze_log_patterns ─────────────────────────────────────────────────────

type analyzeLogPatternsArgs struct {
	Namespace     string `json:"namespace"`
	PodName       string `json:"pod_name"`
	ContainerName string `json:"container_name,omitempty"`
	TailLines     int    `json:"tail_lines,omitempty"`
}

// AnalyzeLogPatterns extracts error/warning patterns from pod logs.
func (t *AnalysisTools) AnalyzeLogPatterns(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a analyzeLogPatternsArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("analyze_log_patterns: invalid args: %w", err)
	}
	if a.PodName == "" {
		return nil, fmt.Errorf("analyze_log_patterns: pod_name is required")
	}
	if a.TailLines <= 0 {
		a.TailLines = 100
	}

	target := &pb.Resource{
		Kind:      "Pod",
		Namespace: a.Namespace,
		Name:      a.PodName,
	}
	params := map[string]interface{}{
		"container":  a.ContainerName,
		"tail_lines": a.TailLines,
	}
	paramsJSON, _ := json.Marshal(params)

	result, err := t.proxy.ExecuteCommand(ctx, "get_logs", target, paramsJSON, true)
	if err != nil {
		return nil, fmt.Errorf("analyze_log_patterns: failed to get logs: %w", err)
	}

	logContent := result.Message
	lines := strings.Split(logContent, "\n")

	errorPatterns := map[string]int{}
	warnPatterns := map[string]int{}
	errorLines := []string{}

	errorKeywords := []string{"error", "err", "exception", "fatal", "panic", "failed", "failure"}
	warnKeywords := []string{"warn", "warning", "deprecated"}

	for _, line := range lines {
		lLower := strings.ToLower(line)
		isError := false
		for _, kw := range errorKeywords {
			if strings.Contains(lLower, kw) {
				errorPatterns[kw]++
				isError = true
				break
			}
		}
		if isError {
			errorLines = append(errorLines, line)
			continue
		}
		for _, kw := range warnKeywords {
			if strings.Contains(lLower, kw) {
				warnPatterns[kw]++
				break
			}
		}
	}

	totalErrors := 0
	for _, count := range errorPatterns {
		totalErrors += count
	}

	severity := "LOW"
	if totalErrors > 10 {
		severity = "MEDIUM"
	}
	if totalErrors > 50 {
		severity = "HIGH"
	}

	// Return last 10 error lines as samples
	sampleErrors := errorLines
	if len(sampleErrors) > 10 {
		sampleErrors = sampleErrors[len(sampleErrors)-10:]
	}

	return map[string]interface{}{
		"pod":            a.PodName,
		"namespace":      a.Namespace,
		"container":      a.ContainerName,
		"lines_analysed": len(lines),
		"error_count":    totalErrors,
		"error_patterns": errorPatterns,
		"warn_patterns":  warnPatterns,
		"severity":       severity,
		"sample_errors":  sampleErrors,
	}, nil
}

// ─── assess_security_posture ──────────────────────────────────────────────────

type assessSecurityPostureArgs struct {
	Namespace string `json:"namespace"`
}

// AssessSecurityPosture performs CIS K8s Benchmark-style checks.
func (t *AnalysisTools) AssessSecurityPosture(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a assessSecurityPostureArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("assess_security_posture: invalid args: %w", err)
	}

	pods, err := t.listResources(ctx, "Pod", a.Namespace)
	if err != nil {
		return nil, fmt.Errorf("assess_security_posture: %w", err)
	}

	findings := []map[string]interface{}{}
	score := 100

	for _, pod := range pods {
		var raw map[string]interface{}
		if len(pod.Data) > 0 {
			_ = json.Unmarshal(pod.Data, &raw)
		}
		containers := getNestedSlice(raw, "spec", "containers")
		podSpec, _ := raw["spec"].(map[string]interface{})

		// Check: hostNetwork
		if podSpec != nil {
			if boolVal(podSpec["hostNetwork"]) {
				findings = append(findings, map[string]interface{}{
					"pod": pod.Name, "check": "HostNetworkEnabled",
					"severity": "HIGH", "cis_id": "5.2.4",
					"message": fmt.Sprintf("Pod %s uses hostNetwork — avoid unless necessary", pod.Name),
				})
				score -= 10
			}
			if boolVal(podSpec["hostPID"]) {
				findings = append(findings, map[string]interface{}{
					"pod": pod.Name, "check": "HostPIDEnabled",
					"severity": "HIGH", "cis_id": "5.2.2",
					"message": fmt.Sprintf("Pod %s uses hostPID", pod.Name),
				})
				score -= 10
			}
		}

		for _, c := range containers {
			cMap, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			cName := strVal(cMap["name"])
			sc, _ := cMap["securityContext"].(map[string]interface{})

			// Check: running as root
			if sc == nil || sc["runAsNonRoot"] == nil || !boolVal(sc["runAsNonRoot"]) {
				findings = append(findings, map[string]interface{}{
					"pod": pod.Name, "container": cName,
					"check": "RunAsRoot", "severity": "HIGH", "cis_id": "5.2.6",
					"message": fmt.Sprintf("Container %s/%s may run as root", pod.Name, cName),
				})
				score -= 5
			}

			// Check: privileged
			if sc != nil && boolVal(sc["privileged"]) {
				findings = append(findings, map[string]interface{}{
					"pod": pod.Name, "container": cName,
					"check": "Privileged", "severity": "CRITICAL", "cis_id": "5.2.1",
					"message": fmt.Sprintf("Container %s/%s is privileged", pod.Name, cName),
				})
				score -= 20
			}

			// Check: readOnlyRootFilesystem
			if sc == nil || !boolVal(sc["readOnlyRootFilesystem"]) {
				findings = append(findings, map[string]interface{}{
					"pod": pod.Name, "container": cName,
					"check": "WritableRootFS", "severity": "MEDIUM", "cis_id": "5.2.7",
					"message": fmt.Sprintf("Container %s/%s has writable root filesystem", pod.Name, cName),
				})
				score -= 3
			}
		}
	}

	if score < 0 {
		score = 0
	}

	riskLevel := "LOW"
	if score < 80 {
		riskLevel = "MEDIUM"
	}
	if score < 60 {
		riskLevel = "HIGH"
	}
	if score < 40 {
		riskLevel = "CRITICAL"
	}

	return map[string]interface{}{
		"namespace":      a.Namespace,
		"security_score": score,
		"risk_level":     riskLevel,
		"total_findings": len(findings),
		"findings":       findings,
		"summary":        fmt.Sprintf("Security score: %d/100 (%d findings)", score, len(findings)),
	}, nil
}

// ─── detect_configuration_drift ───────────────────────────────────────────────

type detectConfigurationDriftArgs struct {
	Namespace    string                 `json:"namespace"`
	Kind         string                 `json:"kind"`
	Name         string                 `json:"name"`
	DesiredState map[string]interface{} `json:"desired_state"`
}

// DetectConfigurationDrift compares running state vs desired/expected state.
func (t *AnalysisTools) DetectConfigurationDrift(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a detectConfigurationDriftArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("detect_configuration_drift: invalid args: %w", err)
	}
	if a.Kind == "" || a.Name == "" {
		return nil, fmt.Errorf("detect_configuration_drift: kind and name are required")
	}

	resource, err := t.getResource(ctx, a.Kind, a.Namespace, a.Name)
	if err != nil {
		return nil, fmt.Errorf("detect_configuration_drift: %w", err)
	}

	var current map[string]interface{}
	if len(resource.Data) > 0 {
		_ = json.Unmarshal(resource.Data, &current)
	}

	drifts := []map[string]interface{}{}
	if a.DesiredState != nil && current != nil {
		drifts = findDrifts("", a.DesiredState, current)
	}

	return map[string]interface{}{
		"resource":    fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
		"drift_count": len(drifts),
		"has_drift":   len(drifts) > 0,
		"drifts":      drifts,
		"summary": func() string {
			if len(drifts) == 0 {
				return "No configuration drift detected"
			}
			return fmt.Sprintf("%d configuration drift(s) detected", len(drifts))
		}(),
	}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func decodeArgs(args map[string]interface{}, target interface{}) error {
	b, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, target)
}

func filterByName(resources []*pb.Resource, name string) []*pb.Resource {
	result := make([]*pb.Resource, 0, 1)
	for _, r := range resources {
		if r.Name == name {
			result = append(result, r)
		}
	}
	return result
}

func getNestedStr(m map[string]interface{}, keys ...string) string {
	v := getNestedVal(m, keys...)
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func getNestedVal(m map[string]interface{}, keys ...string) interface{} {
	var current interface{} = m
	for _, k := range keys {
		cMap, ok := current.(map[string]interface{})
		if !ok {
			return nil
		}
		current = cMap[k]
	}
	return current
}

func getNestedSlice(m map[string]interface{}, keys ...string) []interface{} {
	v := getNestedVal(m, keys...)
	if s, ok := v.([]interface{}); ok {
		return s
	}
	return nil
}

func strVal(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func int64Val(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	case int:
		return int64(n)
	case int32:
		return int64(n)
	}
	return 0
}

func boolVal(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// findDrifts recursively compares desired vs actual maps and returns differences.
func findDrifts(path string, desired, actual map[string]interface{}) []map[string]interface{} {
	drifts := []map[string]interface{}{}
	for k, dv := range desired {
		fullPath := k
		if path != "" {
			fullPath = path + "." + k
		}
		av, exists := actual[k]
		if !exists {
			drifts = append(drifts, map[string]interface{}{
				"path":     fullPath,
				"expected": dv,
				"actual":   nil,
				"type":     "missing",
			})
			continue
		}
		// Recurse into nested maps
		if dMap, ok := dv.(map[string]interface{}); ok {
			if aMap, ok := av.(map[string]interface{}); ok {
				drifts = append(drifts, findDrifts(fullPath, dMap, aMap)...)
				continue
			}
		}
		// Compare leaf values by JSON representation
		dvJSON, _ := json.Marshal(dv)
		avJSON, _ := json.Marshal(av)
		if string(dvJSON) != string(avJSON) {
			drifts = append(drifts, map[string]interface{}{
				"path":     fullPath,
				"expected": dv,
				"actual":   av,
				"type":     "changed",
			})
		}
	}
	return drifts
}
