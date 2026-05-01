package proxy

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// ExecutionPhase classifies an AI turn event into one of two broad planes:
//   - PhaseThinking — LLM generating text, planning, citing sources
//   - PhaseExecution — LLM invoking tools, actions, waiting for results
//
// This classification is the foundation for execution-plane separation:
// thinking events are cheap, safe, and can be streamed freely; execution
// events carry risk (mutations, external calls) and should go through
// stricter audit + authz paths in a future split-service design.
type ExecutionPhase string

const (
	PhaseThinking  ExecutionPhase = "thinking"
	PhaseExecution ExecutionPhase = "execution"
	PhaseControl   ExecutionPhase = "control" // done, error, cancel
)

// ClassifyEvent maps an AssistantEvent variant to its execution phase.
func ClassifyEvent(ev *kotgv1.AssistantEvent) ExecutionPhase {
	switch ev.GetEvent().(type) {
	case *kotgv1.AssistantEvent_TextDelta,
		*kotgv1.AssistantEvent_PlanProposed,
		*kotgv1.AssistantEvent_Citation,
		*kotgv1.AssistantEvent_RenderBlock:
		return PhaseThinking
	case *kotgv1.AssistantEvent_ToolStart,
		*kotgv1.AssistantEvent_ToolEnd,
		*kotgv1.AssistantEvent_ActionPending:
		return PhaseExecution
	default:
		// Done, Error — control-plane events
		return PhaseControl
	}
}

var (
	proxyDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "kubilitics_ai_proxy_duration_seconds",
		Help:    "Latency of AI proxy calls.",
		Buckets: prometheus.DefBuckets,
	}, []string{"op", "status"})

	proxyErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "kubilitics_ai_proxy_errors_total",
		Help: "AI proxy errors by op and status code.",
	}, []string{"op", "code"})

	rateDropped = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "kubilitics_ai_ratelimit_dropped_total",
		Help: "AI proxy requests dropped by rate limiter.",
	}, []string{"op"})

	// Phase-split event counters. These are the key signals for sizing the
	// thinking vs execution planes independently and for audit dashboards.
	eventsByPhase = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "kubilitics_ai_events_total",
		Help: "AI assistant events by execution phase (thinking/execution/control).",
	}, []string{"phase", "type"})
)

// RecordEventByPhase increments the kubilitics_ai_events_total counter for
// the given (phase, eventType) pair. Called from the handler recv pump so every
// streamed event is accounted for in Prometheus without importing kotgv1 in the
// handler package just for classification.
func RecordEventByPhase(phase, evType string) {
	eventsByPhase.WithLabelValues(phase, evType).Inc()
}
