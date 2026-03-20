package rest

import (
	"net/http"
	"sort"
	"strconv"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// PostCronJobTrigger handles POST /clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/trigger
// Creates a one-off Job from the CronJob's spec.jobTemplate.
func (h *Handler) PostCronJobTrigger(w http.ResponseWriter, r *http.Request) {
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

	cronJob, err := client.GetResource(ctx, "cronjobs", namespace, name)
	if err != nil {
		audit.LogMutation(requestID, clusterID, "trigger", "cronjobs", namespace, name, "failure", err.Error())
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	spec, _ := cronJob.Object["spec"].(map[string]interface{})
	if spec == nil {
		respondError(w, http.StatusBadRequest, "CronJob has no spec")
		return
	}
	jobTemplate, _ := spec["jobTemplate"].(map[string]interface{})
	if jobTemplate == nil {
		respondError(w, http.StatusBadRequest, "CronJob has no spec.jobTemplate")
		return
	}
	jobSpec, _ := jobTemplate["spec"].(map[string]interface{})
	if jobSpec == nil {
		respondError(w, http.StatusBadRequest, "CronJob jobTemplate has no spec")
		return
	}

	jobMeta, _ := jobTemplate["metadata"].(map[string]interface{})
	if jobMeta == nil {
		jobMeta = make(map[string]interface{})
	}

	// Build Job object: apiVersion batch/v1, kind Job, metadata.generateName = name-, namespace, labels/annotations; spec = jobTemplate.spec
	jobObj := map[string]interface{}{
		"apiVersion": "batch/v1",
		"kind":       "Job",
		"metadata": map[string]interface{}{
			"generateName": name + "-",
			"namespace":    namespace,
		},
		"spec": jobSpec,
	}
	meta := jobObj["metadata"].(map[string]interface{})
	if labels, ok := jobMeta["labels"].(map[string]interface{}); ok && len(labels) > 0 {
		meta["labels"] = labels
	}
	if ann, ok := jobMeta["annotations"].(map[string]interface{}); ok && len(ann) > 0 {
		meta["annotations"] = ann
	}

	jobUnstructured := &unstructured.Unstructured{Object: jobObj}
	created, err := client.CreateResource(ctx, jobUnstructured)
	if err != nil {
		audit.LogMutation(requestID, clusterID, "trigger", "cronjobs", namespace, name, "failure", err.Error())
		if apierrors.IsAlreadyExists(err) {
			respondError(w, http.StatusConflict, err.Error())
			return
		}
		if apierrors.IsForbidden(err) {
			respondError(w, http.StatusForbidden, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	audit.LogMutation(requestID, clusterID, "trigger", "cronjobs", namespace, name, "success", "")
	respondJSON(w, http.StatusCreated, created.Object)
}

// GetCronJobJobs handles GET /clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/jobs
// Returns the last N child jobs owned by this CronJob (Job Name | Status | Start Time | Duration).
func (h *Handler) GetCronJobJobs(w http.ResponseWriter, r *http.Request) {
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

	limit := 5
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	jobList, err := client.ListResources(r.Context(), "jobs", namespace, metav1.ListOptions{Limit: 500})
	if err != nil {
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Filter jobs owned by this CronJob
	var owned []unstructured.Unstructured
	for _, item := range jobList.Items {
		refs := item.GetOwnerReferences()
		for _, ref := range refs {
			if ref.Kind == "CronJob" && ref.Name == name {
				owned = append(owned, item)
				break
			}
		}
	}

	// Sort by startTime descending (newest first)
	sort.Slice(owned, func(i, j int) bool {
		si, _ := owned[i].Object["status"].(map[string]interface{})
		sj, _ := owned[j].Object["status"].(map[string]interface{})
		ti, _ := si["startTime"].(string)
		tj, _ := sj["startTime"].(string)
		return ti > tj
	})

	// Take up to limit
	if len(owned) > limit {
		owned = owned[:limit]
	}

	items := make([]map[string]interface{}, len(owned))
	for i := range owned {
		items[i] = owned[i].Object
	}
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"kind":       "List",
		"apiVersion": "v1",
		"metadata":  map[string]interface{}{},
		"items":     items,
	})
}
