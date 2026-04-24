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
