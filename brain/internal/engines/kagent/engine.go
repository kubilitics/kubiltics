// Package kagent implements router.Engine against the CNCF kagent project
// (https://github.com/kagent-dev/kagent). v1 (subproject 3c) shipped only
// the adapter shape — registration, lifecycle, error mapping. v1.5 lands
// the real wire integration: an HTTP A2A client that POSTs to the kagent
// controller's /api/agents/.../conversations/{id}/messages endpoint and
// stream-parses the SSE response, translating each frame into the
// canonical router.Event vocabulary.
//
// Authentication: kagent's default mode is unsecure — the controller
// trusts the X-User-Id header to identify the caller. Set Config.UserID
// (or accept the default "kubilitics-ai"). Production deployments that
// front kagent with auth (OIDC, mTLS) should layer that at the
// HTTPClient transport level.
//
// Audit: each dispatch emits structured audit events via Config.Audit
// (audit.Logger). Nil is safe — the engine no-ops on missing logger.
package kagent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/router"
)

// Config controls how this Engine reaches kagent.
type Config struct {
	// Endpoint is the kagent controller's HTTP base URL, e.g.
	// "http://kagent-controller.kagent.svc:8083". Empty disables the
	// engine — Stream returns a structured "unconfigured" error so the
	// Router/UI can surface it instead of silently failing.
	Endpoint string

	// DefaultAgentID is the kagent Agent CRD name to invoke when the
	// request doesn't carry an explicit agent_id (e.g., "k8s-agent").
	DefaultAgentID string

	// Namespace of the kagent Agent CRD. Defaults to "kagent".
	Namespace string

	// UserID is the X-User-Id header value used for kagent's default
	// (unsecure) auth mode. Defaults to "kubilitics-ai".
	UserID string

	// RequestTimeout caps a single Stream call. Defaults to 120s.
	RequestTimeout time.Duration

	// HTTPClient is optional; if nil a client is constructed with
	// Timeout = RequestTimeout.
	HTTPClient *http.Client

	// Audit receives engine lifecycle events. Optional — nil is no-op.
	Audit audit.Logger
}

func (c Config) withDefaults() Config {
	if c.Namespace == "" {
		c.Namespace = "kagent"
	}
	if c.UserID == "" {
		c.UserID = "kubilitics-ai"
	}
	if c.RequestTimeout <= 0 {
		c.RequestTimeout = 120 * time.Second
	}
	if c.HTTPClient == nil {
		c.HTTPClient = &http.Client{Timeout: c.RequestTimeout}
	}
	return c
}

// Engine implements router.Engine. Construct via New.
type Engine struct {
	cfg Config
}

// New returns a kagent-backed router.Engine.
func New(cfg Config) *Engine {
	return &Engine{cfg: cfg.withDefaults()}
}

// Name is the engine identifier for picker logic + observability logs.
func (e *Engine) Name() string { return "kagent" }

// Configured reports whether the engine has enough config to actually dispatch.
func (e *Engine) Configured() bool { return e.cfg.Endpoint != "" }

// ─── Wire types ──────────────────────────────────────────────────────────

// a2aMessageRequest is the JSON-RPC body kagent expects on
// POST /api/agents/{ns}/{name}/conversations/{id}/messages.
type a2aMessageRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	Method  string         `json:"method"`
	ID      string         `json:"id"`
	Params  a2aSendParams  `json:"params"`
}

type a2aSendParams struct {
	Message a2aMessage `json:"message"`
}

type a2aMessage struct {
	Role      string    `json:"role"`
	Parts     []a2aPart `json:"parts"`
	MessageID string    `json:"messageId"`
}

// a2aPart is a single content part. kagent uses TextPart and DataPart.
// We use a permissive shape so we can both serialize outgoing TextParts
// AND deserialize incoming Text/Data parts.
type a2aPart struct {
	Kind     string                 `json:"kind,omitempty"`
	Text     string                 `json:"text,omitempty"`
	Data     map[string]interface{} `json:"data,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// a2aFrame is one streamed SSE frame: JSON-RPC envelope around a result
// payload that carries status + parts.
type a2aFrame struct {
	JSONRPC string                 `json:"jsonrpc,omitempty"`
	ID      string                 `json:"id,omitempty"`
	Result  *a2aFrameResult        `json:"result,omitempty"`
	Error   *a2aFrameError         `json:"error,omitempty"`
}

type a2aFrameError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type a2aFrameResult struct {
	Kind   string             `json:"kind,omitempty"`
	Status *a2aFrameStatus    `json:"status,omitempty"`
	// Some kagent frames inline the message under Status.Message.Parts;
	// others (artifact-update / message events) carry parts directly.
	Parts   []a2aPart          `json:"parts,omitempty"`
	Message *a2aFrameMessage   `json:"message,omitempty"`
	Final   bool               `json:"final,omitempty"`
}

type a2aFrameStatus struct {
	State   string           `json:"state,omitempty"`
	Message *a2aFrameMessage `json:"message,omitempty"`
}

type a2aFrameMessage struct {
	Role  string    `json:"role,omitempty"`
	Parts []a2aPart `json:"parts,omitempty"`
}

// ─── Stream ──────────────────────────────────────────────────────────────

// Stream invokes a kagent Agent for the request and translates its
// streaming output into router.Event values.
func (e *Engine) Stream(ctx context.Context, req router.Request) (<-chan router.Event, error) {
	out := make(chan router.Event, 16)

	if !e.Configured() {
		out <- router.Event{
			Kind:    router.KindError,
			Code:    "kagent_unconfigured",
			Message: "kagent engine has no Endpoint configured; set engines.kagent.endpoint or use a different engine",
		}
		out <- router.Event{
			Kind:         router.KindDone,
			Partial:      true,
			FinishReason: "error",
		}
		close(out)
		return out, nil
	}

	go e.run(ctx, req, out)
	return out, nil
}

func (e *Engine) run(ctx context.Context, req router.Request, out chan<- router.Event) {
	defer close(out)
	startedAt := time.Now()

	conversationID := strings.TrimSpace(req.SessionID)
	if conversationID == "" {
		conversationID = uuid.NewString()
	}

	// Build the JSON-RPC request body.
	body := a2aMessageRequest{
		JSONRPC: "2.0",
		Method:  "message/send",
		ID:      uuid.NewString(),
		Params: a2aSendParams{
			Message: a2aMessage{
				Role: "user",
				Parts: []a2aPart{{
					Kind: "text",
					Text: req.Text,
				}},
				MessageID: uuid.NewString(),
			},
		},
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		emit(ctx, out, router.Event{Kind: router.KindError, Code: "kagent_marshal", Message: err.Error()})
		emit(ctx, out, router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"})
		return
	}

	url := fmt.Sprintf("%s/api/agents/%s/%s/conversations/%s/messages",
		strings.TrimRight(e.cfg.Endpoint, "/"),
		e.cfg.Namespace, e.cfg.DefaultAgentID, conversationID)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		emit(ctx, out, router.Event{Kind: router.KindError, Code: "kagent_request_build", Message: err.Error()})
		emit(ctx, out, router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("X-User-Id", e.cfg.UserID)

	e.auditDispatchStart(ctx, req, conversationID, len(req.Text))

	resp, err := e.cfg.HTTPClient.Do(httpReq)
	if err != nil {
		// Distinguish cancellation from real network error.
		if ctx.Err() != nil {
			emit(ctx, out, router.Event{
				Kind: router.KindDone, Partial: true, Cancelled: true, FinishReason: "cancel",
			})
			e.auditDispatchEnd(ctx, req, conversationID, 0, 0, time.Since(startedAt), "cancel")
			return
		}
		emit(ctx, out, router.Event{Kind: router.KindError, Code: "kagent_http_error", Message: err.Error()})
		emit(ctx, out, router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"})
		e.auditDispatchEnd(ctx, req, conversationID, 0, 0, time.Since(startedAt), "error")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		// Read at most 8 KiB of the body for the error message — kagent
		// tends to return short JSON errors but we don't want to balloon
		// memory if it returns a stack trace.
		buf, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
		emit(ctx, out, router.Event{
			Kind:    router.KindError,
			Code:    fmt.Sprintf("kagent_http_%d", resp.StatusCode),
			Message: strings.TrimSpace(string(buf)),
		})
		emit(ctx, out, router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"})
		e.auditDispatchEnd(ctx, req, conversationID, 0, 0, time.Since(startedAt), "error")
		return
	}

	// Stream-parse SSE frames.
	textChunks, toolCalls, finishReason := e.parseSSE(ctx, req, conversationID, resp.Body, out)

	// Emit terminal Done if the stream didn't already do it via a state=completed/failed frame.
	// Done is best-effort delivered: if ctx is cancelled the receiver may
	// have already torn down, but channel buffer (16) usually carries it.
	if finishReason == "" {
		if ctx.Err() != nil {
			emitTerminal(out, router.Event{
				Kind: router.KindDone, Partial: true, Cancelled: true, FinishReason: "cancel",
			})
			finishReason = "cancel"
		} else {
			emitTerminal(out, router.Event{Kind: router.KindDone, FinishReason: "stop"})
			finishReason = "stop"
		}
	}

	e.auditDispatchEnd(ctx, req, conversationID, textChunks, toolCalls, time.Since(startedAt), finishReason)
}

// parseSSE reads `data: {json}` frames from r, translates each into
// router.Events, and writes them to out. Returns counters for audit.
func (e *Engine) parseSSE(
	ctx context.Context,
	req router.Request,
	conversationID string,
	r io.Reader,
	out chan<- router.Event,
) (textChunks, toolCalls int, finishReason string) {
	scanner := bufio.NewScanner(r)
	// Allow large frames — tool results can carry pod logs.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	// Track tool starts so function_response can pair with function_call.
	toolStartTimes := map[string]time.Time{}
	pendingCallIDs := []string{} // FIFO fallback when response carries no call_id

	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		line := scanner.Text()
		// Skip empty lines + non-data lines (event:, id:, retry:).
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}

		var frame a2aFrame
		if err := json.Unmarshal([]byte(payload), &frame); err != nil {
			// Malformed frame — log via audit, keep streaming.
			continue
		}
		if frame.Error != nil {
			emit(ctx, out, router.Event{
				Kind:    router.KindError,
				Code:    fmt.Sprintf("kagent_jsonrpc_%d", frame.Error.Code),
				Message: frame.Error.Message,
			})
			continue
		}
		if frame.Result == nil {
			continue
		}

		// Collect parts from either status.message.parts or top-level parts/message.
		var parts []a2aPart
		var state string
		if frame.Result.Status != nil {
			state = frame.Result.Status.State
			if frame.Result.Status.Message != nil {
				parts = append(parts, frame.Result.Status.Message.Parts...)
			}
		}
		if frame.Result.Message != nil {
			parts = append(parts, frame.Result.Message.Parts...)
		}
		if len(frame.Result.Parts) > 0 {
			parts = append(parts, frame.Result.Parts...)
		}

		for _, p := range parts {
			switch {
			case p.Text != "" && (p.Kind == "" || p.Kind == "text"):
				textChunks++
				emit(ctx, out, router.Event{Kind: router.KindTextDelta, Text: p.Text})

			case p.Data != nil:
				dataType, _ := getString(p.Metadata, "type")
				switch dataType {
				case "function_call":
					callID, _ := getString(p.Data, "id")
					if callID == "" {
						callID, _ = getString(p.Metadata, "id")
					}
					if callID == "" {
						callID = uuid.NewString()
					}
					name, _ := getString(p.Data, "name")
					if name == "" {
						name, _ = getString(p.Metadata, "name")
					}
					argsPreview := compactJSON(p.Data["args"])
					toolCalls++
					toolStartTimes[callID] = time.Now()
					pendingCallIDs = append(pendingCallIDs, callID)
					e.auditToolStart(ctx, req, conversationID, name, callID, len(argsPreview))
					emit(ctx, out, router.Event{
						Kind:       router.KindToolStart,
						ToolCallID: callID,
						ToolName:   name,
						Preview:    argsPreview,
					})

				case "function_response":
					callID, _ := getString(p.Data, "id")
					if callID == "" {
						callID, _ = getString(p.Metadata, "id")
					}
					if callID == "" && len(pendingCallIDs) > 0 {
						callID = pendingCallIDs[0]
						pendingCallIDs = pendingCallIDs[1:]
					} else if callID != "" {
						// Drop matched call from pending list.
						for i, id := range pendingCallIDs {
							if id == callID {
								pendingCallIDs = append(pendingCallIDs[:i], pendingCallIDs[i+1:]...)
								break
							}
						}
					}
					name, _ := getString(p.Data, "name")
					if name == "" {
						name, _ = getString(p.Metadata, "name")
					}
					resultPreview := compactJSON(p.Data["response"])
					if resultPreview == "" {
						resultPreview = compactJSON(p.Data["result"])
					}
					ok := true
					if v, found := p.Data["error"]; found && v != nil && v != "" {
						ok = false
					}
					var dur time.Duration
					if t, found := toolStartTimes[callID]; found {
						dur = time.Since(t)
						delete(toolStartTimes, callID)
					}
					e.auditToolEnd(ctx, req, conversationID, name, callID, ok, len(resultPreview), dur)
					emit(ctx, out, router.Event{
						Kind:       router.KindToolEnd,
						ToolCallID: callID,
						ToolName:   name,
						OK:         ok,
						Preview:    resultPreview,
					})
				}
			}
		}

		// Terminal-state handling.
		switch state {
		case "input_required":
			// kagent is asking for user input (action approval).
			proposalID, _ := getString(frame.Result.Status.Message.parsableMetadata(), "proposal_id")
			actionType, _ := getString(frame.Result.Status.Message.parsableMetadata(), "action_type")
			summary := firstText(parts)
			if proposalID == "" {
				proposalID = uuid.NewString()
			}
			if actionType == "" {
				actionType = "kagent_action"
			}
			emit(ctx, out, router.Event{
				Kind:       router.KindActionPending,
				ProposalID: proposalID,
				ActionType: actionType,
				Summary:    summary,
			})

		case "failed":
			msg := firstText(parts)
			if msg == "" {
				msg = "kagent reported failure"
			}
			emit(ctx, out, router.Event{
				Kind:    router.KindError,
				Code:    "kagent_failed",
				Message: msg,
			})
			emit(ctx, out, router.Event{
				Kind: router.KindDone, Partial: true, FinishReason: "error",
			})
			finishReason = "error"
			return

		case "completed":
			emit(ctx, out, router.Event{Kind: router.KindDone, FinishReason: "stop"})
			finishReason = "stop"
			return

		case "cancelled":
			emit(ctx, out, router.Event{
				Kind: router.KindDone, Partial: true, Cancelled: true, FinishReason: "cancel",
			})
			finishReason = "cancel"
			return
		}
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		emit(ctx, out, router.Event{Kind: router.KindError, Code: "kagent_stream_read", Message: err.Error()})
	}
	return
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// emit forwards an Event but yields to ctx cancellation rather than blocking forever.
func emit(ctx context.Context, out chan<- router.Event, ev router.Event) {
	select {
	case out <- ev:
	case <-ctx.Done():
	}
}

// emitTerminal forwards the final Done/Error event with a non-blocking
// send fallback. Used for the synthesized Done at end-of-Stream — we
// MUST deliver it (or drop it) without observing ctx, so cancelled
// streams still see the cancel-Done frame from the buffered channel.
func emitTerminal(out chan<- router.Event, ev router.Event) {
	select {
	case out <- ev:
	default:
		// Channel full or no receiver. Defer close still fires; the
		// receiver will see channel-closed which router treats as
		// terminal. Best we can do without unbounded buffering.
	}
}

func getString(m map[string]interface{}, key string) (string, bool) {
	if m == nil {
		return "", false
	}
	v, ok := m[key]
	if !ok || v == nil {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

// compactJSON returns a short, human-readable JSON encoding of v for
// preview purposes. Truncates at 512 chars.
func compactJSON(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return truncate(s, 512)
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return truncate(string(b), 512)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// firstText returns the first text part's content, or "".
func firstText(parts []a2aPart) string {
	for _, p := range parts {
		if p.Text != "" {
			return p.Text
		}
	}
	return ""
}

// parsableMetadata returns the message-level metadata map if any was
// flattened into the message envelope. kagent puts proposal_id /
// action_type into Message.Metadata in v1.5+; older builds may put them
// in the first DataPart.Metadata. We handle both — the helper just
// returns nil if no metadata is present so getString degrades to "".
func (m *a2aFrameMessage) parsableMetadata() map[string]interface{} {
	if m == nil {
		return nil
	}
	for _, p := range m.Parts {
		if p.Metadata != nil {
			if t, _ := getString(p.Metadata, "type"); t == "action_proposal" {
				return p.Metadata
			}
		}
	}
	// Fallback: scan all parts for any metadata that looks like an action proposal.
	for _, p := range m.Parts {
		if p.Metadata != nil {
			if _, ok := p.Metadata["proposal_id"]; ok {
				return p.Metadata
			}
		}
	}
	return nil
}

// ─── Audit helpers (nil-safe) ────────────────────────────────────────────

func (e *Engine) auditDispatchStart(ctx context.Context, req router.Request, conversationID string, promptChars int) {
	if e.cfg.Audit == nil {
		return
	}
	ev := audit.NewEvent(audit.EventType("engine.kagent.dispatch_start")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithResult(audit.ResultPending).
		WithMetadata("agent_id", e.cfg.DefaultAgentID).
		WithMetadata("conversation_id", conversationID).
		WithMetadata("user_id", e.cfg.UserID).
		WithMetadata("prompt_chars", promptChars).
		WithMetadata("session_id", req.SessionID)
	_ = e.cfg.Audit.Log(ctx, ev)
}

func (e *Engine) auditDispatchEnd(ctx context.Context, req router.Request, conversationID string, textChunks, toolCallsTotal int, dur time.Duration, finishReason string) {
	if e.cfg.Audit == nil {
		return
	}
	result := audit.ResultSuccess
	if finishReason == "error" {
		result = audit.ResultFailure
	}
	ev := audit.NewEvent(audit.EventType("engine.kagent.dispatch_end")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithResult(result).
		WithDuration(dur).
		WithMetadata("conversation_id", conversationID).
		WithMetadata("text_chunks", textChunks).
		WithMetadata("tool_calls_total", toolCallsTotal).
		WithMetadata("total_duration_ms", dur.Milliseconds()).
		WithMetadata("finish_reason", finishReason)
	_ = e.cfg.Audit.Log(ctx, ev)
}

func (e *Engine) auditToolStart(ctx context.Context, req router.Request, conversationID, toolName, callID string, argsChars int) {
	if e.cfg.Audit == nil {
		return
	}
	ev := audit.NewEvent(audit.EventType("engine.kagent.tool_start")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithAction(toolName).
		WithResult(audit.ResultPending).
		WithMetadata("conversation_id", conversationID).
		WithMetadata("tool_name", toolName).
		WithMetadata("tool_args_chars", argsChars).
		WithMetadata("call_id", callID)
	_ = e.cfg.Audit.Log(ctx, ev)
}

func (e *Engine) auditToolEnd(ctx context.Context, req router.Request, conversationID, toolName, callID string, ok bool, resultChars int, dur time.Duration) {
	if e.cfg.Audit == nil {
		return
	}
	result := audit.ResultSuccess
	if !ok {
		result = audit.ResultFailure
	}
	ev := audit.NewEvent(audit.EventType("engine.kagent.tool_end")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithAction(toolName).
		WithResult(result).
		WithDuration(dur).
		WithMetadata("conversation_id", conversationID).
		WithMetadata("tool_name", toolName).
		WithMetadata("ok", ok).
		WithMetadata("result_chars", resultChars).
		WithMetadata("call_id", callID).
		WithMetadata("duration_ms", dur.Milliseconds())
	_ = e.cfg.Audit.Log(ctx, ev)
}
