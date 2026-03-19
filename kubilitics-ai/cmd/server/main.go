package main

// Package main is the entry point for the kubilitics-ai server application.
//
// Responsibilities:
//   - Load and validate configuration from YAML, environment variables, and CLI flags
//   - Establish gRPC streaming connection to kubilitics-backend for real-time cluster state
//   - Initialize the World Model with streaming updates
//   - Start the MCP (Model Context Protocol) server as the sole interface to the LLM
//   - Start the REST API server on port 8081 for frontend communication
//   - Start the WebSocket handler for real-time investigation streaming
//   - Register and serve health check endpoints
//   - Implement graceful shutdown with context cancellation
//
// Architecture Flow:
//   1. gRPC stream (kubilitics-backend) → World Model (in-memory cluster state)
//   2. World Model + Events → Reasoning Engine triggers investigations
//   3. Reasoning Engine uses MCP Server to call tools (observation, analysis, recommendation, execution)
//   4. MCP Server translates tool calls to backend operations or local computations
//   5. REST API + WebSocket expose investigation results to frontend
//
// Port Configuration:
//   - kubilitics-ai server: 8081
//   - kubilitics-backend server: 819 (separate service)
//
// Graceful Shutdown:
//   - Cancels all in-flight investigations
//   - Closes gRPC connection to backend
//   - Closes all HTTP listeners
//   - Finalizes audit logs

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/server"
)

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", "", "Path to configuration file")
	flag.Parse()

	// Load configuration
	var cfgMgr config.ConfigManager
	var err error
	if configPath != "" {
		cfgMgr, err = config.NewConfigManager(configPath)
	} else {
		cfgMgr, err = config.NewConfigManagerWithDefaults()
	}

	if err := cfgMgr.Load(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	cfg := cfgMgr.Get(context.Background())

	// Create server with all components wired together
	srv, err := server.NewServer(cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create server: %v\n", err)
		os.Exit(1)
	}

	// Start server (HTTP/gRPC, LLM, Safety, Analytics, MCP)
	if err := srv.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}

	// Setup signal handling for graceful shutdown and config hot-reload.
	sigChan := make(chan os.Signal, 1)
	// AI-015: SIGHUP triggers a configuration reload so operators can rotate the
	// LLM API key without restarting the service.
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)

	for {
		sig := <-sigChan
		if sig == syscall.SIGHUP {
			// Hot-reload configuration (env vars + config file) and rebuild the LLM adapter.
			fmt.Println("Received SIGHUP — reloading configuration and rotating LLM credentials...")
			if err := cfgMgr.Reload(context.Background()); err != nil {
				fmt.Fprintf(os.Stderr, "Config reload failed: %v\n", err)
				continue
			}
			newCfg := cfgMgr.Get(context.Background())
			if err := srv.ReloadLLMAdapter(newCfg); err != nil {
				fmt.Fprintf(os.Stderr, "LLM adapter reload failed: %v\n", err)
			} else {
				fmt.Println("LLM adapter reloaded successfully.")
			}
			continue
		}
		// SIGINT or SIGTERM — graceful shutdown.
		break
	}

	fmt.Println("\nReceived shutdown signal...")

	// Stop server gracefully
	if err := srv.Stop(); err != nil {
		fmt.Fprintf(os.Stderr, "Error stopping server: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("Shutdown complete")
}
