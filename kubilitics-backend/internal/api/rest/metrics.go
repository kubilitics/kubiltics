package rest

import (
	"net/http"
	"strings"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetMetricsSummary handles GET /clusters/{clusterId}/metrics/summary?namespace=&resource_type=&resource_name=
// Unified, resource-agnostic endpoint: works for pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob.
// Returns 200 with body { summary?, error?, error_code?, query_ms, cache_hit }; 404 only when cluster is not found.
func (h *Handler) GetMetricsSummary(w http.ResponseWriter, r *http.Request) {
	if h.unifiedMetricsService == nil {
		respondError(w, http.StatusNotImplemented, "Unified metrics service is not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := r.URL.Query().Get("namespace")
	resourceType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("resource_type")))
	resourceName := strings.TrimSpace(r.URL.Query().Get("resource_name"))
	if !validate.ClusterID(clusterID) || resourceName == "" || resourceType == "" {
		respondError(w, http.StatusBadRequest, "Missing or invalid clusterId, resource_type, or resource_name")
		return
	}
	if namespace != "" && !validate.Namespace(namespace) {
		respondError(w, http.StatusBadRequest, "Invalid namespace")
		return
	}
	rt := models.ResourceType(resourceType)
	// Allow only known types
	switch rt {
	case models.ResourceTypePod, models.ResourceTypeNode, models.ResourceTypeDeployment,
		models.ResourceTypeReplicaSet, models.ResourceTypeStatefulSet, models.ResourceTypeDaemonSet,
		models.ResourceTypeJob, models.ResourceTypeCronJob:
	default:
		respondError(w, http.StatusBadRequest, "Unsupported resource_type for metrics; use pod, node, deployment, replicaset, statefulset, daemonset, job, cronjob")
		return
	}
	// Node is cluster-scoped: namespace not required
	if rt != models.ResourceTypeNode && namespace == "" {
		respondError(w, http.StatusBadRequest, "namespace is required for namespaced resource types")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	// Note: UnifiedMetricsService uses clusterID internally, so we use clusterID as identifier
	id := models.ResourceIdentity{
		ClusterID:    clusterID,
		Namespace:    namespace,
		ResourceType: rt,
		ResourceName: resourceName,
	}
	result := h.unifiedMetricsService.GetSummary(r.Context(), id)
	if result.ErrorCode == "CLUSTER_NOT_FOUND" {
		respondError(w, http.StatusNotFound, result.Error)
		return
	}
	respondJSON(w, http.StatusOK, result)
}

// GetClusterMetrics handles GET /clusters/{clusterId}/metrics
// Returns cluster/node-level metrics when Metrics Server is available; 503 when unavailable. B1.3.
func (h *Handler) GetClusterMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	namespace := r.URL.Query().Get("namespace")
	if namespace != "" && !validate.Namespace(namespace) {
		respondError(w, http.StatusBadRequest, "Invalid namespace")
		return
	}

	if namespace != "" {
		client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
		if err != nil {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		nsMetrics, err := h.metricsService.GetNamespaceMetricsWithClient(r.Context(), client, namespace)
		if err != nil {
			respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or not installed: "+err.Error())
			return
		}
		respondJSON(w, http.StatusOK, nsMetrics)
		return
	}

	// No namespace: return empty summary or 400 with hint
	respondJSON(w, http.StatusOK, map[string]string{
		"message": "Use query namespace= to get namespace metrics, or /clusters/{clusterId}/metrics/{namespace}/{pod} for pod metrics",
	})
}

// GetPodMetrics handles GET /clusters/{clusterId}/metrics/{namespace}/{pod}
// Returns pod CPU/memory from Metrics Server; 503 when unavailable. B1.3.
func (h *Handler) GetPodMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Pod metrics are not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	pod := vars["pod"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(pod) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetPodMetricsWithClient(r.Context(), client, namespace, pod)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or pod not found: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, metrics)
}

// GetNodeMetrics handles GET /clusters/{clusterId}/metrics/nodes/{nodeName}
// Returns node CPU/memory from Metrics Server; 503 when unavailable.
func (h *Handler) GetNodeMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	nodeName := vars["nodeName"]
	if !validate.ClusterID(clusterID) || !validate.Name(nodeName) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId or nodeName")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetNodeMetricsWithClient(r.Context(), client, nodeName)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or node not found: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, metrics)
}

// GetDeploymentMetrics handles GET /clusters/{clusterId}/metrics/{namespace}/deployment/{name}
// Returns aggregated CPU/memory for all pods of the deployment; 503 when Metrics Server unavailable.
func (h *Handler) GetDeploymentMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or deployment name")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetDeploymentMetricsWithClient(r.Context(), client, namespace, name)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or deployment not found: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, metrics)
}

func (h *Handler) GetReplicaSetMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, namespace, name := vars["clusterId"], vars["namespace"], vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetReplicaSetMetricsWithClient(r.Context(), client, namespace, name)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or replicaset not found: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, metrics)
}

func (h *Handler) GetStatefulSetMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, namespace, name := vars["clusterId"], vars["namespace"], vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetStatefulSetMetricsWithClient(r.Context(), client, namespace, name)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or statefulset not found: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, metrics)
}

func (h *Handler) GetDaemonSetMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, namespace, name := vars["clusterId"], vars["namespace"], vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetDaemonSetMetricsWithClient(r.Context(), client, namespace, name)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or daemonset not found: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, metrics)
}

func (h *Handler) GetJobMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, namespace, name := vars["clusterId"], vars["namespace"], vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetJobMetricsWithClient(r.Context(), client, namespace, name)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or job not found: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, metrics)
}

func (h *Handler) GetCronJobMetrics(w http.ResponseWriter, r *http.Request) {
	if h.metricsService == nil {
		respondError(w, http.StatusNotImplemented, "Cluster metrics are not configured")
		return
	}
	vars := mux.Vars(r)
	clusterID, namespace, name := vars["clusterId"], vars["namespace"], vars["name"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	metrics, err := h.metricsService.GetCronJobMetricsWithClient(r.Context(), client, namespace, name)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Metrics Server unavailable or cronjob not found: "+err.Error())
		return
	}
	respondJSON(w, http.StatusOK, metrics)
}
