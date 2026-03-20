package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetMetalLBFeature handles GET /clusters/{clusterId}/features/metallb
// Returns { installed: true|false } if MetalLB CRDs (ipaddresspools, bgppeers) exist in the cluster.
func (h *Handler) GetMetalLBFeature(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); check MetalLB with it
	opts := metav1.ListOptions{Limit: 1}
	_, err = client.ListResources(r.Context(), "ipaddresspools", "", opts)
	installed := (err == nil)
	if err != nil && !apierrors.IsNotFound(err) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, err.Error(), requestID)
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"installed": installed,
	})
}
