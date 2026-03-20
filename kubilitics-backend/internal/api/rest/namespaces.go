package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// NamespaceCounts is the response for GET .../resources/namespaces/counts.
// Keys are namespace names; values are pod and service counts for that namespace.
type NamespaceCounts map[string]struct {
	Pods     int `json:"pods"`
	Services int `json:"services"`
}

// GetNamespaceCounts handles GET /clusters/{clusterId}/resources/namespaces/counts
// Returns per-namespace pod and service counts for efficient list-page display.
func (h *Handler) GetNamespaceCounts(w http.ResponseWriter, r *http.Request) {
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

	opts := metav1.ListOptions{Limit: 10000}
	podList, err := client.ListResources(r.Context(), "pods", "", opts)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	svcList, err := client.ListResources(r.Context(), "services", "", opts)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	counts := make(NamespaceCounts)
	for i := range podList.Items {
		ns := namespaceFromUnstructured(&podList.Items[i])
		if ns != "" {
			entry := counts[ns]
			entry.Pods++
			counts[ns] = entry
		}
	}
	for i := range svcList.Items {
		ns := namespaceFromUnstructured(&svcList.Items[i])
		if ns != "" {
			entry := counts[ns]
			entry.Services++
			counts[ns] = entry
		}
	}
	respondJSON(w, http.StatusOK, counts)
}

func namespaceFromUnstructured(obj *unstructured.Unstructured) string {
	ns, _, _ := unstructured.NestedString(obj.Object, "metadata", "namespace")
	return ns
}
