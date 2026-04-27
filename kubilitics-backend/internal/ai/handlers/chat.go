package handlers

import (
	"encoding/json"
	"errors"
	"io"
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

// cancelTurnPayload is sent by the client to abort a turn server-side.
type cancelTurnPayload struct {
	SessionID string `json:"session_id"`
	TurnID    string `json:"turn_id"`
}

// GetChat upgrades the request to WebSocket and bridges it to the runtime's
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
	defer func() { _ = conn.Close() }()

	ctx := proxy.WithUser(r.Context(), userIDFromRequest(r))

	stream, err := h.pxy.Send(ctx, clusterID)
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
				// Natural end-of-stream: the brain finished sending and
				// closed the gRPC stream. The brain should have emitted
				// its own AssistantEvent_Done frame before this point;
				// don't synthesize another one. Exit cleanly.
				if errors.Is(recvErr, io.EOF) {
					return
				}
				// Real stream error (gRPC Unavailable, Canceled, brain
				// crashed mid-stream, safety guard rejected, adapter
				// nil, etc.). Previously this was silently converted
				// to a bogus done frame with a string payload where
				// prompt_tokens/completion_tokens were supposed to be
				// — the frontend rendered it as "0 → 0 tokens · 7ms"
				// with no visible error. Send a real error frame so
				// the UI surfaces WHY the chat failed.
				errPayload, _ := json.Marshal(map[string]any{
					"code":    "stream_error",
					"message": recvErr.Error(),
				})
				_ = conn.WriteJSON(wsFrame{Type: "error", Payload: errPayload})
				return
			}
			payload, _ := json.Marshal(assistantEventPayload(ev))
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
		case "cancel_turn":
			var p cancelTurnPayload
			if err := json.Unmarshal(frame.Payload, &p); err != nil {
				continue
			}
			_ = h.pxy.CancelTurn(ctx, clusterID, p.SessionID, p.TurnID)
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
	// runtime finishes streaming, then wait for the recv pump to exit.
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

// assistantEventPayload flattens an AssistantEvent oneof into the flat
// JSON shape the frontend chatStore parses (see src/services/ai/protocol.ts
// and src/stores/chatStore.ts). Marshalling the proto directly produces
// nested {anchor_id, Event: {ToolStart: {...}}} which the store doesn't
// recognize — tool_call_id reads as undefined, tool_end never matches its
// tool_start, text_delta drops, and the UI rendering falls through to the
// stuck-spinner finalizer. Keep this function in sync with the frontend's
// payload types when fields are added to the proto.
func assistantEventPayload(ev *kotgv1.AssistantEvent) map[string]interface{} {
	p := map[string]interface{}{
		"anchor_id": ev.GetAnchorId(),
	}
	switch inner := ev.GetEvent().(type) {
	case *kotgv1.AssistantEvent_TextDelta:
		p["text"] = inner.TextDelta.GetText()
	case *kotgv1.AssistantEvent_ToolStart:
		p["tool_call_id"] = inner.ToolStart.GetToolCallId()
		p["tool_name"] = inner.ToolStart.GetToolName()
		p["preview"] = inner.ToolStart.GetPreview()
	case *kotgv1.AssistantEvent_ToolEnd:
		p["tool_call_id"] = inner.ToolEnd.GetToolCallId()
		p["ok"] = inner.ToolEnd.GetOk()
		p["preview"] = inner.ToolEnd.GetPreview()
	case *kotgv1.AssistantEvent_ActionPending:
		p["proposal_id"] = inner.ActionPending.GetProposalId()
		p["tier"] = int32(inner.ActionPending.GetTier())
		p["summary"] = inner.ActionPending.GetSummary()
		if d := inner.ActionPending.GetDiff(); d != nil {
			p["diff"] = d
		}
	case *kotgv1.AssistantEvent_PlanProposed:
		p["plan_id"] = inner.PlanProposed.GetPlanId()
		p["summary"] = inner.PlanProposed.GetSummary()
		p["step_count"] = inner.PlanProposed.GetStepCount()
	case *kotgv1.AssistantEvent_Citation:
		p["tool_call_id"] = inner.Citation.GetToolCallId()
		p["short_label"] = inner.Citation.GetShortLabel()
		p["assistant_text_anchor_id"] = inner.Citation.GetAssistantTextAnchorId()
	case *kotgv1.AssistantEvent_Error:
		// Error frames in the frontend protocol use flat {code, message} at
		// the payload root — no anchor_id, so reset the map.
		return map[string]interface{}{
			"code":    inner.Error.GetCode(),
			"message": inner.Error.GetMessage(),
		}
	case *kotgv1.AssistantEvent_Done:
		p["prompt_tokens"] = inner.Done.GetPromptTokens()
		p["completion_tokens"] = inner.Done.GetCompletionTokens()
		p["finish_reason"] = inner.Done.GetFinishReason()
		p["partial"] = inner.Done.GetPartial()
	case *kotgv1.AssistantEvent_RenderBlock:
		// Opaque passthrough. Backend MUST NOT unmarshal or mutate
		// render.data — the bytes belong to the brain's shaper and
		// flow byte-equal to the frontend renderer.
		rb := inner.RenderBlock
		p["render"] = map[string]interface{}{
			"type": rb.GetType(),
			// Wrap as json.RawMessage so the JSON encoder forwards
			// the bytes without re-encoding (which would base64 a []byte).
			"data": json.RawMessage(rb.GetData()),
		}
		p["summary"] = rb.GetSummary()
	}
	return p
}

// assistantEventType returns the lowercase oneof variant name for the
// AssistantEvent. Used as the WebSocket frame "type" tag so the frontend
// can demultiplex without re-parsing the payload.
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
	case *kotgv1.AssistantEvent_RenderBlock:
		return "render_block"
	default:
		return "event"
	}
}
