// Package middleware provides HTTP middleware for distributed tracing (BE-OBS-001).
package middleware

import (
	"fmt"
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
)

const TraceIDHeader = "X-Trace-ID"

// Tracing wraps HTTP handlers with OpenTelemetry instrumentation and adds X-Trace-ID header.
// BE-OBS-001: Propagates trace context from traceparent header and adds X-Trace-ID to response.
func Tracing(next http.Handler) http.Handler {
	// Use otelhttp middleware for automatic span creation and trace context propagation
	return otelhttp.NewHandler(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract trace context from headers (traceparent) - otelhttp already does this, but ensure context is propagated
			ctx := r.Context()

			// Add trace ID to response header
			traceID := tracing.TraceIDFromContext(ctx)
			if traceID != "" {
				w.Header().Set(TraceIDHeader, traceID)
			}

			// Continue with next handler
			next.ServeHTTP(w, r.WithContext(ctx))
		}),
		"http.request",
		otelhttp.WithSpanNameFormatter(func(operation string, r *http.Request) string {
			return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
		}),
		otelhttp.WithPropagators(otel.GetTextMapPropagator()),
	)
}
