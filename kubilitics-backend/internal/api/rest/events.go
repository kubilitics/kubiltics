package rest

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// eventsResponse is the shape returned under .data of the resilient envelope
// for GET /clusters/{clusterId}/events. Mirrors the previous untyped
// map[string]any response shape so the frontend (.data) reads identical fields.
type eventsResponse struct {
	Items    []*models.Event   `json:"items"`
	Metadata map[string]any    `json:"metadata,omitempty"`
	// PodOnly is used for the resource-scoped branch, which historically
	// returned a bare []*models.Event. Non-empty signals the pod-scoped shape;
	// in that case Items/Metadata are nil and the marshalled JSON uses PodOnly
	// as the inlined payload. See the MarshalJSON override below.
	PodOnly []*models.Event `json:"-"`
}

// MarshalJSON preserves the legacy shape-per-branch behavior while living
// inside the resilient envelope's Data field.
func (e eventsResponse) MarshalJSON() ([]byte, error) {
	if e.PodOnly != nil {
		return json.Marshal(e.PodOnly)
	}
	type envelope struct {
		Items    []*models.Event `json:"items"`
		Metadata map[string]any  `json:"metadata,omitempty"`
	}
	return json.Marshal(envelope{Items: e.Items, Metadata: e.Metadata})
}

// sortEventsByLastTimestampDesc sorts events by LastTimestamp descending (most recent first).
func sortEventsByLastTimestampDesc(events []*models.Event) {
	sort.Slice(events, func(i, j int) bool {
		return events[i].LastTimestamp.After(events[j].LastTimestamp)
	})
}

// GetEvents handles GET /clusters/{clusterId}/events
// Lists Kubernetes events (namespace, limit). Optional: involvedObjectKind + involvedObjectName for pod-scoped events. B1.2.
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	if h.eventsService == nil {
		respondError(w, http.StatusNotImplemented, "Kubernetes events are not configured")
		return
	}

	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	_, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}
	// Events service uses clusterID (resolved internally for stored clusters; for kubeconfig-per-request same clusterID is used as identifier)
	namespace := r.URL.Query().Get("namespace")
	// BE-FUNC-002: Pagination support for events
	const defaultLimit = 100
	const maxLimit = 500
	limit := defaultLimit
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			if n > maxLimit {
				n = maxLimit
			}
			limit = n
		}
	}
	involvedObjectKind := r.URL.Query().Get("involvedObjectKind")
	involvedObjectName := r.URL.Query().Get("involvedObjectName")

	if involvedObjectKind != "" && involvedObjectName != "" {
		ns := namespace
		if ns == "" || ns == "*" || ns == "_all" {
			ns = "default"
		}
		// Pod-scoped (or any resource) events: last N events for the resource (most recent first)
		// Note: GetResourceEvents doesn't support pagination yet (uses fieldSelector)
		// For Headlamp/Lens: use clusterID as identifier (events service needs updating separately)
		events, err := h.eventsService.GetResourceEvents(r.Context(), clusterID, ns, involvedObjectKind, involvedObjectName)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sortEventsByLastTimestampDesc(events)
		if len(events) > limit {
			events = events[:limit]
		}
		respondJSON(w, http.StatusOK, events)
		return
	}

	// All namespaces: namespace empty, "*", or "_all" (no pagination support for multi-namespace)
	if namespace == "" || namespace == "*" || namespace == "_all" {
		// For Headlamp/Lens: use clusterID as identifier (events service needs updating separately)
		events, err := h.eventsService.ListEventsAllNamespaces(r.Context(), clusterID, limit)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, events)
		return
	}

	// Single namespace: BE-FUNC-002 pagination support
	opts := metav1.ListOptions{Limit: int64(limit)}
	if continueToken := r.URL.Query().Get("continue"); continueToken != "" {
		opts.Continue = continueToken
	}
	// For Headlamp/Lens: use clusterID as identifier (events service needs updating separately)
	listMeta, events, err := h.eventsService.ListEvents(r.Context(), clusterID, namespace, opts)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Return pagination metadata
	total := int64(len(events))
	if listMeta != nil && listMeta.GetRemainingItemCount() != nil {
		total = int64(len(events)) + *listMeta.GetRemainingItemCount()
	}
	continueToken := ""
	if listMeta != nil {
		continueToken = listMeta.GetContinue()
	}
	meta := map[string]interface{}{
		"continue": continueToken,
		"total":    total,
	}
	if listMeta != nil && listMeta.GetRemainingItemCount() != nil {
		meta["remainingItemCount"] = *listMeta.GetRemainingItemCount()
	}
	out := map[string]interface{}{
		"items":    events,
		"metadata": meta,
	}
	respondJSON(w, http.StatusOK, out)
}
