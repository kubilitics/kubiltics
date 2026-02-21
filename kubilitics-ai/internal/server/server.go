package server

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"os"
	"strings"

	"github.com/kubilitics/kubilitics-ai/internal/analytics"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
	appconfig "github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/cost"
	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
	"github.com/kubilitics/kubilitics-ai/internal/integration/events"
	"github.com/kubilitics/kubilitics-ai/internal/llm/adapter"
	"github.com/kubilitics/kubilitics-ai/internal/llm/budget"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	mcpserver "github.com/kubilitics/kubilitics-ai/internal/mcp/server"
	"github.com/kubilitics/kubilitics-ai/internal/memory/temporal"
	"github.com/kubilitics/kubilitics-ai/internal/memory/vector"
	"github.com/kubilitics/kubilitics-ai/internal/memory/worldmodel"
	reasoningcontext "github.com/kubilitics/kubilitics-ai/internal/reasoning/context"
	reasoningengine "github.com/kubilitics/kubilitics-ai/internal/reasoning/engine"
	reasoningprompt "github.com/kubilitics/kubilitics-ai/internal/reasoning/prompt"
	"github.com/kubilitics/kubilitics-ai/internal/safety"
	"github.com/kubilitics/kubilitics-ai/internal/security"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	_ "github.com/kubilitics/kubilitics-ai/internal/metrics" // register Prometheus metrics
)

// Server represents the Kubilitics AI server
type Server struct {
	config *appconfig.Config

	// Core components
	llmAdapter        adapter.LLMAdapter
	mcpServer         mcpserver.MCPServer
	toolExecutor      types.ToolExecutor
	safetyEngine      *safety.Engine
	analyticsEngine   *analytics.Engine
	conversationStore *ConversationStore
	reasoningEngine   reasoningengine.ReasoningEngine

	// Backend integration (A-CORE-008)
	backendProxy *backend.Proxy
	eventHandler events.EventHandler

	// Memory layer (A-CORE-009)
	worldModel    *worldmodel.WorldModel
	queryAPI      *worldmodel.QueryAPI
	temporalStore temporal.TemporalStore
	vectorStore   vector.VectorStore

	// Analytics pipeline (A-CORE-010)
	analyticsPipeline *analytics.Pipeline

	// Cost intelligence pipeline (A-CORE-011)
	costPipeline *cost.CostPipeline

	// Security analysis engine (A-CORE-012)
	securityEngine *security.SecurityEngine

	// Persistence store (A-CORE-013)
	store db.Store

	// Token budget tracker (A-CORE-014)
	budgetTracker budget.BudgetTracker

	// HTTP server
	httpServer *http.Server

	// Lifecycle
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// State
	mu      sync.RWMutex
	running bool
}

// NewServer creates a new Kubilitics AI server
func NewServer(cfg *appconfig.Config) (*Server, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config cannot be nil")
	}

	ctx, cancel := context.WithCancel(context.Background())

	srv := &Server{
		config:  cfg,
		ctx:     ctx,
		cancel:  cancel,
		running: false,
	}

	// Initialize components
	if err := srv.initializeComponents(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to initialize components: %w", err)
	}

	return srv, nil
}

// initializeComponents initializes all server components
func (s *Server) initializeComponents() error {
	// 0. Initialize Persistence Store (A-CORE-013) - FIRST, as others depend on it
	dbPath := s.config.Database.SQLitePath
	if dbPath == "" {
		dbPath = ":memory:"
	}
	if store, err := db.NewSQLiteStore(dbPath); err != nil {
		return fmt.Errorf("failed to initialize persistence store: %w", err)
	} else {
		s.store = store
	}

	// 1. Initialize LLM Adapter
	// Check if a provider was saved to the DB in a previous run (via POST /api/v1/config/provider).
	// If so, overlay it on top of the YAML/env config so the user never has to re-enter their key.
	if saved, err := s.store.LoadLLMConfig(context.Background()); err != nil {
		fmt.Printf("[WARN] Failed to load persisted LLM config from DB: %v — using config file values\n", err)
	} else if saved != nil && saved.Provider != "" {
		fmt.Printf("[INFO] Restoring persisted LLM config: provider=%s model=%s\n", saved.Provider, saved.Model)
		s.config.LLM.Provider = saved.Provider
		s.config.LLM.Configured = true
		switch saved.Provider {
		case "openai":
			if s.config.LLM.OpenAI == nil {
				s.config.LLM.OpenAI = make(map[string]interface{})
			}
			s.config.LLM.OpenAI["api_key"] = saved.APIKey
			s.config.LLM.OpenAI["model"] = saved.Model
		case "anthropic":
			if s.config.LLM.Anthropic == nil {
				s.config.LLM.Anthropic = make(map[string]interface{})
			}
			s.config.LLM.Anthropic["api_key"] = saved.APIKey
			s.config.LLM.Anthropic["model"] = saved.Model
		case "ollama":
			if s.config.LLM.Ollama == nil {
				s.config.LLM.Ollama = make(map[string]interface{})
			}
			s.config.LLM.Ollama["base_url"] = saved.BaseURL
			s.config.LLM.Ollama["model"] = saved.Model
		case "custom":
			if s.config.LLM.Custom == nil {
				s.config.LLM.Custom = make(map[string]interface{})
			}
			s.config.LLM.Custom["base_url"] = saved.BaseURL
			s.config.LLM.Custom["model"] = saved.Model
			if saved.APIKey != "" {
				s.config.LLM.Custom["api_key"] = saved.APIKey
			}
		}
	}

	var apiKey, model, baseURL string
	switch s.config.LLM.Provider {
	case "openai":
		apiKey, _ = s.config.LLM.OpenAI["api_key"].(string)
		model, _ = s.config.LLM.OpenAI["model"].(string)
	case "anthropic":
		apiKey, _ = s.config.LLM.Anthropic["api_key"].(string)
		model, _ = s.config.LLM.Anthropic["model"].(string)
	case "ollama":
		baseURL, _ = s.config.LLM.Ollama["base_url"].(string)
		model, _ = s.config.LLM.Ollama["model"].(string)
	case "custom":
		baseURL, _ = s.config.LLM.Custom["base_url"].(string)
		model, _ = s.config.LLM.Custom["model"].(string)
		apiKey, _ = s.config.LLM.Custom["api_key"].(string)
	}

	llmConfig := &adapter.Config{
		Provider: adapter.ProviderType(s.config.LLM.Provider),
		APIKey:   apiKey,
		Model:    model,
		BaseURL:  baseURL,
	}

	llmAdapter, err := adapter.NewLLMAdapter(llmConfig)
	if err != nil {
		return fmt.Errorf("failed to initialize LLM adapter: %w", err)
	}
	s.llmAdapter = llmAdapter

	// 2. Initialize Safety Engine (if enabled)
	if s.config.Safety.Enabled {
		// Pass store to safety engine for policy persistence
		safetyEngine, err := safety.NewEngine(s.store)
		if err != nil {
			return fmt.Errorf("failed to initialize safety engine: %w", err)
		}
		s.safetyEngine = safetyEngine
	}

	// 3. Initialize Analytics Engine (if enabled)
	if s.config.Analytics.Enabled {
		s.analyticsEngine = analytics.NewEngine()
	}

	// 4. Initialize Conversation Store (always on)
	s.conversationStore = NewConversationStore()

	// 5. Initialize MCP server (if enabled)
	if s.config.MCP.Enabled {
		// Pass the entire appconfig to backend proxy if needed, or clone relevant parts.
		// The backend proxy expects *appconfig.Config.
		mcpCfg := s.config

		// Audit logger — use default (logs to stderr / files).
		auditLogger, err := audit.NewLogger(nil)
		if err != nil {
			// Non-fatal: log and proceed without MCP tooling.
			fmt.Printf("warning: failed to create audit logger: %v\n", err)
		} else {
			// Backend proxy — connects to kubilitics-backend over gRPC + REST.
			backendProxy, err := backend.NewProxy(mcpCfg, auditLogger)
			if err != nil {
				fmt.Printf("warning: failed to create backend proxy: %v\n", err)
			} else {
				// Initialize MUST be called to establish the gRPC connection and set
				// initialized=true; without this all ListResources/GetResource calls
				// return "proxy not initialized".
				if initErr := backendProxy.Initialize(context.Background()); initErr != nil {
					// Non-fatal: log the failure but continue — observation tools that go
					// through the REST HTTP path will still work; only gRPC-backed
					// analysis tools (analyze_pod_health etc.) will degrade gracefully.
					fmt.Printf("warning: backend proxy Initialize failed: %v (analysis tools will use REST fallback)\n", initErr)
				}
				mcp, err := mcpserver.NewMCPServer(mcpCfg, backendProxy, auditLogger, s.store)
				if err != nil {
					fmt.Printf("warning: failed to initialize MCP server: %v\n", err)
				} else {
					s.mcpServer = mcp
					s.toolExecutor = newMCPToolExecutor(mcp).WithAutonomyLevel(s.config.Autonomy.DefaultLevel)
				}
			}
		}
	}

	// 6. Initialize Reasoning Engine
	{
		auditLogger, _ := audit.NewLogger(nil)
		mcpCfg := &appconfig.Config{}
		bProxy, _ := backend.NewProxy(mcpCfg, auditLogger)

		// Wire backend proxy and event handler for A-CORE-008.
		s.backendProxy = bProxy
		s.eventHandler = events.NewEventHandler()

		// 7. Initialize Memory layer (A-CORE-009)
		s.worldModel = worldmodel.NewWorldModel()
		s.queryAPI = worldmodel.NewQueryAPI(s.worldModel)
		s.temporalStore = temporal.NewTemporalStore()
		s.vectorStore = vector.NewVectorStore()

		// 8. Initialize Analytics Pipeline (A-CORE-010)
		// The pipeline uses bProxy as MetricsFetcher; it starts background scraping lazily.
		s.analyticsPipeline = analytics.NewPipeline(bProxy)

		// 9. Initialize Cost Intelligence Pipeline (A-CORE-011)
		// Uses bProxy as ResourceFetcher for live cluster resource scraping.
		s.costPipeline = cost.NewCostPipeline(bProxy, cost.ProviderGeneric)

		// 10. Initialize Security Analysis Engine (A-CORE-012)
		// Uses bProxy as ResourceFetcher for live RBAC, pod security, network policy, and secret analysis.
		s.securityEngine = security.NewSecurityEngine(bProxy)

		// 11. (Moved to step 0) Persistence Store initialized at top.

		// 12. Initialize Token Budget Tracker (A-CORE-014)
		// In-memory tracker with configurable per-user and global limits.
		s.budgetTracker = budget.NewBudgetTracker(s.store)

		ctxBuilder := reasoningcontext.NewContextBuilderWithProxy(bProxy)
		promptMgr := reasoningprompt.NewPromptManager()

		// Build tool schemas from MCP server if available
		var toolSchemas []types.Tool
		if s.mcpServer != nil {
			mcpTools, err := s.mcpServer.ListTools(context.Background())
			if err == nil {
				for _, t := range mcpTools {
					toolSchemas = append(toolSchemas, types.Tool{
						Name:                  t.Name,
						Description:           t.Description,
						Parameters:            toMap(t.InputSchema),
						RequiredAutonomyLevel: t.RequiredAutonomyLevel,
					})
				}
			}
		}

		s.reasoningEngine = reasoningengine.NewReasoningEngine(
			s.store,
			ctxBuilder,
			promptMgr,
			s.llmAdapter,
			s.toolExecutor,
			toolSchemas,
			auditLogger,
		)
	}

	return nil
}

// Start starts the server
func (s *Server) Start() error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("server is already running")
	}
	s.running = true
	s.mu.Unlock()

	// Setup HTTP server
	mux := http.NewServeMux()
	s.registerHandlers(mux)

	// Add CORS middleware to allow frontend requests
	corsHandler := s.corsMiddleware(mux)

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf("%s:%d", s.config.Server.Host, s.config.Server.Port),
		Handler:      corsHandler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start HTTP(S) server — AI-017: honour TLSEnabled to serve WSS (WebSocket over TLS).
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		if s.config.Server.TLSEnabled && s.config.Server.TLSCertPath != "" && s.config.Server.TLSKeyPath != "" {
			fmt.Printf("Starting HTTPS server on %s:%d (TLS enabled)\n", s.config.Server.Host, s.config.Server.Port)
			if err := s.httpServer.ListenAndServeTLS(s.config.Server.TLSCertPath, s.config.Server.TLSKeyPath); err != nil && err != http.ErrServerClosed {
				fmt.Printf("HTTPS server error: %v\n", err)
			}
		} else {
			fmt.Printf("Starting HTTP server on %s:%d\n", s.config.Server.Host, s.config.Server.Port)
			if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				fmt.Printf("HTTP server error: %v\n", err)
			}
		}
	}()

	// AI-016: Monthly budget rollover cron — wake up at midnight on the 1st of each month
	// and reset per-user budgets so spending counters start fresh without a service restart.
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.runBudgetRolloverCron(s.ctx)
	}()

	fmt.Println("Kubilitics AI Server started successfully")
	fmt.Printf("  LLM Provider: %s\n", s.config.LLM.Provider)
	fmt.Printf("  Safety Engine: %v\n", s.config.Safety.Enabled)
	fmt.Printf("  Analytics: %v\n", s.config.Analytics.Enabled)
	fmt.Printf("  Autonomy Level: %d\n", s.config.Autonomy.DefaultLevel)

	return nil
}

// Stop gracefully stops the server
func (s *Server) Stop() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return fmt.Errorf("server is not running")
	}
	s.running = false
	s.mu.Unlock()

	fmt.Println("Stopping Kubilitics AI Server...")

	// Shutdown HTTP server
	if s.httpServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
			fmt.Printf("Error shutting down HTTP server: %v\n", err)
		}
	}

	// Cancel context
	s.cancel()

	// Wait for goroutines
	s.wg.Wait()

	fmt.Println("Kubilitics AI Server stopped")
	return nil
}

// Wait blocks until the server is stopped
func (s *Server) Wait() {
	<-s.ctx.Done()
}

// IsRunning returns whether the server is running
func (s *Server) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

// GetLLMAdapter returns the LLM adapter
func (s *Server) GetLLMAdapter() adapter.LLMAdapter {
	return s.llmAdapter
}

// GetMCPServer returns the MCP server (may be nil if not enabled or init failed).
func (s *Server) GetMCPServer() mcpserver.MCPServer {
	return s.mcpServer
}

// GetToolExecutor returns the tool executor (may be nil).
func (s *Server) GetToolExecutor() types.ToolExecutor {
	return s.toolExecutor
}

// GetSafetyEngine returns the safety engine
func (s *Server) GetSafetyEngine() *safety.Engine {
	return s.safetyEngine
}

// GetAnalyticsEngine returns the analytics engine
func (s *Server) GetAnalyticsEngine() *analytics.Engine {
	return s.analyticsEngine
}

// GetReasoningEngine returns the reasoning engine.
func (s *Server) GetReasoningEngine() reasoningengine.ReasoningEngine {
	return s.reasoningEngine
}

// registerHandlers registers HTTP handlers
func (s *Server) registerHandlers(mux *http.ServeMux) {
	// Health check
	mux.HandleFunc("/health", s.handleHealth)

	// Readiness check
	mux.HandleFunc("/ready", s.handleReady)

	// Info endpoint
	mux.HandleFunc("/info", s.handleInfo)

	// Prometheus metrics (production monitoring)
	mux.Handle("/metrics", promhttp.Handler())

	// LLM endpoints
	mux.HandleFunc("/api/v1/llm/complete", s.handleLLMComplete)
	mux.HandleFunc("/api/v1/llm/stream", s.handleLLMStream)

	// Safety endpoints
	if s.safetyEngine != nil {
		mux.HandleFunc("/api/v1/safety/evaluate", s.handleSafetyEvaluate)
		mux.HandleFunc("/api/v1/safety/rules", s.handleSafetyRules)
		mux.HandleFunc("/api/v1/safety/policies", s.handleSafetyPolicies)
		mux.HandleFunc("/api/v1/safety/policies/", s.handleSafetyPolicyByName)
		mux.HandleFunc("/api/v1/safety/autonomy/", s.handleSafetyAutonomy)
		mux.HandleFunc("/api/v1/safety/approvals", s.handleSafetyApprovals)
		mux.HandleFunc("/api/v1/safety/approvals/", s.handleSafetyApprovals)
	}

	// Analytics endpoints (simple engine-backed)
	if s.analyticsEngine != nil {
		mux.HandleFunc("/api/v1/analytics/anomalies", s.handleAnalyticsAnomalies)
		mux.HandleFunc("/api/v1/analytics/trends", s.handleAnalyticsTrends)
		mux.HandleFunc("/api/v1/analytics/recommendations", s.handleAnalyticsRecommendations)
	}

	// ML analytics endpoints (A-CORE-ML) — always available, no engine dependency.
	// These handlers (ml_handlers.go) implement Isolation Forest anomaly detection
	// and ARIMA time-series forecasting using only in-process math.
	mux.HandleFunc("/api/v1/analytics/ml/anomalies", s.handleMLAnomalies)
	mux.HandleFunc("/api/v1/analytics/ml/models", s.handleMLModels)
	mux.HandleFunc("/api/v1/analytics/forecast", s.handleForecast)

	// Wizard AI suggestion endpoints (E-PLAT-006)
	mux.HandleFunc("/api/v1/wizards/", s.handleWizardDispatch)
	mux.HandleFunc("/api/v1/wizards/suggest", s.handleWizardDispatch)
	mux.HandleFunc("/api/v1/wizards/validate", s.handleWizardDispatch)

	// Topology AI analysis endpoints (E-PLAT-001)
	mux.HandleFunc("/api/v1/topology/analyze", s.handleTopologyAnalyze)
	mux.HandleFunc("/api/v1/topology/critical-path", s.handleCriticalPath)
	mux.HandleFunc("/api/v1/topology/node-explain", s.handleNodeExplain)

	// WebSocket endpoint for AI chat
	mux.HandleFunc("/ws/chat", s.handleWebSocket)

	// Conversation endpoints
	mux.HandleFunc("/api/v1/conversations", s.handleConversationsList)
	mux.HandleFunc("/api/v1/conversations/", s.handleConversationGet)

	// Investigation endpoints (A-CORE-005)
	mux.HandleFunc("/api/v1/investigations", s.handleInvestigations)
	mux.HandleFunc("/api/v1/investigations/", s.handleInvestigationByID)
	mux.HandleFunc("/ws/investigations/", s.handleInvestigationStream)

	// Backend status and events endpoints (A-CORE-008)
	mux.HandleFunc("/api/v1/backend/status", s.handleBackendStatus)
	mux.HandleFunc("/api/v1/backend/events", s.handleBackendEvents)

	// Memory endpoints (A-CORE-009)
	mux.HandleFunc("/api/v1/memory/", s.handleMemory)
	mux.HandleFunc("/api/v1/memory", s.handleMemory)

	// Analytics pipeline endpoints (A-CORE-010)
	mux.HandleFunc("/api/v1/analytics/pipeline/", s.handleAnalyticsPipeline)
	mux.HandleFunc("/api/v1/analytics/pipeline", s.handleAnalyticsPipeline)

	// Cost intelligence endpoints (A-CORE-011)
	mux.HandleFunc("/api/v1/cost/", s.handleCostDispatch)
	mux.HandleFunc("/api/v1/cost", s.handleCostDispatch)

	// Security analysis endpoints (A-CORE-012)
	mux.HandleFunc("/api/v1/security/", s.handleSecurityDispatch)
	mux.HandleFunc("/api/v1/security", s.handleSecurityDispatch)

	// Persistence layer endpoints (A-CORE-013)
	mux.HandleFunc("/api/v1/persistence/", s.handlePersistenceDispatch)
	mux.HandleFunc("/api/v1/persistence", s.handlePersistenceDispatch)

	// Token budget endpoints (A-CORE-014)
	mux.HandleFunc("/api/v1/budget/", s.handleBudgetDispatch)
	mux.HandleFunc("/api/v1/budget", s.handleBudgetDispatch)

	// Runtime LLM provider configuration (doc 06 — BYOLLM, loopback-only).
	// POST /api/v1/config/provider — hot-wires a new LLM adapter without restart.
	mux.HandleFunc("/api/v1/config/provider", s.handleConfigProvider)

	// API key validation endpoint (loopback-only).
	// POST /api/v1/config/validate — validates an API key without saving it.
	mux.HandleFunc("/api/v1/config/validate", s.handleValidateAPIKey)

	// Model catalog endpoint.
	// GET /api/v1/config/models — returns curated model list per provider for the frontend dropdown.
	mux.HandleFunc("/api/v1/config/models", s.handleGetProviderModels)
}

// handleHealth handles health check requests.
// Returns llm_configured so the frontend can surface a "Configure AI Provider"
// prompt without waiting for an LLM call to fail.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	llmConfigured := s.config.LLM.Configured
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"healthy","llm_configured":%v,"llm_provider":%q,"timestamp":%q}`,
		llmConfigured, s.config.LLM.Provider, time.Now().Format(time.RFC3339))
}

// handleReady handles readiness check requests
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.RLock()
	// Ready means the HTTP server is up. LLM being unconfigured is not a readiness failure —
	// it is a user configuration state surfaced via /health's llm_configured field.
	ready := s.running
	s.mu.RUnlock()

	if !ready {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte(`{"status":"not_ready"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ready","timestamp":"` + time.Now().Format(time.RFC3339) + `"}`))
}

// handleInfo handles info requests
func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info := fmt.Sprintf(`{
		"name":"Kubilitics AI",
		"version":"0.1.0",
		"llm_provider":"%s",
		"safety_engine_enabled":%v,
		"analytics_enabled":%v,
		"autonomy_level":%d,
		"timestamp":"%s"
	}`,
		s.config.LLM.Provider,
		s.config.Safety.Enabled,
		s.config.Analytics.Enabled,
		s.config.Autonomy.DefaultLevel,
		time.Now().Format(time.RFC3339),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(info))
}

// toMap safely converts an interface{} to map[string]interface{}.
func toMap(v interface{}) map[string]interface{} {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return nil
}

// ReloadLLMAdapter rebuilds the LLM adapter from a freshly loaded config.
// This enables zero-downtime API key rotation: send SIGHUP to main, which
// calls cfgMgr.Reload() then srv.ReloadLLMAdapter(newCfg) (AI-015).
func (s *Server) ReloadLLMAdapter(newCfg *appconfig.Config) error {
	var apiKey, model, baseURL string
	switch newCfg.LLM.Provider {
	case "openai":
		apiKey, _ = newCfg.LLM.OpenAI["api_key"].(string)
		model, _ = newCfg.LLM.OpenAI["model"].(string)
	case "anthropic":
		apiKey, _ = newCfg.LLM.Anthropic["api_key"].(string)
		model, _ = newCfg.LLM.Anthropic["model"].(string)
	case "ollama":
		baseURL, _ = newCfg.LLM.Ollama["base_url"].(string)
		model, _ = newCfg.LLM.Ollama["model"].(string)
	case "custom":
		baseURL, _ = newCfg.LLM.Custom["base_url"].(string)
	}

	llmConfig := &adapter.Config{
		Provider: adapter.ProviderType(newCfg.LLM.Provider),
		APIKey:   apiKey,
		Model:    model,
		BaseURL:  baseURL,
	}

	newLLMAdapter, err := adapter.NewLLMAdapter(llmConfig)
	if err != nil {
		return fmt.Errorf("reload llm adapter: %w", err)
	}

	s.mu.Lock()
	s.llmAdapter = newLLMAdapter
	s.config = newCfg

	// Ensure the Reasoning Engine also receives the new adapter so any future chat requests
	// use the newly selected provider/model.
	if engine := s.GetReasoningEngine(); engine != nil {
		engine.SetLLMAdapter(newLLMAdapter)
	}
	s.mu.Unlock()

	fmt.Printf("LLM adapter reloaded: provider=%s configured=%v\n", newCfg.LLM.Provider, newCfg.LLM.Configured)
	return nil
}

// runBudgetRolloverCron blocks until ctx is cancelled, waking at midnight on
// the 1st of each month to advance period_start for all users (AI-016).
// This ensures the monthly spending window rolls over even if the service has
// been running continuously since the previous month.
func (s *Server) runBudgetRolloverCron(ctx context.Context) {
	for {
		now := time.Now().UTC()
		// Compute midnight on the 1st of next month.
		nextMonth := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		sleepDur := nextMonth.Sub(now)

		select {
		case <-ctx.Done():
			return
		case <-time.After(sleepDur):
		}

		if s.store == nil {
			continue
		}
		rollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		if err := s.store.RolloverAllBudgets(rollCtx); err != nil {
			fmt.Printf("[ERROR] Monthly budget rollover failed: %v\n", err)
		} else {
			fmt.Printf("[INFO] Monthly budget rollover completed at %s\n", time.Now().UTC().Format(time.RFC3339))
		}
		cancel()
	}
}

// corsMiddleware adds CORS headers to allow frontend requests.
// TASK-AI-002: Reads KUBILITICS_ALLOWED_ORIGINS env var (comma-separated) so the Tauri
// sidecar launcher can inject the correct origins without hardcoding them here.
func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	// Build allowed-origins set at middleware construction time (once).
	defaultOrigins := []string{
		"tauri://localhost",
		"tauri://",
		"http://tauri.localhost",
		"http://localhost:5173",
		"http://localhost:819",
		"http://localhost:8081",
	}
	allowedSet := make(map[string]struct{}, len(defaultOrigins))
	for _, o := range defaultOrigins {
		allowedSet[strings.ToLower(strings.TrimRight(o, "/"))] = struct{}{}
	}
	// Merge env-var overrides so the Tauri sidecar can inject its origins.
	if envOrigins := os.Getenv("KUBILITICS_ALLOWED_ORIGINS"); envOrigins != "" {
		for _, o := range strings.Split(envOrigins, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowedSet[strings.ToLower(strings.TrimRight(o, "/"))] = struct{}{}
			}
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		normalized := strings.ToLower(strings.TrimRight(origin, "/"))
		_, allowed := allowedSet[normalized]

		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "3600")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// API endpoint handlers are implemented in handlers.go and websocket.go
