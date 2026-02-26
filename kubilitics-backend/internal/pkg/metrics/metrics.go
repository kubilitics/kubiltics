// Package metrics provides Prometheus metrics for Kubilitics backend (RED + topology + WebSocket).
// Enterprise-grade: scrapeable /metrics; runbooks and dashboards can rely on these names.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const namespace = "kubilitics"

var (
	// HTTPRequestTotal counts requests by method, path, status (RED: rate).
	HTTPRequestTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "http_requests_total",
			Help:      "Total number of HTTP requests by method, path, and status.",
		},
		[]string{"method", "path", "status"},
	)

	// HTTPRequestDurationSeconds is request latency histogram (RED: duration).
	HTTPRequestDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.001, 2.5, 10), // 1ms to ~9.3s
		},
		[]string{"method", "path"},
	)

	// TopologyBuildDurationSeconds is topology build latency (SLO target).
	TopologyBuildDurationSeconds = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "topology_build_duration_seconds",
			Help:      "Topology graph build duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.5, 2, 8), // 0.5s to 64s
		},
	)

	// WebSocketConnectionsActive is current number of WebSocket clients (capacity planning).
	WebSocketConnectionsActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Name:      "websocket_connections_active",
			Help:      "Number of active WebSocket connections.",
		},
	)

	// KCLIExecTotal counts kcli exec commands by command type and outcome.
	KCLIExecTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "kcli_exec_total",
			Help:      "Total number of kcli exec commands by command type and outcome.",
		},
		[]string{"command", "outcome"}, // outcome: success, failure, timeout
	)

	// KCLIExecDurationSeconds is kcli exec command duration histogram.
	KCLIExecDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "kcli_exec_duration_seconds",
			Help:      "kcli exec command duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.1, 2, 10), // 100ms to ~51s
		},
		[]string{"command"},
	)

	// KCLIStreamConnectionsActive is current number of active kcli stream connections.
	KCLIStreamConnectionsActive = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Name:      "kcli_stream_connections_active",
			Help:      "Number of active kcli stream connections by mode.",
		},
		[]string{"mode"}, // mode: ui, shell
	)

	// KCLIStreamConnectionsTotal counts total kcli stream connections.
	KCLIStreamConnectionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "kcli_stream_connections_total",
			Help:      "Total number of kcli stream connections by mode.",
		},
		[]string{"mode"},
	)

	// KCLICompletionRequestsTotal counts kcli completion requests.
	KCLICompletionRequestsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "kcli_completion_requests_total",
			Help:      "Total number of kcli completion requests.",
		},
	)

	// KCLICompletionDurationSeconds is kcli completion response time histogram.
	KCLICompletionDurationSeconds = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "kcli_completion_duration_seconds",
			Help:      "kcli completion response time in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.01, 2, 8), // 10ms to ~1.3s
		},
	)

	// KCLIErrorsTotal counts kcli errors by error type.
	KCLIErrorsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "kcli_errors_total",
			Help:      "Total number of kcli errors by error type.",
		},
		[]string{"error_type"}, // error_type: binary_not_found, timeout, execution_failed, etc.
	)

	// KCLIBinaryResolutionDurationSeconds is kcli binary resolution duration histogram.
	KCLIBinaryResolutionDurationSeconds = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "kcli_binary_resolution_duration_seconds",
			Help:      "kcli binary resolution duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.001, 2, 8), // 1ms to ~128ms
		},
	)

	// TopologyCacheHitsTotal counts cache hits (observability for C1.3).
	TopologyCacheHitsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "topology_cache_hits_total",
			Help:      "Total number of topology cache hits.",
		},
	)

	// TopologyCacheMissesTotal counts cache misses (observability for C1.3).
	TopologyCacheMissesTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "topology_cache_misses_total",
			Help:      "Total number of topology cache misses.",
		},
	)

	// DBQueryDurationSeconds tracks database query latency by operation type.
	DBQueryDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "db_query_duration_seconds",
			Help:      "Database query duration in seconds.",
			Buckets:   prometheus.ExponentialBuckets(0.001, 2, 10), // 1ms to ~512ms
		},
		[]string{"operation"}, // operation: select, insert, update, delete
	)

	// CircuitBreakerState tracks current circuit breaker state (0=closed, 1=open, 2=half-open).
	CircuitBreakerState = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Name:      "circuit_breaker_state",
			Help:      "Current circuit breaker state (0=closed, 1=open, 2=half-open).",
		},
		[]string{"cluster_id"},
	)

	// CircuitBreakerTransitionsTotal counts circuit breaker state transitions.
	CircuitBreakerTransitionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "circuit_breaker_transitions_total",
			Help:      "Total number of circuit breaker state transitions.",
		},
		[]string{"cluster_id", "from_state", "to_state"},
	)

	// CircuitBreakerFailuresTotal counts circuit breaker failures.
	CircuitBreakerFailuresTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "circuit_breaker_failures_total",
			Help:      "Total number of circuit breaker failures.",
		},
		[]string{"cluster_id"},
	)

	// AuthLoginAttemptsTotal counts authentication login attempts.
	AuthLoginAttemptsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "auth_login_attempts_total",
			Help:      "Total number of authentication login attempts.",
		},
		[]string{"method", "outcome"}, // method: password/api_key/oidc/saml, outcome: success/failure
	)

	// AuthTokenRefreshesTotal counts token refresh operations.
	AuthTokenRefreshesTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "auth_token_refreshes_total",
			Help:      "Total number of token refresh operations.",
		},
		[]string{"outcome"}, // outcome: success/failure
	)

	// AuthAPIKeyValidationsTotal counts API key validation attempts.
	AuthAPIKeyValidationsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "auth_api_key_validations_total",
			Help:      "Total number of API key validation attempts.",
		},
		[]string{"outcome"}, // outcome: success/failure
	)

	// TokenCleanupDeletedTotal counts tokens deleted by cleanup job.
	TokenCleanupDeletedTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "token_cleanup_deleted_total",
			Help:      "Total number of expired tokens deleted by cleanup job.",
		},
	)

	// WebSocketMessagesSentTotal counts WebSocket messages sent to clients.
	WebSocketMessagesSentTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "websocket_messages_sent_total",
			Help:      "Total number of WebSocket messages sent to clients.",
		},
	)

	// WebSocketMessagesReceivedTotal counts WebSocket messages received from clients.
	WebSocketMessagesReceivedTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "websocket_messages_received_total",
			Help:      "Total number of WebSocket messages received from clients.",
		},
	)

	// WebSocketMessageSizeBytes tracks WebSocket message sizes.
	WebSocketMessageSizeBytes = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "websocket_message_size_bytes",
			Help:      "WebSocket message size in bytes.",
			Buckets:   prometheus.ExponentialBuckets(64, 2, 12), // 64 bytes to 256KB
		},
		[]string{"direction"}, // direction: sent, received
	)

)
