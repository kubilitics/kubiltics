package rest

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

const (
	deploymentRevisionAnnotation = "deployment.kubernetes.io/revision"
	changeCauseAnnotation        = "kubernetes.io/change-cause"
	podTemplateHashLabel         = "pod-template-hash"
)

// RolloutHistoryEntry represents one revision in deployment rollout history.
type RolloutHistoryEntry struct {
	Revision          int      `json:"revision"`
	CreationTimestamp string   `json:"creationTimestamp"`
	ChangeCause       string   `json:"changeCause"`
	PodTemplateHash   string   `json:"podTemplateHash"`
	Ready             int64    `json:"ready"`
	Desired           int64    `json:"desired"`
	Available         int64    `json:"available"`
	Name              string   `json:"name"`
	Images            []string `json:"images,omitempty"`
	DurationSeconds   int64    `json:"durationSeconds,omitempty"`
}

// GetDeploymentRolloutHistory handles GET /clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history
func (h *Handler) GetDeploymentRolloutHistory(w http.ResponseWriter, r *http.Request) {
	vars := GetPathVars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}

	ctx := r.Context()
	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	dep, err := client.GetResource(ctx, "deployments", namespace, name)
	if err != nil {
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	depUID, _ := getNestedString(dep.Object, "metadata", "uid")
	if depUID == "" {
		respondError(w, http.StatusInternalServerError, "Deployment has no UID")
		return
	}

	rsList, err := client.ListResources(ctx, "replicasets", namespace, metav1.ListOptions{})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rsList == nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{"revisions": []interface{}{}})
		return
	}

	var entries []RolloutHistoryEntry
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		if rs.Object == nil {
			continue
		}
		owners, _ := getNestedSlice(rs.Object, "metadata", "ownerReferences")
		var ownedByThisDeployment bool
		for _, o := range owners {
			ownerMap, _ := o.(map[string]interface{})
			if ownerMap == nil {
				continue
			}
			kind, _ := ownerMap["kind"].(string)
			ownerName, _ := ownerMap["name"].(string)
			ownerUID, _ := ownerMap["uid"].(string)
			if kind != "Deployment" || ownerName != name {
				continue
			}
			if ownerUID == depUID || ownerUID == "" {
				ownedByThisDeployment = true
				break
			}
		}
		if !ownedByThisDeployment {
			continue
		}

		revStr, _ := getNestedString(rs.Object, "metadata", "annotations", deploymentRevisionAnnotation)
		revision, _ := strconv.Atoi(revStr)
		created, _ := getNestedString(rs.Object, "metadata", "creationTimestamp")
		changeCause, _ := getNestedString(rs.Object, "metadata", "annotations", changeCauseAnnotation)
		labels, _ := getNestedMap(rs.Object, "metadata", "labels")
		podTemplateHash := ""
		if labels != nil {
			if v, ok := labels[podTemplateHashLabel].(string); ok {
				podTemplateHash = v
			}
		}
		rsName, _ := getNestedString(rs.Object, "metadata", "name")

		status, _ := rs.Object["status"].(map[string]interface{})
		ready := int64(0)
		desired := int64(0)
		available := int64(0)
		if status != nil {
			if r, ok := status["readyReplicas"]; ok {
				ready, _ = toInt64(r)
			}
			if r, ok := status["replicas"]; ok {
				desired, _ = toInt64(r)
			}
			if r, ok := status["availableReplicas"]; ok {
				available, _ = toInt64(r)
			}
		}

		images := extractContainerImagesFromReplicaSet(rs.Object)

		entries = append(entries, RolloutHistoryEntry{
			Revision:          revision,
			CreationTimestamp: created,
			ChangeCause:       changeCause,
			PodTemplateHash:   podTemplateHash,
			Ready:             ready,
			Desired:           desired,
			Available:         available,
			Name:              rsName,
			Images:            images,
		})
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Revision < entries[j].Revision })

	// Compute rollout duration: time from this revision's creation until next revision (when this rollout was superseded).
	for i := 0; i < len(entries)-1; i++ {
		tCur, errCur := time.Parse(time.RFC3339, entries[i].CreationTimestamp)
		tNext, errNext := time.Parse(time.RFC3339, entries[i+1].CreationTimestamp)
		if errCur == nil && errNext == nil && tNext.After(tCur) {
			entries[i].DurationSeconds = int64(tNext.Sub(tCur).Seconds())
		}
	}

	// Logged via StructuredLog middleware
	w.Header().Set("X-Rollout-Source", "cluster")
	w.Header().Set("X-Revision-Count", strconv.Itoa(len(entries)))
	respondJSON(w, http.StatusOK, map[string]interface{}{"revisions": entries})
}

// RollbackRequest is the body for POST .../rollback
type RollbackRequest struct {
	Revision *int `json:"revision,omitempty"`
}

// PostDeploymentRollback handles POST /clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback
func (h *Handler) PostDeploymentRollback(w http.ResponseWriter, r *http.Request) {
	vars := GetPathVars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or name")
		return
	}

	ctx := r.Context()
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(ctx)
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	var req RollbackRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	dep, err := client.GetResource(ctx, "deployments", namespace, name)
	if err != nil {
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	depUID, _ := getNestedString(dep.Object, "metadata", "uid")
	rsList, err := client.ListResources(ctx, "replicasets", namespace, metav1.ListOptions{})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var ownedReplicaSets []*unstructured.Unstructured
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		owners, _ := getNestedSlice(rs.Object, "metadata", "ownerReferences")
		for _, o := range owners {
			ownerMap, _ := o.(map[string]interface{})
			if ownerMap == nil {
				continue
			}
			kind, _ := ownerMap["kind"].(string)
			ownerName, _ := ownerMap["name"].(string)
			ownerUID, _ := ownerMap["uid"].(string)
			if kind == "Deployment" && ownerName == name && ownerUID == depUID {
				ownedReplicaSets = append(ownedReplicaSets, rs)
				break
			}
		}
	}

	if len(ownedReplicaSets) == 0 {
		respondError(w, http.StatusBadRequest, "No ReplicaSets found for this deployment")
		return
	}

	sort.Slice(ownedReplicaSets, func(i, j int) bool {
		ri, _ := strconv.Atoi(getNestedStringSafe(ownedReplicaSets[i].Object, "metadata", "annotations", deploymentRevisionAnnotation))
		rj, _ := strconv.Atoi(getNestedStringSafe(ownedReplicaSets[j].Object, "metadata", "annotations", deploymentRevisionAnnotation))
		return ri < rj
	})

	var targetRS *unstructured.Unstructured
	if req.Revision != nil {
		for _, rs := range ownedReplicaSets {
			revStr := getNestedStringSafe(rs.Object, "metadata", "annotations", deploymentRevisionAnnotation)
			if revStr == strconv.Itoa(*req.Revision) {
				targetRS = rs
				break
			}
		}
		if targetRS == nil {
			respondError(w, http.StatusNotFound, "ReplicaSet for revision not found")
			return
		}
	} else {
		if len(ownedReplicaSets) < 2 {
			respondError(w, http.StatusBadRequest, "No previous revision to roll back to")
			return
		}
		targetRS = ownedReplicaSets[len(ownedReplicaSets)-2]
	}

	template, ok := targetRS.Object["spec"].(map[string]interface{})
	if !ok {
		template = make(map[string]interface{})
	}
	templateObj, _ := template["template"].(map[string]interface{})
	if templateObj == nil {
		respondError(w, http.StatusInternalServerError, "ReplicaSet has no pod template")
		return
	}

	templateCopy := deepCopyMap(templateObj)
	meta, _ := templateCopy["metadata"].(map[string]interface{})
	if meta == nil {
		meta = make(map[string]interface{})
		templateCopy["metadata"] = meta
	}
	ann, _ := meta["annotations"].(map[string]interface{})
	if ann == nil {
		ann = make(map[string]interface{})
		meta["annotations"] = ann
	}
	ann["kubectl.kubernetes.io/restartedAt"] = metav1.Now().Format("2006-01-02T15:04:05Z07:00")

	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": templateCopy,
		},
	}
	patchBytes, err := json.Marshal(patch)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to build rollback patch")
		return
	}

	updated, err := client.PatchResource(ctx, "deployments", namespace, name, patchBytes)
	requestID := logger.FromContext(r.Context())
	if err != nil {
		audit.LogMutation(requestID, clusterID, "rollback", "deployments", namespace, name, "failure", err.Error())
		// Error logged via StructuredLog middleware
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	audit.LogMutation(requestID, clusterID, "rollback", "deployments", namespace, name, "success", "")
	// Success logged via StructuredLog middleware
	w.Header().Set("X-Rollout-Source", "cluster")
	respondJSON(w, http.StatusOK, updated.Object)
}

// extractContainerImagesFromReplicaSet returns container image strings from a ReplicaSet's pod template, in order.
func extractContainerImagesFromReplicaSet(rsObject map[string]interface{}) []string {
	containers, ok := getNestedSlice(rsObject, "spec", "template", "spec", "containers")
	if !ok || len(containers) == 0 {
		return nil
	}
	images := make([]string, 0, len(containers))
	for _, c := range containers {
		cm, _ := c.(map[string]interface{})
		if cm == nil {
			continue
		}
		img, _ := cm["image"].(string)
		if img != "" {
			images = append(images, img)
		}
	}
	return images
}

func getNestedString(obj map[string]interface{}, keys ...string) (string, bool) {
	for i, key := range keys {
		if i == len(keys)-1 {
			v, ok := obj[key]
			if !ok {
				return "", false
			}
			s, ok := v.(string)
			return s, ok
		}
		next, ok := obj[key]
		if !ok {
			return "", false
		}
		obj, ok = next.(map[string]interface{})
		if !ok {
			return "", false
		}
	}
	return "", false
}

func getNestedStringSafe(obj map[string]interface{}, keys ...string) string {
	s, _ := getNestedString(obj, keys...)
	return s
}

func getNestedMap(obj map[string]interface{}, keys ...string) (map[string]interface{}, bool) {
	for i, key := range keys {
		v, ok := obj[key]
		if !ok {
			return nil, false
		}
		if i == len(keys)-1 {
			m, ok := v.(map[string]interface{})
			return m, ok
		}
		obj, ok = v.(map[string]interface{})
		if !ok {
			return nil, false
		}
	}
	return nil, false
}

func getNestedSlice(obj map[string]interface{}, keys ...string) ([]interface{}, bool) {
	for i, key := range keys {
		v, ok := obj[key]
		if !ok {
			return nil, false
		}
		if i == len(keys)-1 {
			sl, ok := v.([]interface{})
			return sl, ok
		}
		obj, ok = v.(map[string]interface{})
		if !ok {
			return nil, false
		}
	}
	return nil, false
}

func toInt64(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case int64:
		return n, true
	case int:
		return int64(n), true
	case int32:
		return int64(n), true
	case float64:
		return int64(n), true
	default:
		return 0, false
	}
}

func deepCopyMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		if vm, ok := v.(map[string]interface{}); ok {
			out[k] = deepCopyMap(vm)
		} else if sl, ok := v.([]interface{}); ok {
			out[k] = deepCopySlice(sl)
		} else {
			out[k] = v
		}
	}
	return out
}

func deepCopySlice(s []interface{}) []interface{} {
	out := make([]interface{}, len(s))
	for i, v := range s {
		if vm, ok := v.(map[string]interface{}); ok {
			out[i] = deepCopyMap(vm)
		} else if sl, ok := v.([]interface{}); ok {
			out[i] = deepCopySlice(sl)
		} else {
			out[i] = v
		}
	}
	return out
}
