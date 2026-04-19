// Package kagent implements router.Engine against the CNCF kagent project
// (https://github.com/kagent-dev/kagent). v1 (subproject 3c) ships the
// adapter shape — registration, lifecycle, error mapping — but does NOT
// yet make real API calls to kagent's controller. The real wire integration
// is scoped for v1.5 once we've decided whether kubilitics-ai talks to
// kagent via its HTTP API or by creating Agent CRDs in K8s.
package kagent

import (
	"context"
	"fmt"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/router"
)

// Config controls how this Engine reaches kagent. v1 only uses Endpoint and
// AgentID; v1.5 will add Namespace, ModelConfig, ToolServerRefs, etc.
type Config struct {
	// Endpoint is the kagent controller's HTTP/gRPC URL. Empty disables
	// the engine — Stream returns a structured "unconfigured" error so
	// the Router/UI can surface it instead of silently failing.
	Endpoint string

	// DefaultAgentID is the kagent Agent CRD name to invoke when the
	// request doesn't carry an explicit agent_id (e.g., "diagnose-pod").
	// Empty + Endpoint set is acceptable: per-request agent_id required.
	DefaultAgentID string

	// Timeout caps a single Stream call. 0 = no cap.
	TimeoutSeconds int
}

// Engine implements router.Engine. Construct via New.
type Engine struct {
	cfg Config
}

// New returns a kagent-backed router.Engine. Caller registers it with
// router.New(...) alongside the LLM-direct engine.
func New(cfg Config) *Engine {
	return &Engine{cfg: cfg}
}

// Name is the engine identifier for picker logic + observability logs.
func (e *Engine) Name() string { return "kagent" }

// Configured reports whether the engine has enough config to actually
// dispatch. PickFunc implementations can use this to skip unconfigured
// engines instead of dispatching and getting an error.
func (e *Engine) Configured() bool { return e.cfg.Endpoint != "" }

// Stream invokes a kagent Agent for the request and translates its
// streaming output into router.Event values. v1 returns a structured
// error when unconfigured. v1.5 adds the real wire call.
func (e *Engine) Stream(ctx context.Context, req router.Request) (<-chan router.Event, error) {
	out := make(chan router.Event, 4)

	if !e.Configured() {
		out <- router.Event{
			Kind:    router.KindError,
			Code:    "kagent_unconfigured",
			Message: "kagent engine has no Endpoint configured; set CONFIG.AI.Engines.Kagent.Endpoint or use a different engine",
		}
		out <- router.Event{
			Kind:         router.KindDone,
			Partial:      true,
			FinishReason: "error",
		}
		close(out)
		return out, nil
	}

	// TODO(3c v1.5): real kagent integration.
	//
	// Two viable paths, picked once we have kagent installed in a dev
	// cluster:
	//   (a) HTTP API: POST {endpoint}/run with {agent_id, input, session_id};
	//       parse SSE / NDJSON stream → translate ADK events to router.Event.
	//   (b) K8s CRD: kubectl-style create AgentRun (or invoke an existing
	//       Agent CRD) and watch status → emit router.Event as status fields
	//       update. Declarative; integrates with kagent's controller lifecycle.
	//
	// Until then, configured-but-unimplemented returns a clear error so
	// the wire is honest about what's available.
	out <- router.Event{
		Kind:    router.KindError,
		Code:    "kagent_unimplemented",
		Message: fmt.Sprintf("kagent engine endpoint %q registered but real integration is scoped for v1.5", e.cfg.Endpoint),
	}
	out <- router.Event{
		Kind:         router.KindDone,
		Partial:      true,
		FinishReason: "error",
	}
	close(out)
	return out, nil
}
