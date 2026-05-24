// Package guardrails provides AI-layer safety controls for the MCP server.
//
// Three independent guardrails run on every ExecuteTool result:
//
//  1. Redactor — strips sensitive values (tokens, passwords, API keys) from
//     tool results before they reach the LLM context window.
//
//  2. InjectionScanner — detects prompt-injection payloads embedded in
//     Kubernetes resource names, annotations, or ConfigMap values and
//     neutralises them before they can hijack the LLM's instructions.
//
//  3. ToolCallBudget — enforces a per-session tool-call ceiling (default 50)
//     to break runaway agentic loops.
//
// Wire-up in the MCP server:
//
//	g := guardrails.New(guardrails.DefaultConfig())
//	// In ExecuteTool, after the handler returns:
//	result, err = g.Apply(ctx, toolName, result, err)
package guardrails

import (
	"context"
	"log"
)

// Config controls guardrail behaviour.
type Config struct {
	// MaxToolCallsPerSession is the session-wide tool call ceiling.
	// 0 disables the budget guard.
	MaxToolCallsPerSession int

	// EnableRedactor controls sensitive data scrubbing.
	EnableRedactor bool

	// EnableInjectionScanner controls prompt-injection detection.
	EnableInjectionScanner bool
}

// DefaultConfig returns a safe production configuration.
func DefaultConfig() Config {
	return Config{
		MaxToolCallsPerSession: 50,
		EnableRedactor:         true,
		EnableInjectionScanner: true,
	}
}

// Guardrails is the composed set of AI safety controls applied to every
// tool execution.  A single Guardrails instance is shared across all
// sessions; each session owns its own ToolCallBudget.
type Guardrails struct {
	cfg      Config
	redactor *Redactor
	scanner  *InjectionScanner
}

// New creates a Guardrails from the given Config.
func New(cfg Config) *Guardrails {
	g := &Guardrails{cfg: cfg}
	if cfg.EnableRedactor {
		g.redactor = NewRedactor()
	}
	if cfg.EnableInjectionScanner {
		g.scanner = NewInjectionScanner()
	}
	return g
}

// NewBudget returns a fresh ToolCallBudget for a new session.
// The caller (session or request handler) owns the lifetime of the budget.
func (g *Guardrails) NewBudget() *ToolCallBudget {
	return NewToolCallBudget(g.cfg.MaxToolCallsPerSession)
}

// Apply runs all enabled guardrails against a (result, err) pair from a
// tool handler.  It must be called for every ExecuteTool invocation.
//
//   - budget: the per-session ToolCallBudget (pass nil to skip budget checks).
//   - toolName: used for budget accounting and logging.
//   - result/err: the raw output from the tool handler.
//
// Returns the (possibly sanitised) result and error.  If a guardrail blocks
// the call, result is nil and err is non-nil.
func (g *Guardrails) Apply(
	ctx context.Context,
	budget *ToolCallBudget,
	toolName string,
	result interface{},
	handlerErr error,
) (interface{}, error) {
	// 1. Budget check — done before anything else so we don't do wasted work.
	if budget != nil {
		if err := budget.Check(toolName); err != nil {
			return nil, err
		}
	}

	// If the handler already failed, propagate the error without processing.
	if handlerErr != nil {
		return nil, handlerErr
	}

	// 2. Sensitive data redaction.
	if g.redactor != nil && result != nil {
		redacted, count := g.redactor.Redact(result)
		if count > 0 {
			log.Printf("[guardrails] redacted %d sensitive value(s) from %s output", count, toolName)
		}
		result = redacted
	}

	// 3. Prompt injection scan.
	if g.scanner != nil && result != nil {
		sr := g.scanner.Scan(result)
		if sr.Triggered {
			log.Printf("[guardrails] injection detected in %s output: %v", toolName, sr.Detections)
		}
		result = sr.Result
	}

	// 4. Consume budget on successful execution.
	if budget != nil {
		budget.Consume(toolName)
	}

	_ = ctx // reserved for future tracing/metrics hooks
	return result, nil
}
