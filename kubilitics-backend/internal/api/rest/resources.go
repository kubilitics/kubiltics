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
	if hasNamespacesParam && len(nsList) == 0 {
		// Explicit empty namespaces list (e.g. project with no namespaces in this cluster).
		list = &unstructured.UnstructuredList{Items: nil}
	} else if len(nsList) > 0 {
		// Multi-namespace: list per namespace and merge. Pagination: limit per-namespace (ceil(limit/len(nsList))).
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
		list = merged
	} else {
		list, err = client.ListResources(r.Context(), kind, namespace, opts)
	}
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
		if apierrors.IsNotFound(err) {
			respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
			return
		}
		if apierrors.IsForbidden(err) {
			respondErrorWithCode(w, http.StatusForbidden, ErrCodeForbidden, err.Error(), requestID)
			return
		}
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, err.Error(), requestID)
		return
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

	obj, err := client.GetResource(r.Context(), kind, namespace, name)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	payload := obj.Object
	if redact.IsSecretKind(kind) {
		redact.SecretData(payload)
	}
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
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON patch body")
		return
	}
	if len(patch) == 0 {
		respondError(w, http.StatusBadRequest, "Patch body is required")
		return
	}

	patchBytes, err := json.Marshal(patch)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to encode patch")
		return
	}

	obj, err := client.PatchResource(r.Context(), kind, namespace, name, patchBytes)
	requestID := logger.FromContext(r.Context())
	if err != nil {
		audit.LogMutation(requestID, clusterID, "patch", kind, namespace, name, "failure", err.Error())
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	audit.LogMutation(requestID, clusterID, "patch", kind, namespace, name, "success", "")
	payload := obj.Object
	if redact.IsSecretKind(kind) {
		redact.SecretData(payload)
	}
	respondJSON(w, http.StatusOK, payload)
}

// DeleteResource handles DELETE /clusters/{clusterId}/resources/{kind}/{namespace}/{name}
// For cluster-scoped resources use namespace "-" or "_" in the path.
func (h *Handler) DeleteResource(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get(DestructiveConfirmHeader) != "true" {
		respondError(w, http.StatusBadRequest, "Destructive action requires X-Confirm-Destructive: true")
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

	opts := metav1.DeleteOptions{}
	if err := client.DeleteResource(r.Context(), kind, namespace, name, opts); err != nil {
		requestID := logger.FromContext(r.Context())
		audit.LogDelete(requestID, clusterID, kind, namespace, name, "failure", err.Error())
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	requestID := logger.FromContext(r.Context())
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
	if r.Header.Get(DestructiveConfirmHeader) != "true" {
		respondError(w, http.StatusBadRequest, "Apply requires X-Confirm-Destructive: true (review YAML before applying)")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	var req struct {
		YAML string `json:"yaml"`
	}

	// Limit body size (D1.2): use a limited reader if config set
	maxBytes := 512 * 1024 // 512KB default
	if h.cfg != nil && h.cfg.ApplyMaxYAMLBytes > 0 {
		maxBytes = h.cfg.ApplyMaxYAMLBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(maxBytes))

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			respondError(w, http.StatusRequestEntityTooLarge, "Request entity too large")
			return
		}
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.YAML == "" {
		respondError(w, http.StatusBadRequest, "YAML content is required")
		return
	}

	// BE-DATA-001: log dangerous pod/container settings (hostPID, privileged, hostNetwork)
	for _, w := range validate.ApplyYAMLDangerousWarnings(req.YAML) {
		log.Printf("[apply] security warning: %s", w)
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	applied, err := client.ApplyYAML(r.Context(), req.YAML)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		audit.LogApply(requestID, clusterID, "failure", err.Error(), nil)
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	requestID := logger.FromContext(r.Context())
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

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":    "Manifest applied successfully",
		"cluster_id": clusterID,
		"resources":  applied,
	})
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
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusGatewayTimeout, "Request to Kubernetes API timed out. The cluster may be slow or overloaded.")
			return
		}
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, obj.Object)
}
