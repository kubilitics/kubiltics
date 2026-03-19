package engine

import "context"

// Package engine provides the Reasoning Orchestrator — the AI brain of kubilitics-ai.
//
// The Reasoning Engine coordinates the entire investigation lifecycle:
//   Trigger → Context Gathering → Hypothesis Generation → Tool Execution →
//   Validation → Conclusion → Action Proposal
//
// Responsibilities:
//   - Orchestrate the investigation workflow
//   - Manage investigation state machine (Created → Investigating → Concluded → Archived)
//   - Trigger proactive investigations based on anomalies detected by Analytics Engine
//   - Gather cluster context for each investigation (World Model + historical data)
//   - Coordinate with LLM via MCP Server for reasoning
//   - Implement Chain-of-Thought enforcement (transparent reasoning steps)
//   - Validate findings and confidence scores
//   - Generate conclusions and action proposals
//   - Manage investigation timeout and cancellation
//   - Persist investigation results for audit trail
//
// Investigation Lifecycle:
//
//   1. Trigger (via API, scheduled, or anomaly detection)
//      - REST API call: POST /api/v1/ai/investigations with description
//      - Scheduled: Periodic health checks, proactive monitoring
//      - Anomaly: Analytics Engine detects anomaly, triggers investigation
//
//   2. Context Gathering
//      - Collect relevant cluster state via World Model
//      - Retrieve historical data (metrics, events, logs)
//      - Query Backend for related resources
//      - Build context window respecting token budget
//      - Call Context Builder to assemble comprehensive context
//
//   3. Hypothesis Generation
//      - Send context to LLM via MCP Server
//      - LLM generates hypotheses (Chain-of-Thought: explain reasoning)
//      - Store hypotheses with confidence scores
//
//   4. Tool Execution
//      - LLM calls observation/analysis tools to test hypotheses
//      - MCP Server executes tools and returns results
//      - Update World Model with fresh data
//      - Accumulate findings
//
//   5. Validation
//      - Check findings consistency
//      - Verify confidence scores
//      - Ensure no contradictions in evidence
//
//   6. Conclusion
//      - LLM synthesizes findings into conclusion
//      - Root cause identification
//      - Impact assessment
//
//   7. Action Proposal
//      - LLM proposes actions (recommendations + execution tools if autonomy allows)
//      - Actions pass through Safety Engine
//      - Return to frontend for approval or auto-execute
//
// Chain-of-Thought Enforcement:
//   - Every step includes explicit reasoning explanation
//   - LLM must justify hypothesis selection
//   - Tool calls include rationale
//   - Findings include confidence/evidence
//   - Conclusions include supporting evidence
//   - Streamed to frontend via WebSocket for transparency
//
// Integration Points:
//   - MCP Server: Tool calls and LLM communication
//   - World Model: Cluster state queries
//   - Context Builder: Build investigation context
//   - Backend Proxy: Query kubilitics-backend
//   - Analytics Engine: Anomaly detection triggers
//   - Safety Engine: Validate action proposals
//   - Audit Logger: Record investigation
//   - Prompt Manager: Render investigation prompts
//
// Concurrency:
//   - Multiple investigations can run in parallel
//   - Each investigation has independent state
//   - Tool calls are serialized per investigation (no race conditions)
//   - Results cached to avoid redundant tool calls

// ReasoningEngine defines the interface for investigation orchestration.
type ReasoningEngine interface {
	// Investigate starts a new investigation with the given trigger description.
	// Returns investigation ID for tracking.
	// autonomyLevel: optional override (0 = use server default).
	Investigate(ctx context.Context, description string, investigationType string, autonomyLevel int) (string, error)

	// GetInvestigation retrieves the current state and findings of an investigation.
	GetInvestigation(ctx context.Context, id string) (interface{}, error)

	// CancelInvestigation cancels an in-progress investigation.
	CancelInvestigation(ctx context.Context, id string) error

	// ListInvestigations returns all investigations with optional filtering.
	ListInvestigations(ctx context.Context, filter interface{}) ([]interface{}, error)

	// SetLLMAdapter replaces the underlying LLM adapter at runtime.
	SetLLMAdapter(adapter LLMAdapterInterface)
}

// NewReasoningEngine creates a new reasoning engine.
// Use NewReasoningEngineWithDeps (engine_impl.go) for a fully wired implementation.
