package rest

import (
	"encoding/json"
	"net/http"

	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// CordonNodeRequest is the request body for cordon/uncordon.
type CordonNodeRequest struct {
	Unschedulable bool `json:"unschedulable"`
}

// CordonNode handles POST /clusters/{clusterId}/nodes/{name}/cordon
// It sets spec.unschedulable on the node to cordon or uncordon it.
func (h *Handler) CordonNode(w http.ResponseWriter, r *http.Request) {
	vars := GetPathVars(r)
	clusterID := vars["clusterId"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId or name")
		return
	}

	var req CordonNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	ctx := r.Context()
	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"unschedulable": req.Unschedulable,
		},
	}
	patchBytes, err := json.Marshal(patch)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to build patch")
		return
	}

	requestID := logger.FromContext(r.Context())
	action := "cordon"
	if !req.Unschedulable {
		action = "uncordon"
	}

	updated, err := client.PatchResource(ctx, "nodes", "", name, patchBytes)
	if err != nil {
		audit.LogMutation(requestID, clusterID, action, "nodes", "", name, "failure", err.Error())
		if apierrors.IsNotFound(err) {
			respondError(w, http.StatusNotFound, err.Error())
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	audit.LogMutation(requestID, clusterID, action, "nodes", "", name, "success", "")
	respondJSON(w, http.StatusOK, updated.Object)
}

// DrainNodeRequest is the request body for node drain.
type DrainNodeRequest struct {
	// GracePeriodSeconds for pod termination (-1 = use pod default).
	GracePeriodSeconds int64 `json:"gracePeriodSeconds"`
	// Force deletes pods that cannot be evicted (e.g. not managed by a controller).
	Force bool `json:"force"`
	// IgnoreDaemonSets skips DaemonSet-managed pods (default true).
	IgnoreDaemonSets *bool `json:"ignoreDaemonSets,omitempty"`
}

// DrainNodeResponse is the result of a drain operation.
type DrainNodeResponse struct {
	Evicted []string `json:"evicted"`
	Skipped []string `json:"skipped"`
	Errors  []string `json:"errors"`
}

// DrainNode handles POST /clusters/{clusterId}/nodes/{name}/drain
// It cordons the node then evicts all eligible pods.
func (h *Handler) DrainNode(w http.ResponseWriter, r *http.Request) {
	vars := GetPathVars(r)
	clusterID := vars["clusterId"]
	name := vars["name"]

	if !validate.ClusterID(clusterID) || !validate.Name(name) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId or name")
		return
	}

	var req DrainNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Default: ignore DaemonSet pods
	ignoreDaemonSets := true
	if req.IgnoreDaemonSets != nil {
		ignoreDaemonSets = *req.IgnoreDaemonSets
	}

	ctx := r.Context()
	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	// Step 1: Cordon the node first.
	cordonPatch, _ := json.Marshal(map[string]interface{}{
		"spec": map[string]interface{}{"unschedulable": true},
	})
	if _, err := client.PatchResource(ctx, "nodes", "", name, cordonPatch); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to cordon node: "+err.Error())
		return
	}

	// Step 2: List pods scheduled on this node.
	podList, err := client.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + name,
	})
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list pods on node: "+err.Error())
		return
	}

	resp := DrainNodeResponse{
		Evicted: []string{},
		Skipped: []string{},
		Errors:  []string{},
	}

	gracePeriod := req.GracePeriodSeconds
	if gracePeriod == 0 {
		gracePeriod = -1 // use pod's own terminationGracePeriodSeconds
	}

	for _, pod := range podList.Items {
		podKey := pod.Namespace + "/" + pod.Name

		// Skip completed/succeeded/failed pods.
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			resp.Skipped = append(resp.Skipped, podKey+" (terminal)")
			continue
		}

		// Skip DaemonSet-managed pods if ignoreDaemonSets.
		if ignoreDaemonSets {
			isDaemonSet := false
			for _, owner := range pod.OwnerReferences {
				if owner.Kind == "DaemonSet" {
					isDaemonSet = true
					break
				}
			}
			if isDaemonSet {
				resp.Skipped = append(resp.Skipped, podKey+" (daemonset)")
				continue
			}
		}

		// Skip mirror pods (static pods).
		if _, isMirror := pod.Annotations["kubernetes.io/config.mirror"]; isMirror {
			resp.Skipped = append(resp.Skipped, podKey+" (mirror pod)")
			continue
		}

		// Check if pod is managed by a controller; if Force is false and not managed, skip.
		if !req.Force && len(pod.OwnerReferences) == 0 {
			resp.Skipped = append(resp.Skipped, podKey+" (no controller, use force=true)")
			continue
		}

		// Evict the pod.
		eviction := &policyv1.Eviction{
			ObjectMeta: metav1.ObjectMeta{
				Name:      pod.Name,
				Namespace: pod.Namespace,
			},
		}
		if gracePeriod >= 0 {
			eviction.DeleteOptions = &metav1.DeleteOptions{
				GracePeriodSeconds: &gracePeriod,
			}
		}

		if err := client.Clientset.CoreV1().Pods(pod.Namespace).EvictV1(ctx, eviction); err != nil {
			if req.Force {
				// Force delete if eviction fails.
				delOpts := metav1.DeleteOptions{}
				if gracePeriod >= 0 {
					delOpts.GracePeriodSeconds = &gracePeriod
				}
				if delErr := client.Clientset.CoreV1().Pods(pod.Namespace).Delete(ctx, pod.Name, delOpts); delErr != nil {
					resp.Errors = append(resp.Errors, podKey+": "+delErr.Error())
					continue
				}
				resp.Evicted = append(resp.Evicted, podKey+" (force deleted)")
			} else {
				resp.Errors = append(resp.Errors, podKey+": "+err.Error())
			}
			continue
		}
		resp.Evicted = append(resp.Evicted, podKey)
	}

	requestID := logger.FromContext(r.Context())
	audit.LogMutation(requestID, clusterID, "drain", "nodes", "", name, "success",
		"evicted="+joinStrings(resp.Evicted)+", errors="+joinStrings(resp.Errors))
	respondJSON(w, http.StatusOK, resp)
}

func joinStrings(ss []string) string {
	if len(ss) == 0 {
		return "none"
	}
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += ","
		}
		result += s
	}
	return result
}
