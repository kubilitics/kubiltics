// demo-app is a simple Go HTTP server with built-in OTel SDK instrumentation.
// It sends real traces to the kubilitics trace-agent, simulating a
// microservice with DB and cache calls plus a realistic error rate.
package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	endpoint := envOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", "kubilitics-trace-agent.kubilitics-system:4318")
	serviceName := envOrDefault("OTEL_SERVICE_NAME", "demo-order-service")

	exporter, err := otlptracehttp.New(context.Background(),
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		log.Fatalf("failed to create OTLP exporter: %v", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(serviceName),
			attribute.String("k8s.namespace.name", os.Getenv("POD_NAMESPACE")),
			attribute.String("k8s.pod.name", os.Getenv("POD_NAME")),
		)),
	)
	defer tp.Shutdown(context.Background())
	otel.SetTracerProvider(tp)

	tracer := otel.Tracer("demo-app")

	http.HandleFunc("/api/orders", ordersHandler(tracer))
	http.HandleFunc("/api/health", healthHandler)

	log.Printf("demo-order-service starting on :8080 (exporting to %s)", endpoint)
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func ordersHandler(tracer trace.Tracer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, span := tracer.Start(r.Context(), fmt.Sprintf("%s /api/orders", r.Method))
		defer span.End()

		span.SetAttributes(
			attribute.String("http.method", r.Method),
			attribute.String("http.route", "/api/orders"),
			attribute.String("http.url", r.URL.String()),
		)

		// Simulate DB query
		simulateDB(ctx, tracer)

		// Simulate cache lookup
		simulateCache(ctx, tracer)

		// ~10% error rate
		if rand.Float32() < 0.1 {
			span.SetStatus(codes.Error, "internal server error")
			span.SetAttributes(attribute.Int("http.status_code", 500))
			http.Error(w, `{"error":"internal server error"}`, 500)
			return
		}

		span.SetAttributes(attribute.Int("http.status_code", 200))
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"orders":[{"id":%d,"total":%.2f}],"count":%d}`,
			rand.Intn(10000), rand.Float64()*500, rand.Intn(200)+1)
	}
}

func simulateDB(ctx context.Context, tracer trace.Tracer) {
	_, span := tracer.Start(ctx, "SELECT orders")
	defer span.End()
	span.SetAttributes(
		attribute.String("db.system", "postgresql"),
		attribute.String("db.statement", "SELECT * FROM orders WHERE status = $1 LIMIT 50"),
		attribute.String("db.name", "orders_db"),
	)
	// Simulate 10-50ms latency
	time.Sleep(time.Duration(10+rand.Intn(40)) * time.Millisecond)

	// 5% chance of slow query
	if rand.Float32() < 0.05 {
		time.Sleep(200 * time.Millisecond)
		span.AddEvent("slow query detected")
	}
}

func simulateCache(ctx context.Context, tracer trace.Tracer) {
	_, span := tracer.Start(ctx, "redis.GET order_count")
	defer span.End()
	span.SetAttributes(
		attribute.String("db.system", "redis"),
		attribute.String("db.statement", "GET order_count"),
	)
	// Simulate 1-5ms latency
	time.Sleep(time.Duration(1+rand.Intn(5)) * time.Millisecond)

	// Simulate cache miss ~20% of the time
	if rand.Float32() < 0.2 {
		span.SetAttributes(attribute.Bool("cache.hit", false))
	} else {
		span.SetAttributes(attribute.Bool("cache.hit", true))
	}
}

func healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status":"ok"}`)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
