package rest

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/redact"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

const maxNamespacesParam = 20

// respondK8sError maps Kubernetes API errors to structured HTTP error responses
// with proper status codes, error codes, and request IDs.
func respondK8sError(w http.ResponseWriter, err error, requestID string) {
	if errors.Is(err, k8s.ErrCircuitOpen) {
		w.Header().Set("Retry-After", "30")
		respondErrorWithCode(w, http.StatusServiceUnavailable, ErrCodeCircuitBreaker, "Cluster API is temporarily unavailable due to repeated failures. Circuit breaker is open. Please retry after 30 seconds.", requestID)
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		respondErrorWithCode(w, http.StatusGatewayTimeout, ErrCodeTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.", requestID)
		return
	}
	if apierrors.IsNotFound(err) {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}
	if apierrors.IsForbidden(err) {
		respondErrorWithCode(w, http.StatusForbidden, ErrCodeForbidden, err.Error(), requestID)
		return
	}
	if apierrors.IsConflict(err) || apierrors.IsAlreadyExists(err) {
		respondErrorWithCode(w, http.StatusConflict, ErrCodeConflict, err.Error(), requestID)
		return
	}
	respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, err.Error(), requestID)
}

// DestructiveConfirmHeader (D1.2): clients must send this for DELETE resource and POST /apply.
const DestructiveConfirmHeader = "X-Confirm-Destructive"

// ListResources handles GET /clusters/{clusterId}/resources/{kind}
// Query: namespace (single) or namespaces (comma-separated, max 20) for multi-namespace list; limit, continue, labelSelector, fieldSelector.
func (h *Handler) ListResources(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := r.URL.Query().Get("namespace")
	namespacesParam := strings.TrimSpace(r.URL.Query().Get("namespaces"))
	hasNamespacesParam := r.URL.Query().Has("namespaces")

	var nsList []string
	if hasNamespacesParam {
		if namespacesParam != "" {
			parts := strings.Split(namespacesParam, ",")
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			if !validate.Namespace(p) {
				requestID := logger.FromContext(r.Context())
				respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid namespace in namespaces list", requestID)
				return
			}
			nsList = append(nsList, p)
		}
		if len(nsList) > maxNamespacesParam {
			requestID := logger.FromContext(r.Context())
			respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Too many namespaces in namespaces list (max "+strconv.Itoa(maxNamespacesParam)+")", requestID)
			return
		}
		}
		// nsList may be empty when namespaces= was provided with no value (project-scoped empty)
	}
	if !validate.ClusterID(clusterID) || !validate.Kind(kind) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId or kind", requestID)
		return
	}
	if len(nsList) == 0 && !validate.Namespace(namespace) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, kind, or namespace", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// BE-FUNC-002: Pagination support (limit, continue token). For multi-namespace, continue is ignored.
	opts := metav1.ListOptions{}
	const defaultLimit = 100
	const maxLimit = 500
	opts.Limit = int64(defaultLimit)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if n, err := strconv.ParseInt(limitStr, 10, 64); err == nil && n > 0 {
			if n > maxLimit {
				n = maxLimit
			}
			opts.Limit = n
		}
	}
	continueToken := r.URL.Query().Get("continue")
	if continueToken != "" && len(nsList) == 0 {
		opts.Continue = continueToken
	}
	if labelSelector := r.URL.Query().Get("labelSelector"); labelSelector != "" {
		opts.LabelSelector = labelSelector
	}
	if fieldSelector := r.URL.Query().Get("fieldSelector"); fieldSelector != "" {
		opts.FieldSelector = fieldSelector
	}

	var list *unstructured.UnstructuredList
	cacheHit := false

	// PERF: Try informer cache first (Lens/Headlamp model).
	// The OverviewCache maintains a live mirror of every resource via Watch events.
	// Reading from cache is <1ms vs 200-2000ms for a direct K8s API call.
	// Cache is used only for simple list requests (no label/field selectors, no continue token).
	if im := h.clusterService.GetInformerManager(clusterID); im != nil {
		if hasNamespacesParam && len(nsList) == 0 {
			list = &unstructured.UnstructuredList{Items: nil}
			cacheHit = true
		} else if len(nsList) > 0 {
			// Multi-namespace: try cache for each namespace and merge
			merged := &unstructured.UnstructuredList{}
			allHit := true
			for _, ns := range nsList {
				part, ok := im.ListFromCache(kind, ns, opts)
				if !ok {
					allHit = false
					break
				}
				merged.Items = append(merged.Items, part.Items...)
			}
			if allHit {
				if int64(len(merged.Items)) > opts.Limit {
					merged.Items = merged.Items[:opts.Limit]
				}
				list = merged
				cacheHit = true
			}
		} else {
			if cached, ok := im.ListFromCache(kind, namespace, opts); ok {
				list = cached
				cacheHit = true
			}
		}
		if cacheHit {
			w.Header().Set("X-Cache", "HIT")
		}
	}

	// Cache miss: fall back to direct K8s API call
	if !cacheHit {
		w.Header().Set("X-Cache", "MISS")
		if hasNamespacesParam && len(nsList) == 0 {
			list = &unstructured.UnstructuredList{Items: nil}
		} else if len(nsList) > 0 {
			// Multi-namespace: list per namespace and merge.
			perNsLimit := opts.Limit
			if len(nsList) > 1 {
				perNsLimit = (opts.Limit + int64(len(nsList)) - 1) / int64(len(nsList))
				if perNsLimit < 1 {
					perNsLimit = 1
				}
			}
			merged := &unstructured.UnstructuredList{}
			for _, ns := range nsList {
				optsNs := opts
				optsNs.Limit = perNsLimit
				part, err := client.ListResources(r.Context(), kind, ns, optsNs)
				if err != nil {
					requestID := logger.FromContext(r.Context())
					if errors.Is(err, k8s.ErrCircuitOpen) {
						w.Header().Set("Retry-After", "30")
						respondErrorWithCode(w, http.StatusServiceUnavailable, ErrCodeCircuitBreaker, "Cluster API is temporarily unavailable due to repeated failures. Circuit breaker is open. Please retry after 30 seconds.", requestID)
						return
					}
					if errors.Is(err, context.DeadlineExceeded) {
						respondErrorWithCode(w, http.StatusGatewayTimeout, ErrCodeTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded. Try again or use a more specific query with namespace or label selectors.", requestID)
						return
					}
					if apierrors.IsNotFound(err) || apierrors.IsForbidden(err) {
						continue
					}
					respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, err.Error(), requestID)
					return
				}
				merged.Items = append(merged.Items, part.Items...)
			}
			if int64(len(merged.Items)) > opts.Limit {
				merged.Items = merged.Items[:opts.Limit]
			}
			list = merged
		} else {
			list, err = client.ListResources(r.Context(), kind, namespace, opts)
		}
		if err != nil {
			// CRD/API group not installed → return empty list (Headlamp/Lens pattern)
			if apierrors.IsNotFound(err) {
				list = &unstructured.UnstructuredList{Items: nil}
			} else {
				requestID := logger.FromContext(r.Context())
				respondK8sError(w, err, requestID)
				return
			}
		}
	}

	// BE-FUNC-002: Return pagination metadata: items + metadata with continue token and total
	itemsRaw := listItemsToRaw(list.Items)
	if redact.IsSecretKind(kind) {
		for i := range itemsRaw {
			redact.SecretData(itemsRaw[i])
		}
	}
	total := int64(len(itemsRaw))
	if len(nsList) == 0 && list.GetRemainingItemCount() != nil {
		total = int64(len(itemsRaw)) + *list.GetRemainingItemCount()
	}
	meta := map[string]interface{}{
		"resourceVersion": list.GetResourceVersion(),
		"total":            total,
	}
	if len(nsList) == 0 {
		meta["continue"] = list.GetContinue()
		if list.GetRemainingItemCount() != nil {
			meta["remainingItemCount"] = *list.GetRemainingItemCount()
		}
	}
	out := map[string]interface{}{
		"items":    itemsRaw,
		"metadata": meta,
	}
	respondJSON(w, http.StatusOK, out)
}

// listItemsToRaw converts unstructured items to a JSON-serializable slice (map[string]interface{}).
func listItemsToRaw(items []unstructured.Unstructured) []map[string]interface{} {
	out := make([]map[string]interface{}, len(items))
	for i := range items {
		out[i] = items[i].Object
	}
	return out
}

// GetResource handles GET /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// For cluster-scoped resources (IngressClass, Node, etc.) use namespace "-" or "_" in the path.
func (h *Handler) GetResource(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := vars["namespace"]
	name := vars["name"]
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) || !validate.Name(name) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, kind, namespace, or name", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// Try informer cache first for sub-millisecond response (Headlamp/Lens model).
	// The informer maintains a live mirror via Watch — reads are instant.
	if im := h.clusterService.GetInformerManager(clusterID); im != nil && im.HasSynced() {
		opts := metav1.ListOptions{}
		if cached, ok := im.ListFromCache(kind, namespace, opts); ok {
			for _, item := range cached.Items {
				if item.GetName() == name {
					payload := item.Object
					if redact.IsSecretKind(kind) {
						redact.SecretData(payload)
					}
					w.Header().Set("X-Cache", "HIT")
					respondJSON(w, http.StatusOK, payload)
					return
				}
			}
		}
	}

	// Cache miss — direct K8s API call
	obj, err := client.GetResource(r.Context(), kind, namespace, name)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondK8sError(w, err, requestID)
		return
	}

	payload := obj.Object
	if redact.IsSecretKind(kind) {
		redact.SecretData(payload)
	}
	w.Header().Set("X-Cache", "MISS")
	respondJSON(w, http.StatusOK, payload)
}

// PatchResource handles PATCH /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// Body: JSON merge-patch object (e.g. {"spec":{"replicas":3}} for scaling).
// For cluster-scoped resources use namespace "-" or "_" in the path.
func (h *Handler) PatchResource(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := vars["namespace"]
	name := vars["name"]
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) || !validate.Name(name) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, kind, namespace, or name", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	var patch map[string]interface{}
	requestID := logger.FromContext(r.Context())
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid JSON patch body", requestID)
		return
	}
	if len(patch) == 0 {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Patch body is required", requestID)
		return
	}

	// BE-DATA-001: log dangerous pod/container settings in PATCH body (hostPID, privileged, hostNetwork)
	dangerousWarnings := validate.PatchJSONDangerousWarnings(patch)
	for _, w := range dangerousWarnings {
		log.Printf("[patch] security warning: cluster=%s kind=%s ns=%s name=%s %s", clusterID, kind, namespace, name, w)
	}

	patchBytes, err := json.Marshal(patch)
	if err != nil {
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, "Failed to encode patch", requestID)
		return
	}

	obj, err := client.PatchResource(r.Context(), kind, namespace, name, patchBytes)
	if err != nil {
		audit.LogMutation(requestID, clusterID, "patch", kind, namespace, name, "failure", err.Error())
		respondK8sError(w, err, requestID)
		return
	}
	audit.LogMutation(requestID, clusterID, "patch", kind, namespace, name, "success", "")
	payload := obj.Object
	if redact.IsSecretKind(kind) {
		redact.SecretData(payload)
	}
	result := map[string]interface{}{"resource": payload}
	if len(dangerousWarnings) > 0 {
		result["warnings"] = dangerousWarnings
	}
	respondJSON(w, http.StatusOK, result)
}

// DeleteResource handles DELETE /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// For cluster-scoped resources use namespace "-" or "_" in the path.
func (h *Handler) DeleteResource(w http.ResponseWriter, r *http.Request) {
	requestID := logger.FromContext(r.Context())
	if !strings.EqualFold(r.Header.Get(DestructiveConfirmHeader), "true") {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Destructive action requires X-Confirm-Destructive: true", requestID)
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := vars["kind"]
	namespace := vars["namespace"]
	name := vars["name"]
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	if !validate.ClusterID(clusterID) || !validate.Kind(kind) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, kind, namespace, or name", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	opts := metav1.DeleteOptions{}
	if err := client.DeleteResource(r.Context(), kind, namespace, name, opts); err != nil {
		audit.LogDelete(requestID, clusterID, kind, namespace, name, "failure", err.Error())
		respondK8sError(w, err, requestID)
		return
	}

	audit.LogDelete(requestID, clusterID, kind, namespace, name, "success", "")

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Resource deleted",
		"cluster_id": clusterID,
		"kind":       kind,
		"namespace": namespace,
		"name":      name,
	})
}

// ApplyManifest handles POST /clusters/{clusterId}/apply
func (h *Handler) ApplyManifest(w http.ResponseWriter, r *http.Request) {
	requestID := logger.FromContext(r.Context())
	if !strings.EqualFold(r.Header.Get(DestructiveConfirmHeader), "true") {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Apply requires X-Confirm-Destructive: true (review YAML before applying)", requestID)
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	if !validate.ClusterID(clusterID) {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId", requestID)
		return
	}

	var req struct {
		YAML string `json:"yaml"`
	}

	// Body size is enforced by the MaxBodySize middleware (5MB for /apply routes).
	// No duplicate MaxBytesReader here — the middleware already wraps r.Body.
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			respondErrorWithCode(w, http.StatusRequestEntityTooLarge, ErrCodePayloadTooLarge, "Request entity too large", requestID)
			return
		}
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid request body", requestID)
		return
	}

	if req.YAML == "" {
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "YAML content is required", requestID)
		return
	}

	// BE-DATA-001: log dangerous pod/container settings (hostPID, privileged, hostNetwork)
	dangerousWarnings := validate.ApplyYAMLDangerousWarnings(req.YAML)
	for _, w := range dangerousWarnings {
		log.Printf("[apply] security warning: %s", w)
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	applied, err := client.ApplyYAML(r.Context(), req.YAML)
	if err != nil {
		audit.LogApply(requestID, clusterID, "failure", err.Error(), nil)
		respondK8sError(w, err, requestID)
		return
	}
	resources := make([]audit.AppliedResource, len(applied))
	for i := range applied {
		resources[i] = audit.AppliedResource{
			Kind: applied[i].Kind,
			Namespace: applied[i].Namespace,
			Name: applied[i].Name,
			Action: applied[i].Action,
		}
	}
	audit.LogApply(requestID, clusterID, "success", "", resources)

	resp := map[string]interface{}{
		"message":    "Manifest applied successfully",
		"cluster_id": clusterID,
		"resources":  applied,
	}
	if len(dangerousWarnings) > 0 {
		resp["warnings"] = dangerousWarnings
	}
	respondJSON(w, http.StatusOK, resp)
}

// GetServiceEndpoints handles GET /clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints.
// Returns the Endpoints resource with the same name as the service (Kubernetes creates it automatically).
func (h *Handler) GetServiceEndpoints(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, namespace, or name", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	obj, err := client.GetResource(r.Context(), "endpoints", namespace, name)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondK8sError(w, err, requestID)
		return
	}

	respondJSON(w, http.StatusOK, obj.Object)
}
