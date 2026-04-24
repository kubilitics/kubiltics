// Package router dispatches a chat turn to one of several engines (LLM-direct,
// kagent, Python multi-agent, …). v1 ships with one engine (LLM-direct);
// 3c adds kagent and 3d adds Python — both as Engine implementations
// registered with router.New(...). The Router interface stays stable so
// Chat.Send doesn't change as new engines arrive.
//
// The Output Normalizer rule (every engine emits identical AssistantEvent
// streams) is enforced at the Engine boundary: each Engine returns a
// channel of canonical Event values that the runtime maps 1:1 to
// kotg-schema's AssistantEvent oneof variants.
package router

import "context"

// EventKind distinguishes streamed unit kinds, mirroring AssistantEvent's
// oneof variants. v1 uses only KindTextDelta + KindDone + KindError;
// future engines (kagent, multi-agent) may emit ToolStart/ToolEnd/
// ActionPending/PlanProposed/Citation.
type EventKind int

const (
	KindTextDelta EventKind = iota
	KindToolStart
	KindToolEnd
	KindActionPending
	KindPlanProposed
	KindCitation
	KindDone
	KindError
)

// Event is the canonical streamed unit. Each engine emits these; the
// runtime maps them to kotg-schema's AssistantEvent variants. Kept
// flexible so future variants don't require interface changes.
type Event struct {
	Kind         EventKind
	Text         string            // KindTextDelta
	ToolCallID   string            // KindToolStart / KindToolEnd
	ToolName     string            // KindToolStart
	Preview      string            // KindToolStart / KindToolEnd
	OK           bool              // KindToolEnd
	ProposalID   string            // KindActionPending
	ActionType   string            // KindActionPending
	Target       string            // KindActionPending
	DryRun       string            // KindActionPending
	PlanID       string            // KindPlanProposed
	StepCount    int               // KindPlanProposed
	Summary      string            // KindActionPending / KindPlanProposed
	AnchorID     string            // KindCitation
	Label        string            // KindCitation
	FinishReason string            // KindDone
	Partial      bool              // KindDone
	Cancelled    bool              // KindDone
	Code         string            // KindError
	Message      string            // KindError
	Extra        map[string]string // engine-specific extras (logged, never surfaced)
}

// Request carries everything an Engine needs for one chat turn.
type Request struct {
	SessionID      string
	TurnID         string
	FocusClusterID string
	UserID         string
	Text           string
	ContextHint    string
}

// Engine is what each runtime backend (LLM, kagent, Python) implements.
// Stream emits canonical Events; closes the channel on success/error/cancel.
// Engines MUST stop when ctx is cancelled.
type Engine interface {
	Name() string
	// Stream returns a receive channel; closes it exactly once on terminal.
	Stream(ctx context.Context, req Request) (<-chan Event, error)
}
