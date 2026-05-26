package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// AI service metrics for production monitoring
var (
	// Investigation metrics
	InvestigationsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_investigations_total",
			Help: "Total number of investigations started",
		},
		[]string{"type", "status"},
	)

	InvestigationDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "kubilitics_ai_investigation_duration_seconds",
			Help:    "Investigation duration in seconds",
			Buckets: prometheus.ExponentialBuckets(1, 2, 10), // 1s to ~17min
		},
		[]string{"type"},
	)

	// LLM metrics
	LLMRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_llm_requests_total",
			Help: "Total number of LLM API requests",
		},
		[]string{"provider", "model", "status"},
	)

	LLMTokensUsed = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_llm_tokens_total",
			Help: "Total number of LLM tokens consumed",
		},
		[]string{"provider", "model", "type"}, // type: input/output
	)

	LLMCostUSD = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_llm_cost_usd_total",
			Help: "Total LLM cost in USD",
		},
		[]string{"provider", "model"},
	)

	LLMRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "kubilitics_ai_llm_request_duration_seconds",
			Help:    "LLM request duration in seconds",
			Buckets: prometheus.ExponentialBuckets(0.1, 2, 10), // 100ms to ~1min
		},
		[]string{"provider", "model"},
	)

	// Budget metrics
	BudgetUsageUSD = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "kubilitics_ai_budget_usage_usd",
			Help: "Current budget usage in USD",
		},
		[]string{"user_id", "month"},
	)

	BudgetLimitUSD = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "kubilitics_ai_budget_limit_usd",
			Help: "Budget limit in USD",
		},
		[]string{"user_id"},
	)

	BudgetExceeded = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_budget_exceeded_total",
			Help: "Total number of budget limit exceeded events",
		},
		[]string{"user_id"},
	)

	// Safety metrics
	SafetyPolicyEvaluations = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_safety_evaluations_total",
			Help: "Total number of safety policy evaluations",
		},
		[]string{"policy", "result"}, // result: allow/deny/request_approval
	)

	SafetyBlocked = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_safety_blocked_total",
			Help: "Total number of actions blocked by safety policies",
		},
		[]string{"policy", "action_type"},
	)

	// MCP tool metrics
	MCPToolCalls = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_mcp_tool_calls_total",
			Help: "Total number of MCP tool calls",
		},
		[]string{"tool", "status"},
	)

	MCPToolDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "kubilitics_ai_mcp_tool_duration_seconds",
			Help:    "MCP tool execution duration in seconds",
			Buckets: prometheus.ExponentialBuckets(0.01, 2, 10), // 10ms to ~10s
		},
		[]string{"tool"},
	)

	// ── Phase 8: Tool-hardening observability ────────────────────────────────

	// Certification gate — emitted every time the gate blocks a destructive call.
	CertGateBlocks = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_cert_gate_blocks_total",
			Help: "Total calls blocked by the certification gate (destructive + uncertified tools).",
		},
		[]string{"tool"},
	)

	// MCPToolCallsByGrade tracks execution volume grouped by certification grade
	// so operators can watch the Certified ratio grow over time.
	MCPToolCallsByGrade = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_mcp_tool_calls_by_grade_total",
			Help: "MCP tool calls broken down by certification grade (certified/provisional/uncertified).",
		},
		[]string{"tool", "grade"},
	)

	// Guardrail — redaction.
	GuardrailRedactions = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_guardrail_redactions_total",
			Help: "Tool results where at least one sensitive value was redacted.",
		},
		[]string{"tool"},
	)

	GuardrailRedactedValues = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_guardrail_redacted_values_total",
			Help: "Total sensitive values (key matches + regex hits) redacted from tool results.",
		},
		[]string{"tool"},
	)

	// Guardrail — injection scanner.
	GuardrailInjectionBlocks = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_guardrail_injection_blocks_total",
			Help: "Prompt-injection patterns detected and neutralised in tool results.",
		},
		[]string{"tool", "pattern"},
	)

	// Guardrail — tool-call budget (MCP session budget, not LLM token budget).
	MCPBudgetExhausted = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_mcp_budget_exhausted_total",
			Help: "Times the per-session MCP tool-call budget was exhausted.",
		},
		[]string{"tool"},
	)

	// Execution — idempotency guard.
	IdempotencyHits = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_idempotency_hits_total",
			Help: "Duplicate destructive tool calls intercepted by the idempotency guard.",
		},
		[]string{"tool"},
	)

	// Execution — timeout.
	ExecutionTimeouts = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_execution_timeouts_total",
			Help: "Execution tool calls that were cancelled by the per-autonomy-level deadline.",
		},
		[]string{"tool"},
	)

	// ── End Phase 8 ───────────────────────────────────────────────────────────

	// WebSocket metrics
	WebSocketConnections = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "kubilitics_ai_websocket_connections",
			Help: "Current number of active WebSocket connections",
		},
	)

	WebSocketMessagesTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_websocket_messages_total",
			Help: "Total number of WebSocket messages",
		},
		[]string{"direction"}, // direction: inbound/outbound
	)

	// gRPC client metrics
	GRPCStreamActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "kubilitics_ai_grpc_stream_active",
			Help: "Whether gRPC stream to backend is active (1=active, 0=inactive)",
		},
	)

	GRPCReconnects = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_grpc_reconnects_total",
			Help: "Total number of gRPC reconnection attempts",
		},
	)

	GRPCEventsReceived = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "kubilitics_ai_grpc_events_received_total",
			Help: "Total number of cluster state events received via gRPC",
		},
	)
)
