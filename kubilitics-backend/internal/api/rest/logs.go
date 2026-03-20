package rest

import (
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetPodLogs handles GET /clusters/{clusterId}/logs/{namespace}/{pod}
// Streams pod logs from K8s API (container, tail, follow). B1.1.
func (h *Handler) GetPodLogs(w http.ResponseWriter, r *http.Request) {
	if h.logsService == nil {
		respondError(w, http.StatusNotImplemented, "Pod log streaming is not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]
	pod := vars["pod"]
	if !validate.ClusterID(clusterID) || !validate.Namespace(namespace) || !validate.Name(pod) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId, namespace, or pod")
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	container := r.URL.Query().Get("container")
	follow := r.URL.Query().Get("follow") == "true" || r.URL.Query().Get("follow") == "1"
	var tailLines int64
	if t := r.URL.Query().Get("tail"); t != "" {
		if n, err := strconv.ParseInt(t, 10, 64); err == nil && n > 0 {
			tailLines = n
		}
	}
	if tailLines == 0 {
		tailLines = 100
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); stream logs with it
	opts := &corev1.PodLogOptions{
		Container: container,
		Follow:    follow,
	}
	if tailLines > 0 {
		opts.TailLines = &tailLines
	}
	req := client.Clientset.CoreV1().Pods(namespace).GetLogs(pod, opts)
	stream, err := req.Stream(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, fmt.Errorf("failed to stream logs: %w", err).Error())
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	_, _ = io.Copy(w, stream)
}
