package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
	"github.com/kubilitics/kubilitics-backend/internal/ai/types"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// upgrader accepts any origin; cross-origin enforcement happens upstream
// in the parent HTTP middleware (CORS + auth).
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// wsFrame is the envelope exchanged with the browser. Payload is opaque
// JSON whose shape depends on Type.
type wsFrame struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// userMessagePayload is what the client sends inside a "user_message" frame.
type userMessagePayload struct {
	SessionID   string `json:"session_id"`
	TurnID      string `json:"turn_id"`
	Text        string `json:"text"`
	ContextHint string `json:"context_hint"`
}

// GetChat upgrades the request to WebSocket and bridges it to the sidecar's
// bidirectional Chat gRPC stream. The cluster_id query parameter is required.
func (h *Handlers) GetChat(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.Enabled {
		http.Error(w, types.ErrAIDisabled.Error(), http.StatusServiceUnavailable)
		return
	}
	clusterID := r.URL.Query().Get("cluster_id")
	if clusterID == "" {
		http.Error(w, types.ErrMissingCluster.Error(), http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrader already wrote the HTTP error response.
		return
	}
	defer conn.Close()

	ctx := proxy.WithUser(r.Context(), userIDFromRequest(r))

	stream, _, err := h.pxy.Chat(ctx, clusterID, h.cfg.ChatMaxDuration)
	if err != nil {
		_ = conn.WriteJSON(wsFrame{Type: "error", Payload: jsonString(err.Error())})
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, err.Error()),
			time.Now().Add(2*time.Second),
		)
		return
	}

	// server -> client pump
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			ev, recvErr := stream.Recv()
			if recvErr != nil {
				_ = conn.WriteJSON(wsFrame{Type: "done", Payload: jsonString(recvErr.Error())})
				return
			}
			payload, _ := json.Marshal(ev)
			_ = conn.WriteJSON(wsFrame{Type: assistantEventType(ev), Payload: payload})
		}
	}()

	// client -> server pump
	for {
		var frame wsFrame
		if err := conn.ReadJSON(&frame); err != nil {
			break
		}
		switch frame.Type {
		case "user_message":
			var p userMessagePayload
			if err := json.Unmarshal(frame.Payload, &p); err != nil {
				_ = conn.WriteControl(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseUnsupportedData, "invalid user_message"),
					time.Now().Add(2*time.Second),
				)
				continue
			}
			_ = stream.Send(&kotgv1.UserMessage{
				SessionId:   p.SessionID,
				TurnId:      p.TurnID,
				Text:        p.Text,
				ContextHint: p.ContextHint,
			})
		default:
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseUnsupportedData, "unknown frame type"),
				time.Now().Add(2*time.Second),
			)
			// Stop reading; let server pump drain and close.
			_ = stream.CloseSend()
			<-done
			return
		}
	}

	// Client closed (or read error). Half-close the gRPC send side so the
	// sidecar finishes streaming, then wait for the recv pump to exit so the
	// guarded stream's closeOnce path fires DecStreams in the supervisor.
	_ = stream.CloseSend()
	<-done
}

// userIDFromRequest extracts the calling user from a header set by the
// outer auth middleware. Falls back to "anonymous" for unauthenticated dev.
func userIDFromRequest(r *http.Request) string {
	if uid := r.Header.Get("X-Kubilitics-User-ID"); uid != "" {
		return uid
	}
	return "anonymous"
}

// jsonString marshals s as a JSON string and returns it as RawMessage so it
// can be embedded in wsFrame.Payload without re-escaping.
func jsonString(s string) json.RawMessage {
	b, _ := json.Marshal(s)
	return b
}

// assistantEventType returns the lowercase oneof variant name for the
// AssistantEvent. Used as the WebSocket frame "type" tag so the frontend
// can demultiplex without re-parsing the payload. Variant names verified
// against ~/code/kotg-schema/gen/go/kotg/v1/chat.pb.go (oneof "event").
func assistantEventType(ev *kotgv1.AssistantEvent) string {
	switch ev.GetEvent().(type) {
	case *kotgv1.AssistantEvent_TextDelta:
		return "text_delta"
	case *kotgv1.AssistantEvent_ToolStart:
		return "tool_start"
	case *kotgv1.AssistantEvent_ToolEnd:
		return "tool_end"
	case *kotgv1.AssistantEvent_ActionPending:
		return "action_pending"
	case *kotgv1.AssistantEvent_PlanProposed:
		return "plan_proposed"
	case *kotgv1.AssistantEvent_Citation:
		return "citation"
	case *kotgv1.AssistantEvent_Error:
		return "error"
	case *kotgv1.AssistantEvent_Done:
		return "done"
	default:
		return "event"
	}
}
