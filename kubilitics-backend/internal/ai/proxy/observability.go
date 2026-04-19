package proxy

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

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
)
