// Command agent is the kubilitics trace agent. It receives OpenTelemetry traces
// from instrumented workloads and serves them to the Kubilitics desktop app.
//
// Ports:
//
//	:4318 — OTLP/HTTP receiver (standard OTel SDK default port)
//	:9417 — REST query API + OTLP receiver (shared handler)
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kubilitics/kubilitics-trace-agent/internal/api"
	"github.com/kubilitics/kubilitics-trace-agent/internal/receiver"
	"github.com/kubilitics/kubilitics-trace-agent/internal/store"
)

func main() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "/data/traces.db"
	}

	// 1. Open store.
	s, err := store.NewStore(dbPath)
	if err != nil {
		log.Fatalf("failed to open store at %s: %v", dbPath, err)
	}
	defer func() {
		if err := s.Close(); err != nil {
			log.Printf("store close error: %v", err)
		}
	}()

	// 2. Build shared handler components.
	recv := receiver.NewReceiver(s)
	queryHandler := api.NewHandler(s)

	// 3. Main mux — query API + OTLP receiver on :9417.
	mainMux := http.NewServeMux()
	queryHandler.SetupRoutes(mainMux)
	mainMux.HandleFunc("POST /v1/traces", recv.HandleTraces)

	// 4. OTLP mux on :4318 (standard OTel SDK port).
	otlpMux := http.NewServeMux()
	otlpMux.HandleFunc("POST /v1/traces", recv.HandleTraces)

	apiServer := &http.Server{
		Addr:         ":9417",
		Handler:      mainMux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	otlpServer := &http.Server{
		Addr:         ":4318",
		Handler:      otlpMux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 5. Pruning goroutine — delete spans/traces older than 24h, every hour.
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cutoff := time.Now().Add(-24 * time.Hour).UnixNano()
			if err := s.PruneOlderThan(context.Background(), cutoff); err != nil {
				log.Printf("prune error: %v", err)
			}
		}
	}()

	// 6. Start servers.
	log.Printf("kubilitics-trace-agent starting — OTLP :4318, API :9417, DB %s", dbPath)

	go func() {
		if err := otlpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("OTLP server error: %v", err)
		}
	}()

	go func() {
		if err := apiServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API server error: %v", err)
		}
	}()

	// 7. Graceful shutdown on SIGTERM or SIGINT.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	log.Println("shutting down trace agent...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := apiServer.Shutdown(ctx); err != nil {
		log.Printf("API server shutdown error: %v", err)
	}
	if err := otlpServer.Shutdown(ctx); err != nil {
		log.Printf("OTLP server shutdown error: %v", err)
	}

	log.Println("trace agent stopped")
}
