package rest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// CreateDebugContainer handles POST /clusters/{clusterId}/resources/{namespace}/{pod}/debug
// Creates an ephemeral debug container in the target pod via the K8s API.
func (h *Handler) CreateDebugContainer(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	podName := vars["pod"]

	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(podName) {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId, namespace, or pod name", requestID)
		return
	}

	var req struct {
		Image           string   `json:"image"`
		TargetContainer string   `json:"targetContainer"`
		Command         []string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error(), requestID)
		return
	}
	if req.Image == "" {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusBadRequest, ErrCodeInvalidRequest, "image is required", requestID)
		return
	}
	if len(req.Command) == 0 {
		req.Command = []string{"/bin/sh"}
	}

	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	ctx := r.Context()
	requestID := logger.FromContext(ctx)

	// Generate unique ephemeral container name
	debugName := fmt.Sprintf("debugger-%d", time.Now().Unix())

	// Create ephemeral container spec
	ec := corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:    debugName,
			Image:   req.Image,
			Command: req.Command,
			Stdin:   true,
			TTY:     true,
		},
		TargetContainerName: req.TargetContainer,
	}

	// Get current pod
	pod, err := client.Clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		audit.LogMutation(requestID, clusterID, "debug", "pods", namespace, podName, "failure", err.Error())
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Append ephemeral container
	pod.Spec.EphemeralContainers = append(pod.Spec.EphemeralContainers, ec)

	// Update pod's ephemeral containers subresource
	_, err = client.Clientset.CoreV1().Pods(namespace).UpdateEphemeralContainers(
		ctx, podName, pod, metav1.UpdateOptions{},
	)
	if err != nil {
		audit.LogMutation(requestID, clusterID, "debug", "pods", namespace, podName, "failure", err.Error())
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	audit.LogMutation(requestID, clusterID, "debug", "pods", namespace, podName, "success", "")
	respondJSON(w, http.StatusCreated, map[string]string{
		"name":   debugName,
		"status": "created",
	})
}
