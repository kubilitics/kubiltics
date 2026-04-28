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
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/config"
	"github.com/vellankikoti/kubilitics/brain/internal/engines/kagent"
	"github.com/vellankikoti/kubilitics/brain/internal/engines/python"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/budget"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/summary"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/toolrouter"
	"github.com/vellankikoti/kubilitics/brain/internal/router"
	"github.com/vellankikoti/kubilitics/brain/internal/runtime"
	wsafety "github.com/vellankikoti/kubilitics/brain/internal/safety/wrapper"
	"github.com/vellankikoti/kubilitics/brain/internal/server"
	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"

	"google.golang.org/grpc"
)

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", "", "Path to configuration file")
	flag.Parse()

	// Load configuration. The previous version declared `err` here but then
	// shadowed it with the `if err := cfgMgr.Load(...)` line below, silently
	// dropping any error returned by NewConfigManager. Today NewConfigManager
	// never errors, but the shadow was a latent bug — be explicit about both.
	var cfgMgr config.ConfigManager
	var cfgErr error
	if configPath != "" {
		cfgMgr, cfgErr = config.NewConfigManager(configPath)
	} else {
		cfgMgr, cfgErr = config.NewConfigManagerWithDefaults()
	}
	if cfgErr != nil {
		fmt.Fprintf(os.Stderr, "Failed to construct config manager (path=%q): %v\n", configPath, cfgErr)
		os.Exit(1)
	}

	if err := cfgMgr.Load(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration from %q: %v\n", configPath, err)
		os.Exit(1)
	}

	cfg := cfgMgr.Get(context.Background())
	if configPath != "" {
		fmt.Printf("Loaded configuration from %s (provider=%s, port=%d)\n", configPath, cfg.LLM.Provider, cfg.Server.Port)
	}

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

	// Subproject 3a: start the AgentRuntimeService gRPC server on :50051.
	// This is the new backend↔AI contract surface; the v1 stub delegates Chat
	// directly to the existing LLM adapter (no tools, no agents, no actions).
	// KUBILITICS_AI_GRPC_PORT overrides the default so the Tauri sidecar can
	// pick a port that doesn't collide with kubilitics-backend's own gRPC.
	grpcAddr := ":50051"
	if p := os.Getenv("KUBILITICS_AI_GRPC_PORT"); p != "" {
		grpcAddr = ":" + p
	}
	grpcLis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to listen on %s: %v\n", grpcAddr, err)
		os.Exit(1)
	}
	grpcSrv := grpc.NewServer()

	// Build engine list. LLM-direct is always registered. kagent + python
	// engines (subprojects 3c + 3d) register conditionally based on env vars
	// so production deployments without those backends keep behaving exactly
	// as v0.4.0. Real wire-level kagent/python integrations are scoped for v1.5;
	// the registered engines emit structured "unimplemented" events until then.
	// Previously this block was a FATAL guard: if srv.GetLLMAdapter()
	// returned nil (missing key, dead Ollama host, stale SQLite config
	// pointing at an offline endpoint, etc.) we called os.Exit(1).
	// That produced a chicken-and-egg loop — the desktop AI Settings
	// page needs the brain to be LIVE to POST /api/v1/config/provider
	// and hot-wire a working adapter, but the brain refused to stay up
	// because it had no adapter. Users saw "AI Unreachable" forever
	// with no way to fix it from the UI.
	//
	// Now we log loudly and keep running. The LLMEngine is still
	// registered (with the nil adapter threaded through the bridge).
	// StreamCompletion / StreamCompletionWithTools guard with a clear
	// ErrProviderNotConfigured until the adapter becomes non-nil.
	// cmd/server/main.go wires SetAdapterChangeHook below so
	// POST /api/v1/config/provider swaps the bridge's adapter at
	// runtime and chat starts working without a full restart.
	llmAdapter := srv.GetLLMAdapter()
	if llmAdapter == nil {
		fmt.Fprintf(os.Stderr,
			"[WARN] LLM adapter is nil for provider %q at startup. Brain will run "+
				"with chat disabled until the user saves a working provider in AI "+
				"Settings (the hot-wire endpoint will activate it at runtime).\n",
			cfg.LLM.Provider)
	}

	// Construct a shared audit logger for engine-level + safety-wrapper
	// telemetry. Best-effort: a logger creation failure here is non-fatal
	// (the engine + wrapper both no-op on a nil audit.Logger), but it
	// means we lose the LLM-call audit trail for this run. v1.5 closes
	// this gap in production deployments.
	auditLogger, auditErr := audit.NewLogger(nil)
	if auditErr != nil {
		fmt.Fprintf(os.Stderr, "warning: engine audit logger init failed: %v (engine + safety telemetry disabled)\n", auditErr)
		auditLogger = nil
	}

	// Wire CompleteWithTools into the LLM-direct engine path so MCP tools
	// fire from real LLM calls. The bridge holds Tools+Executor; the engine
	// observes via the LLMToolProvider interface and never imports the MCP
	// or types packages directly.
	toolSchemas := srv.GetToolSchemas()
	toolExecutor := srv.GetToolExecutor()
	bridge := &runtime.LLMAdapterBridge{
		A:        llmAdapter,
		Tools:    toolSchemas,
		Executor: toolExecutor,
	}
	// Hot-wire: when AI Settings POST /api/v1/config/provider builds a
	// new adapter, the server notifies this hook and the bridge swaps
	// atomically. The gRPC LLMEngine's very next StreamCompletion uses
	// the new adapter — no restart needed.
	srv.SetAdapterChangeHook(bridge.SetAdapter)

	// Phase 2 #5: install the LLM-backed summary completer. The bridge
	// satisfies summary.SummaryLLM via its Complete(ctx, prompt) method.
	// Failure modes (no adapter, timeout, transport error, empty output)
	// fall back to the deterministic formatter — see internal/llm/summary
	// for the contract. The render path NEVER stalls on summary.
	summary.SetCompleter(summary.NewLLMCompleter(bridge))
	// Topic-aware tool filtering. Default OFF so this merge doesn't change
	// production behavior; the Together.ai bench config flips it on via
	// llm.tool_router.enabled, and operators can force it with
	// KOTG_TOOL_ROUTER=1 without changing the yaml.
	if toolRouterEnabled(cfg) {
		bridge.ToolRouter = toolrouter.NewKeywordRouter()
		fmt.Printf("LLM engine: topic-aware tool router ENABLED (cap=%d)\n", toolrouter.MaxToolsPerCall)
	}
	llmEngOpts := []runtime.EngineOption{}
	if toolExecutor != nil && len(toolSchemas) > 0 {
		llmEngOpts = append(llmEngOpts, runtime.WithToolProvider(bridge, len(toolSchemas)))
		fmt.Printf("LLM engine: tool-aware path enabled with %d MCP tools\n", len(toolSchemas))
	} else {
		fmt.Printf("LLM engine: text-only path (no MCP tools registered)\n")
	}
	if auditLogger != nil {
		llmEngOpts = append(llmEngOpts, runtime.WithAudit(auditLogger))
	}
	engines := []router.Engine{
		runtime.NewLLMEngine(bridge, llmEngOpts...),
	}
	if kagentEndpoint := os.Getenv("KAGENT_ENDPOINT"); kagentEndpoint != "" {
		engines = append(engines, kagent.New(kagent.Config{
			Endpoint:       kagentEndpoint,
			DefaultAgentID: os.Getenv("KAGENT_DEFAULT_AGENT_ID"),
			Namespace:      os.Getenv("KAGENT_NAMESPACE"),
			UserID:         os.Getenv("KAGENT_USER_ID"),
			RequestTimeout: parseSecondsEnv("KAGENT_REQUEST_TIMEOUT_SECONDS", 0),
			Audit:          auditLogger,
		}))
	}
	if pyEndpoint := os.Getenv("PYTHON_AGENT_ENDPOINT"); pyEndpoint != "" {
		engines = append(engines, python.New(python.Config{
			Endpoint:          pyEndpoint,
			DefaultWorkflowID: os.Getenv("PYTHON_AGENT_WORKFLOW"),
		}))
	}

	r := router.New(
		engines,
		nil, // default picker — picks the first engine (LLM-direct in v1)
	)

	// Wrap the Router with the v1 Safety wrapper (subproject 3e). The
	// AllowedActions list comes from KUBILITICS_AI_ALLOWED_ACTIONS (comma-
	// separated). v1 engines (LLM, kagent stub, python stub) don't emit
	// ActionPending events yet, so the policy is a no-op until v1.5 lands
	// real action proposals; the wrapper is wired now so 3g (Approval UI)
	// and v1.5 safety depth slot in cleanly.
	allowed := strings.Split(os.Getenv("KUBILITICS_AI_ALLOWED_ACTIONS"), ",")
	if len(allowed) == 1 && allowed[0] == "" {
		allowed = nil
	}
	// v1.5: bridge the wrapper's AuditSink into the production
	// internal/audit pipeline whenever we have a constructible logger.
	// If audit init failed above we fall back to NoopSink so the wrapper
	// still functions (just without the audit trail).
	var safetyAudit wsafety.AuditSink = wsafety.NoopSink{}
	if auditLogger != nil {
		safetyAudit = wsafety.LoggerSink{L: auditLogger}
	}
	disp := wsafety.New(r, wsafety.Config{
		AllowedActions:   allowed,
		Audit:            safetyAudit,
		RequireClusterID: true,
	})

	rtSrv := runtime.New(runtime.Config{
		Dispatcher:    disp,
		AIVersion:     "0.6.0",
		SchemaVersion: "1.0.1",
		Providers:     []string{cfg.LLM.Provider},
	})
	// Probe consulted by AICapabilities so /capabilities reflects whether
	// the bridge currently holds a working adapter. Without this, the
	// brain reported `ready=true` even when the user's saved config built
	// a nil adapter (bad key, dead Ollama) — green pill over a chat that
	// fails on every turn.
	rtSrv.SetAdapterProbe(func() bool { return bridge.Adapter() != nil })
	kotgv1.RegisterChatServer(grpcSrv, rtSrv)
	kotgv1.RegisterAIControlServer(grpcSrv, rtSrv)
	// Wire the runtime server into the HTTP admin surface so that
	// POST /admin/trace-dir can reach into the runtime layer.
	srv.SetRuntimeServer(rtSrv)

	// Phase 2 / Gap 3 — pre-dispatch budget gate. Cap is driven by env
	// var KUBILITICS_AI_BUDGET_USD (0 = unlimited). When the cap is
	// exceeded, Server.Send emits an Error{Code:"budget_exceeded"} and
	// the frontend BudgetExceededBanner surfaces the reset CTA.
	budgetCap := 0.0
	if raw := os.Getenv("KUBILITICS_AI_BUDGET_USD"); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v >= 0 {
			budgetCap = v
		}
	}
	rtSrv.SetBudgetGate(budget.NewMemoryGate(budgetCap), 0.01)
	go func() {
		fmt.Printf("AgentRuntimeService gRPC listening on %s\n", grpcAddr)
		if err := grpcSrv.Serve(grpcLis); err != nil {
			fmt.Fprintf(os.Stderr, "gRPC serve error: %v\n", err)
		}
	}()
	defer grpcSrv.GracefulStop()

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

// toolRouterEnabled returns true when topic-aware tool selection should be
// used. The env var is checked first so operators can force the behavior
// without editing yaml; otherwise the config field + provider-aware default
// decides.
//
// Provider-aware default:
//
//   - Ollama: ON by default. Small local models (qwen2.5:3b, llama3.1:8b,
//     phi3:mini, etc.) choke on 166 tool schemas (~25K tokens of tool
//     metadata BEFORE the user's question lands). Remote CPU-only Ollama
//     sandboxes take 60-120s per turn with the full schema, which blows
//     past the UI's stream timeout and users see "chat didn't work".
//     Tool-router trims to ~5-10 relevant tools → sub-10s turns.
//
//   - OpenAI/Anthropic hosted: OFF by default, because they handle 25K
//     prompts comfortably and the router's keyword heuristic is imperfect;
//     we'd rather send the full taxonomy when the model can consume it.
//     Operators can still force-enable via env var or yaml.
func toolRouterEnabled(cfg *config.Config) bool {
	switch strings.ToLower(os.Getenv("KOTG_TOOL_ROUTER")) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	if cfg != nil && cfg.LLM.ToolRouter.Enabled {
		return true
	}
	// Provider-aware default: Ollama auto-enables the router.
	if cfg != nil && strings.ToLower(cfg.LLM.Provider) == "ollama" {
		return true
	}
	return false
}

// parseSecondsEnv reads an integer-seconds env var and returns it as a
// time.Duration. Returns fallback if unset or unparseable.
func parseSecondsEnv(name string, fallback time.Duration) time.Duration {
	v := os.Getenv(name)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return time.Duration(n) * time.Second
}
