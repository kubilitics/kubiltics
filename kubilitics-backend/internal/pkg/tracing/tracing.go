// Package tracing provides OpenTelemetry distributed tracing support (BE-OBS-001).
package tracing

import (
	"context"
	"fmt"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.27.0"
	"go.opentelemetry.io/otel/trace"
)

var (
	tracerProvider *sdktrace.TracerProvider
	tracer         trace.Tracer
)

// Init initializes OpenTelemetry tracing. Returns cleanup function and error.
func Init(serviceName, endpoint string, samplingRate float64) (func(), error) {
	if endpoint == "" {
		// Tracing disabled
		return func() {}, nil
	}

	// Create resource with service name
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String(serviceName),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create resource: %w", err)
	}

	// Create exporter based on endpoint protocol
	var exp sdktrace.SpanExporter
	if isGRPC(endpoint) {
		exp, err = otlptracegrpc.New(context.Background(),
			otlptracegrpc.WithEndpoint(endpoint),
			otlptracegrpc.WithInsecure(), // Use WithInsecure() for non-TLS; production should use TLS
		)
	} else {
		exp, err = otlptracehttp.New(context.Background(),
			otlptracehttp.WithEndpoint(endpoint),
			otlptracehttp.WithInsecure(), // Use WithInsecure() for non-TLS; production should use TLS
		)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create exporter: %w", err)
	}

	// Configure sampler based on sampling rate
	var sampler sdktrace.Sampler
	if samplingRate >= 1.0 {
		sampler = sdktrace.AlwaysSample()
	} else if samplingRate <= 0.0 {
		sampler = sdktrace.NeverSample()
	} else {
		sampler = sdktrace.TraceIDRatioBased(samplingRate)
	}

	// Create tracer provider
	tracerProvider = sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)

	// Set global tracer provider
	otel.SetTracerProvider(tracerProvider)

	// Set global propagator for trace context propagation
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	// Create tracer
	tracer = otel.Tracer(serviceName)

	// Return cleanup function
	return func() {
		if tracerProvider != nil {
			_ = tracerProvider.Shutdown(context.Background())
		}
	}, nil
}

// Tracer returns the global tracer instance.
func Tracer() trace.Tracer {
	if tracer == nil {
		// Return no-op tracer if not initialized
		return trace.NewNoopTracerProvider().Tracer("noop")
	}
	return tracer
}

// StartSpan starts a new span with the given name and options.
func StartSpan(ctx context.Context, name string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	return Tracer().Start(ctx, name, opts...)
}

// StartSpanWithAttributes starts a new span with the given name and attributes.
func StartSpanWithAttributes(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return Tracer().Start(ctx, name, trace.WithAttributes(attrs...))
}

// SpanFromContext extracts the span from context.
func SpanFromContext(ctx context.Context) trace.Span {
	return trace.SpanFromContext(ctx)
}

// TraceIDFromContext extracts the trace ID from context as a string.
func TraceIDFromContext(ctx context.Context) string {
	span := trace.SpanFromContext(ctx)
	if span.SpanContext().IsValid() {
		return span.SpanContext().TraceID().String()
	}
	return ""
}

// isGRPC checks if endpoint uses gRPC protocol (port 4317) or HTTP (port 4318).
func isGRPC(endpoint string) bool {
	// Default to HTTP unless explicitly gRPC port or protocol
	return os.Getenv("OTEL_EXPORTER_OTLP_PROTOCOL") == "grpc" ||
		os.Getenv("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL") == "grpc"
}
