package rest

import (
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// ListCRDInstances handles GET /clusters/{clusterId}/crd-instances/{crdName}
// Lists instances of a CRD by its full name (e.g. certificates.cert-manager.io).
func (h *Handler) ListCRDInstances(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	crdName := vars["crdName"]
	namespace := r.URL.Query().Get("namespace")

	if !validate.ClusterID(clusterID) || crdName == "" || !validate.Namespace(namespace) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, crdName, or namespace", requestID)
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// BE-FUNC-002: Pagination support (limit, continue token)
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
	if continueToken := r.URL.Query().Get("continue"); continueToken != "" {
		opts.Continue = continueToken
	}
	if labelSelector := r.URL.Query().Get("labelSelector"); labelSelector != "" {
		opts.LabelSelector = labelSelector
	}
	if fieldSelector := r.URL.Query().Get("fieldSelector"); fieldSelector != "" {
		opts.FieldSelector = fieldSelector
	}

	list, err := client.ListCRDInstances(r.Context(), crdName, namespace, opts)
	if err != nil {
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

	// BE-FUNC-002: Return pagination metadata: items + metadata with continue token and total
	itemsRaw := listItemsToRaw(list.Items)
	total := int64(len(itemsRaw))
	if list.GetRemainingItemCount() != nil {
		total = int64(len(itemsRaw)) + *list.GetRemainingItemCount()
	}
	meta := map[string]interface{}{
		"resourceVersion": list.GetResourceVersion(),
		"continue":        list.GetContinue(),
		"total":           total,
	}
	if list.GetRemainingItemCount() != nil {
		meta["remainingItemCount"] = *list.GetRemainingItemCount()
	}
	out := map[string]interface{}{
		"items":    itemsRaw,
		"metadata": meta,
	}
	respondJSON(w, http.StatusOK, out)
}
