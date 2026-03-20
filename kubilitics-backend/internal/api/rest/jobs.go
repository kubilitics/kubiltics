package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// PostJobRetry handles POST /clusters/{clusterId}/resources/jobs/{namespace}/{name}/retry
// Creates a new Job with the same spec as the given Job (clone for retry).
func (h *Handler) PostJobRetry(w http.ResponseWriter, r *http.Request) {
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

	ctx := r.Context()

	requestID := logger.FromContext(r.Context())
	job, err := client.GetResource(ctx, "jobs", namespace, name)
	if err != nil {
		audit.LogMutation(requestID, clusterID, "retry", "jobs", namespace, name, "failure", err.Error())
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	spec, _ := job.Object["spec"].(map[string]interface{})
	if spec == nil {
		respondError(w, http.StatusBadRequest, "Job has no spec")
		return
	}

	// Build new Job: same spec, new metadata with generateName and namespace, no status/uid/resourceVersion
	jobObj := map[string]interface{}{
		"apiVersion": "batch/v1",
		"kind":       "Job",
		"metadata": map[string]interface{}{
			"generateName": name + "-retry-",
			"namespace":    namespace,
		},
		"spec": spec,
	}

	jobUnstructured := &unstructured.Unstructured{Object: jobObj}
	created, err := client.CreateResource(ctx, jobUnstructured)
	if err != nil {
		audit.LogMutation(requestID, clusterID, "retry", "jobs", namespace, name, "failure", err.Error())
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	audit.LogMutation(requestID, clusterID, "retry", "jobs", namespace, name, "success", "")
	respondJSON(w, http.StatusCreated, created.Object)
}
