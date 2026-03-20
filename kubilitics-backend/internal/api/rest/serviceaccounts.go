package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetServiceAccountTokenCounts handles GET /clusters/{clusterId}/resources/serviceaccounts/token-counts
// Returns a map of "namespace/name" to count of token secrets (type=kubernetes.io/service-account-token, annotation kubernetes.io/service-account.name=name).
func (h *Handler) GetServiceAccountTokenCounts(w http.ResponseWriter, r *http.Request) {
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

	list, err := client.ListResources(r.Context(), "secrets", "", metav1.ListOptions{Limit: 10000})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	counts := make(map[string]int)
	for i := range list.Items {
		obj := &list.Items[i]
		typ, _, _ := unstructured.NestedString(obj.Object, "type")
		if typ != "kubernetes.io/service-account-token" {
			continue
		}
		ann, _, _ := unstructured.NestedStringMap(obj.Object, "metadata", "annotations")
		saName := ann["kubernetes.io/service-account.name"]
		if saName == "" {
			continue
		}
		ns, _, _ := unstructured.NestedString(obj.Object, "metadata", "namespace")
		if ns == "" {
			continue
		}
		key := ns + "/" + saName
		counts[key]++
	}
	respondJSON(w, http.StatusOK, counts)
}
