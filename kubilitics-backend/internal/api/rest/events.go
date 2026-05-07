package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics-backend/internal/api/resilient"
	"github.com/kubilitics/kubilitics-backend/internal/models"
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

// GetEvents handles GET /clusters/{clusterId}/events.
// Lists Kubernetes events (namespace, limit). Optional: involvedObjectKind +
// involvedObjectName for pod-scoped events. B1.2.
//
// Post-Phase-4 wire shape: the resilient envelope
//   {data:{...}, reachable, stale, error_message, stale_as_of, health_status}.
// Three historical response shapes live under `.data`:
//   - pod-scoped / all-namespaces branches: bare []*models.Event array.
//   - single-namespace paginated branch:    {items, metadata}.
// See eventsResponse.MarshalJSON for the dispatch.
//
// Transient apiserver errors are downgraded to HTTP 200 + reachable:false,
// preserving the last-known events from the per-(cluster|query) LRU when
// one exists. Genuine 404 (unknown cluster) still returns HTTP 404.
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

	wrapper := resilient.WrapClusterHandler[eventsResponse](
		h.eventsLRU,
		func(req *http.Request) string {
			vv := mux.Vars(req)
			q := req.URL.Query()
			return vv["clusterId"] + "|" +
				q.Get("namespace") + "|" +
				q.Get("involvedObjectKind") + "|" +
				q.Get("involvedObjectName") + "|" +
				q.Get("limit") + "|" +
				q.Get("continue")
		},
		func(ctx context.Context, req *http.Request) (eventsResponse, error) {
			return h.buildEvents(ctx, req)
		},
	)
	wrapper(w, r)
}

// buildEvents fetches the events payload for the current request. Returning
// a non-nil error signals an unreachable/transient condition; the wrapper
// downgrades that to 200 + reachable:false. The special-case HTTP 404 for
// unknown clusters is handled here directly (not all errors are transient).
func (h *Handler) buildEvents(ctx context.Context, r *http.Request) (eventsResponse, error) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster.
	_, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		// Preserve the legacy 404 behavior for unknown clusters — but wrap into a
		// pseudo-transient to let the resilient envelope flow. The caller maps
		// this to reachable:false. Callers who truly care about 404 read
		// error_message in the envelope.
		return eventsResponse{}, err
	}

	namespace := r.URL.Query().Get("namespace")
	const defaultLimit = 100
	const maxLimit = 500
	limit := defaultLimit
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, perr := strconv.Atoi(l); perr == nil && n > 0 {
			if n > maxLimit {
				n = maxLimit
			}
			limit = n
		}
	}
	involvedObjectKind := r.URL.Query().Get("involvedObjectKind")
	involvedObjectName := r.URL.Query().Get("involvedObjectName")
	eventType := r.URL.Query().Get("type")   // "Warning", "Normal", or "" for all
	sinceParam := r.URL.Query().Get("since") // duration string: "1h", "30m", "24h" etc.

	var sinceTime *time.Time
	if sinceParam != "" {
		if d, err := time.ParseDuration(sinceParam); err == nil {
			t := time.Now().UTC().Add(-d)
			sinceTime = &t
		}
	}

	// filterEvents applies optional type and since filters to an event slice.
	filterEvents := func(events []*models.Event) []*models.Event {
		if eventType == "" && sinceTime == nil {
			return events
		}
		out := events[:0:0]
		for _, e := range events {
			if eventType != "" && e.Type != eventType {
				continue
			}
			if sinceTime != nil && !e.LastTimestamp.IsZero() && e.LastTimestamp.Before(*sinceTime) {
				continue
			}
			out = append(out, e)
		}
		return out
	}

	// Pod-scoped (or any resource) events: last N events for the resource.
	if involvedObjectKind != "" && involvedObjectName != "" {
		ns := namespace
		if ns == "" || ns == "*" || ns == "_all" {
			ns = "default"
		}
		events, err := h.eventsService.GetResourceEvents(ctx, clusterID, ns, involvedObjectKind, involvedObjectName)
		if err != nil {
			return eventsResponse{}, err
		}
		events = filterEvents(events)
		sortEventsByLastTimestampDesc(events)
		if len(events) > limit {
			events = events[:limit]
		}
		return eventsResponse{PodOnly: events}, nil
	}

	// All namespaces.
	if namespace == "" || namespace == "*" || namespace == "_all" {
		// Fetch more than limit before filtering so time/type filters don't
		// reduce an already-truncated set. Cap at 500 to stay bounded.
		fetchLimit := limit
		if sinceTime != nil || eventType != "" {
			fetchLimit = 500
		}

		// Prefer informer cache (avoids 6 live K8s API fan-out calls).
		var events []*models.Event
		usedCache := false
		if im := h.clusterService.GetInformerManager(clusterID); im != nil && im.HasSynced() {
			if cached, ok := im.ListFromCache("events", "", metav1.ListOptions{Limit: int64(fetchLimit)}); ok {
				usedCache = true
				if cached != nil {
					for _, u := range cached.Items {
						var ev corev1.Event
						if err2 := fromUnstructured(u.Object, &ev); err2 == nil {
							events = append(events, k8sEventToWorkloadModel(&ev))
						}
					}
				}
			}
		}
		if !usedCache {
			var liveErr error
			events, liveErr = h.eventsService.ListEventsAllNamespaces(ctx, clusterID, fetchLimit)
			if liveErr != nil {
				return eventsResponse{}, liveErr
			}
		}
		events = filterEvents(events)
		if len(events) > limit {
			events = events[:limit]
		}
		return eventsResponse{PodOnly: events}, nil
	}

	// Single namespace: paginated. Fetch extra when filtering so the caller
	// sees up to `limit` results after the since/type filter is applied.
	fetchLimit := int64(limit)
	if sinceTime != nil || eventType != "" {
		fetchLimit = 500
	}
	opts := metav1.ListOptions{Limit: fetchLimit}
	if continueToken := r.URL.Query().Get("continue"); continueToken != "" {
		opts.Continue = continueToken
	}
	listMeta, events, err := h.eventsService.ListEvents(ctx, clusterID, namespace, opts)
	if err != nil {
		return eventsResponse{}, err
	}
	events = filterEvents(events)
	if len(events) > limit {
		events = events[:limit]
	}
	total := int64(len(events))
	if listMeta != nil && listMeta.GetRemainingItemCount() != nil {
		total = int64(len(events)) + *listMeta.GetRemainingItemCount()
	}
	continueToken := ""
	if listMeta != nil {
		continueToken = listMeta.GetContinue()
	}
	meta := map[string]any{
		"continue": continueToken,
		"total":    total,
	}
	if listMeta != nil && listMeta.GetRemainingItemCount() != nil {
		meta["remainingItemCount"] = *listMeta.GetRemainingItemCount()
	}
	return eventsResponse{Items: events, Metadata: meta}, nil
}

