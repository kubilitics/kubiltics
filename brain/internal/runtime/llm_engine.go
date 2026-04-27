// llmEngine wraps the existing LLMAdapterBridge as a router.Engine. v1 ships
// with this as the only engine; 3c/3d add kagent/Python engines alongside it.
//
// As of feat/llm-tools-wired the engine takes a tool-aware path when the
// underlying provider satisfies LLMToolProvider. CompleteWithTools drives
// the multi-turn agentic loop and the engine translates each
// runtime.toolStreamEvent to canonical router.Event values:
//
//	TextToken                       → KindTextDelta
//	tool{phase=calling}             → KindToolStart
//	tool{phase=result}              → KindToolEnd ok=true
//	tool{phase=error}               → KindToolEnd ok=false (+ optional KindError)
//	Done                            → KindDone finish_reason=stop
//	Err                             → KindError + KindDone partial=true
//
// Per-iteration audit events mirror the kagent engine (engine.llm.dispatch_*,
// engine.llm.tool_*) so the bench tool and observability stack see one
// unified vocabulary regardless of which engine ran the turn.
package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/router"
)


// llmEngine adapts an LLMProvider to router.Engine.
type llmEngine struct {
	llm       LLMProvider
	toolsLLM  LLMToolProvider // optional: drives the agentic loop when set
	toolCount int             // for audit metadata only
	audit     audit.Logger    // optional: nil-safe
}

// EngineOption configures NewLLMEngine.
type EngineOption func(*llmEngine)

// WithToolProvider enables the tool-using path. The bridge MUST also have
// Tools+Executor set (the engine itself doesn't see them — it just streams
// the resulting events). toolCount is recorded in audit metadata so we can
// confirm the LLM saw the expected taxonomy.
func WithToolProvider(p LLMToolProvider, toolCount int) EngineOption {
	return func(e *llmEngine) {
		e.toolsLLM = p
		e.toolCount = toolCount
	}
}

// WithAudit attaches an audit logger. Nil-safe — engine no-ops without one.
func WithAudit(l audit.Logger) EngineOption {
	return func(e *llmEngine) { e.audit = l }
}

// NewLLMEngine returns an Engine that streams events from a single LLM
// provider call. With WithToolProvider the engine drives the agentic loop;
// without it the engine falls back to text-only StreamCompletion (preserves
// existing v1 behavior + tests).
func NewLLMEngine(llm LLMProvider, opts ...EngineOption) router.Engine {
	e := &llmEngine{llm: llm}
	for _, o := range opts {
		o(e)
	}
	return e
}

func (e *llmEngine) Name() string { return "llm" }

func (e *llmEngine) Stream(ctx context.Context, req router.Request) (<-chan router.Event, error) {
	out := make(chan router.Event, 16)

	prompt := req.Text
	if req.ContextHint != "" {
		prompt = req.Text + "\n\n[context: " + req.ContextHint + "]"
	}

	if e.toolsLLM != nil {
		go e.runWithTools(ctx, req, prompt, out)
		return out, nil
	}

	// Text-only fallback (legacy path).
	tokens, err := e.llm.StreamCompletion(ctx, prompt)
	if err != nil {
		out <- router.Event{Kind: router.KindError, Code: "llm_error", Message: err.Error()}
		out <- router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"}
		close(out)
		return out, nil
	}

	go func() {
		defer close(out)
		var partial bool
		for chunk := range tokens {
			if ctx.Err() != nil {
				partial = true
				break
			}
			select {
			case out <- router.Event{Kind: router.KindTextDelta, Text: chunk}:
			case <-ctx.Done():
				partial = true
			}
			if partial {
				break
			}
		}
		finish := "stop"
		if partial {
			finish = "cancel"
		}
		out <- router.Event{
			Kind:         router.KindDone,
			Partial:      partial,
			Cancelled:    partial,
			FinishReason: finish,
		}
	}()
	return out, nil
}

// runWithTools is the agentic-loop path. It consumes the tool-stream channel
// from the bridge, translates each event to router.Event, and emits per-tool
// audit telemetry on the side.
func (e *llmEngine) runWithTools(ctx context.Context, req router.Request, prompt string, out chan<- router.Event) {
	defer close(out)
	startedAt := time.Now()
	e.auditDispatchStart(ctx, req, len(prompt))

	src, err := e.toolsLLM.StreamCompletionWithTools(ctx, req.FocusClusterID, prompt)
	if err != nil {
		emit(ctx, out, router.Event{Kind: router.KindError, Code: "llm_error", Message: err.Error()})
		emit(ctx, out, router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"})
		e.auditDispatchEnd(ctx, req, 0, 0, time.Since(startedAt), "error")
		return
	}

	textChunks := 0
	toolCallsTotal := 0
	finishReason := ""
	toolStartTimes := map[string]time.Time{}
	// Capture the last TokenUsage the adapter emits before the stream
	// closes so we can surface real token counts on the terminal Done
	// event. Previously this was only consumed by the internal cost
	// tally and never reached the frontend, which is why the chat UI
	// has been rendering "0 → 0 tokens" on every turn.
	var lastPromptTokens, lastCompletionTokens int32

	for ev := range src {
		if ctx.Err() != nil {
			finishReason = "cancel"
			break
		}
		if ev.TokenUsage != nil {
			// Adapter reports usage as `int` (could be cumulative across
			// turns in multi-turn agentic loops). Keep the last one we
			// see — that's the adapter's final accounting for this turn.
			lastPromptTokens = int32(ev.TokenUsage.InputTokens)
			lastCompletionTokens = int32(ev.TokenUsage.OutputTokens)
		}
		switch {
		case ev.Err != nil:
			emit(ctx, out, router.Event{Kind: router.KindError, Code: "llm_error", Message: ev.Err.Error()})
			emit(ctx, out, router.Event{Kind: router.KindDone, Partial: true, FinishReason: "error"})
			finishReason = "error"
			e.auditDispatchEnd(ctx, req, textChunks, toolCallsTotal, time.Since(startedAt), finishReason)
			// Drain to unblock producer.
			go func() {
				for range src {
				}
			}()
			return

		case ev.Done:
			// Producer signalled end-of-loop. We synthesise the terminal
			// Done below (after the range loop) so cancellation paths and
			// natural completion converge.

		case ev.Tool != nil:
			t := ev.Tool
			argsPreview := compactArgs(t.Args)
			switch t.Phase {
			case "calling":
				toolCallsTotal++
				toolStartTimes[t.CallID] = time.Now()
				e.auditToolStart(ctx, req, t.ToolName, t.CallID, len(argsPreview))
				emit(ctx, out, router.Event{
					Kind:       router.KindToolStart,
					ToolCallID: t.CallID,
					ToolName:   t.ToolName,
					Preview:    argsPreview,
				})
			case "result":
				preview := truncate(t.Result, 512)
				dur := durationSince(toolStartTimes, t.CallID)
				e.auditToolEnd(ctx, req, t.ToolName, t.CallID, true, len(preview), dur)
				emit(ctx, out, router.Event{
					Kind:       router.KindToolEnd,
					ToolCallID: t.CallID,
					ToolName:   t.ToolName,
					OK:         true,
					Preview:    preview,
				})
			case "error":
				preview := truncate(t.Error, 512)
				dur := durationSince(toolStartTimes, t.CallID)
				e.auditToolEnd(ctx, req, t.ToolName, t.CallID, false, len(preview), dur)
				emit(ctx, out, router.Event{
					Kind:       router.KindToolEnd,
					ToolCallID: t.CallID,
					ToolName:   t.ToolName,
					OK:         false,
					Preview:    preview,
				})
			}

		case ev.RenderBlock != nil:
			emit(ctx, out, router.Event{
				Kind:          router.KindRenderBlock,
				RenderType:    ev.RenderBlock.Type,
				RenderData:    ev.RenderBlock.Data,
				RenderSummary: ev.RenderBlock.Summary,
			})

		case ev.TextToken != "":
			textChunks++
			emit(ctx, out, router.Event{Kind: router.KindTextDelta, Text: ev.TextToken})
		}
	}

	if finishReason == "" {
		if ctx.Err() != nil {
			finishReason = "cancel"
		} else {
			finishReason = "stop"
		}
	}
	emit(ctx, out, router.Event{
		Kind:             router.KindDone,
		Partial:          finishReason != "stop",
		Cancelled:        finishReason == "cancel",
		FinishReason:     finishReason,
		PromptTokens:     lastPromptTokens,
		CompletionTokens: lastCompletionTokens,
		DurationMs:       time.Since(startedAt).Milliseconds(),
	})
	e.auditDispatchEnd(ctx, req, textChunks, toolCallsTotal, time.Since(startedAt), finishReason)
}

// ─── Helpers ─────────────────────────────────────────────────────────────

func emit(ctx context.Context, out chan<- router.Event, ev router.Event) {
	select {
	case out <- ev:
	case <-ctx.Done():
	}
}

func compactArgs(args map[string]interface{}) (s string) {
	if len(args) == 0 {
		return ""
	}
	// This is a debug-only helper. A provider can hand us arg maps that
	// json.Marshal panics on (non-string-keyed nested maps, cycles, etc.).
	// A panic here would crash the whole agent process mid-stream — and
	// this value only drives log/trace output, never control flow. Swallow.
	defer func() {
		if r := recover(); r != nil {
			s = fmt.Sprintf("(unmarshalable args: %v)", r)
		}
	}()
	b, err := json.Marshal(args)
	if err != nil {
		return fmt.Sprintf("(marshal err: %v)", err)
	}
	return truncate(string(b), 512)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func durationSince(starts map[string]time.Time, id string) time.Duration {
	t, ok := starts[id]
	if !ok {
		return 0
	}
	delete(starts, id)
	return time.Since(t)
}

// ─── Audit (nil-safe) ────────────────────────────────────────────────────

func (e *llmEngine) auditDispatchStart(ctx context.Context, req router.Request, promptChars int) {
	if e.audit == nil {
		return
	}
	ev := audit.NewEvent(audit.EventType("engine.llm.dispatch_start")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithResult(audit.ResultPending).
		WithMetadata("session_id", req.SessionID).
		WithMetadata("prompt_chars", promptChars).
		WithMetadata("tools_count", e.toolCount)
	_ = e.audit.Log(ctx, ev)
}

func (e *llmEngine) auditDispatchEnd(ctx context.Context, req router.Request, textChunks, toolCallsTotal int, dur time.Duration, finishReason string) {
	if e.audit == nil {
		return
	}
	result := audit.ResultSuccess
	if finishReason == "error" {
		result = audit.ResultFailure
	}
	ev := audit.NewEvent(audit.EventType("engine.llm.dispatch_end")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithResult(result).
		WithDuration(dur).
		WithMetadata("text_chunks", textChunks).
		WithMetadata("tool_calls_total", toolCallsTotal).
		WithMetadata("total_duration_ms", dur.Milliseconds()).
		WithMetadata("finish_reason", finishReason)
	_ = e.audit.Log(ctx, ev)
}

func (e *llmEngine) auditToolStart(ctx context.Context, req router.Request, toolName, callID string, argsChars int) {
	if e.audit == nil {
		return
	}
	ev := audit.NewEvent(audit.EventType("engine.llm.tool_start")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithAction(toolName).
		WithResult(audit.ResultPending).
		WithMetadata("tool_name", toolName).
		WithMetadata("tool_args_chars", argsChars).
		WithMetadata("call_id", callID)
	_ = e.audit.Log(ctx, ev)
}

func (e *llmEngine) auditToolEnd(ctx context.Context, req router.Request, toolName, callID string, ok bool, resultChars int, dur time.Duration) {
	if e.audit == nil {
		return
	}
	result := audit.ResultSuccess
	if !ok {
		result = audit.ResultFailure
	}
	ev := audit.NewEvent(audit.EventType("engine.llm.tool_end")).
		WithCorrelationID(req.TurnID).
		WithUser(req.UserID).
		WithResource(req.FocusClusterID, "cluster").
		WithAction(toolName).
		WithResult(result).
		WithDuration(dur).
		WithMetadata("tool_name", toolName).
		WithMetadata("ok", ok).
		WithMetadata("result_chars", resultChars).
		WithMetadata("call_id", callID).
		WithMetadata("duration_ms", dur.Milliseconds())
	_ = e.audit.Log(ctx, ev)
}
