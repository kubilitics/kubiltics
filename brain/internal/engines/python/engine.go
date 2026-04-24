// Package python implements router.Engine against the LangGraph multi-agent
// stack in kotg.ai/kotg/ (Python). v1 (subproject 3d) ships the adapter
// shape — registration, lifecycle, error mapping — but does NOT yet
// communicate with a real Python sidecar. Real IPC (HTTP/gRPC to a
// kotg-py-server process) is scoped for v1.5.
//
// When wired, this engine handles "deep reasoning" requests (multi-step
// investigations, RAG-backed answers from cluster history, knowledge-graph
// queries) — paths that are too complex for direct LLM but don't need
// kagent's CRD-based agent runtime.
package python

import (
	"context"
	"fmt"

	"github.com/vellankikoti/kubilitics/brain/internal/router"
)

// Config controls how this Engine reaches the Python sidecar. v1 only
// uses Endpoint; v1.5 will add credentials, default workflow ID, etc.
type Config struct {
	// Endpoint is the Python sidecar's HTTP/gRPC URL. Empty disables
	// the engine — Stream returns a structured "unconfigured" error.
	Endpoint string

	// DefaultWorkflowID is the LangGraph workflow to invoke for requests
	// that don't carry an explicit workflow_id.
	DefaultWorkflowID string

	// TimeoutSeconds caps a single Stream call. 0 = no cap.
	TimeoutSeconds int
}

// Engine implements router.Engine. Construct via New.
type Engine struct {
	cfg Config
}

// New returns a Python-backed router.Engine. Caller registers it with
// router.New(...) alongside other engines.
func New(cfg Config) *Engine {
	return &Engine{cfg: cfg}
}

// Name is the engine identifier for picker logic + observability logs.
func (e *Engine) Name() string { return "python" }

// Configured reports whether the engine has enough config to actually
// dispatch.
func (e *Engine) Configured() bool { return e.cfg.Endpoint != "" }

// Stream invokes a LangGraph workflow for the request and translates its
// streaming output into router.Event values. v1 returns a structured
// error when unconfigured. v1.5 adds the real wire call.
func (e *Engine) Stream(ctx context.Context, req router.Request) (<-chan router.Event, error) {
	out := make(chan router.Event, 4)

	if !e.Configured() {
		out <- router.Event{
			Kind:    router.KindError,
			Code:    "python_unconfigured",
			Message: "python engine has no Endpoint configured; set CONFIG.AI.Engines.Python.Endpoint or use a different engine",
		}
		out <- router.Event{
			Kind:         router.KindDone,
			Partial:      true,
			FinishReason: "error",
		}
		close(out)
		return out, nil
	}

	// TODO(3d v1.5): real Python sidecar integration.
	//
	// Likely shape: HTTP/SSE call to {endpoint}/workflows/{workflow_id}/stream
	// with {input, session_id, focus_cluster_id}. Parse server-sent events
	// → translate LangGraph trace events to router.Event variants:
	//   - text → KindTextDelta
	//   - tool_call → KindToolStart / KindToolEnd
	//   - citation → KindCitation
	//   - reflection / "thinking" → optional KindTextDelta with style metadata
	//
	// Until then, configured-but-unimplemented returns a clear error.
	out <- router.Event{
		Kind:    router.KindError,
		Code:    "python_unimplemented",
		Message: fmt.Sprintf("python engine endpoint %q registered but real integration is scoped for v1.5", e.cfg.Endpoint),
	}
	out <- router.Event{
		Kind:         router.KindDone,
		Partial:      true,
		FinishReason: "error",
	}
	close(out)
	return out, nil
}
