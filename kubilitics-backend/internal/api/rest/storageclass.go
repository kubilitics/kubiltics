package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetStorageClassPVCounts handles GET /clusters/{clusterId}/resources/storageclasses/pv-counts
// Returns a map of storage class name to PV count for efficient list-page display.
func (h *Handler) GetStorageClassPVCounts(w http.ResponseWriter, r *http.Request) {
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

	list, err := client.ListResources(r.Context(), "persistentvolumes", "", metav1.ListOptions{Limit: 5000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	counts := make(map[string]int)
	for i := range list.Items {
		sc := storageClassNameFromPV(&list.Items[i])
		if sc != "" {
			counts[sc]++
		}
	}
	respondJSON(w, http.StatusOK, counts)
}

// storageClassNameFromPV reads spec.storageClassName from an unstructured PV.
func storageClassNameFromPV(obj *unstructured.Unstructured) string {
	sc, found, _ := unstructured.NestedString(obj.Object, "spec", "storageClassName")
	if !found || sc == "" {
		return ""
	}
	return sc
}
