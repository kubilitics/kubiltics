package events

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// StreamEvents handles Server-Sent Events (SSE) connections for real-time
// event streaming. Clients receive WideEvent objects as they are processed
// by the pipeline. An optional "namespace" query parameter filters events
// to a specific namespace.
func (h *EventsHandler) StreamEvents(w http.ResponseWriter, r *http.Request) {
	// Set SSE headers.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	// Use http.NewResponseController for flushing (works with wrapped ResponseWriters).
	rc := http.NewResponseController(w)
	flush := func() {
		_ = rc.Flush()
	}

	// Verify flushing works — if the underlying writer doesn't support it, fall back.
	if err := rc.Flush(); err != nil {
		// Fallback: try direct Flusher interface
		if f, ok := w.(http.Flusher); ok {
			flush = func() { f.Flush() }
		} else {
			// No flushing available — return empty SSE that stays open but doesn't stream.
			// Better than a 500 error which causes infinite reconnect loops.
			_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\",\"streaming\":false}\n\n")
			<-r.Context().Done()
			return
		}
	}

	// Subscribe to pipeline events.
	ch := h.subscriber.Subscribe()
	defer h.subscriber.Unsubscribe(ch)

	// Optional namespace filter.
	namespace := r.URL.Query().Get("namespace")

	// Send initial connection event.
	_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\"}\n\n")
	flush()

	for {
		select {
		case event, ok := <-ch:
			if !ok {
				// Channel closed (pipeline stopped).
				return
			}
			if namespace != "" && event.ResourceNamespace != namespace {
				continue
			}
			data, err := json.Marshal(event)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			flush()

		case <-r.Context().Done():
			// Client disconnected.
			return
		}
	}
}
