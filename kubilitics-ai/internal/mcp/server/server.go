package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
	"github.com/kubilitics/kubilitics-ai/internal/mcp/tools"
	analysistools "github.com/kubilitics/kubilitics-ai/internal/mcp/tools/analysis"
	executiontools "github.com/kubilitics/kubilitics-ai/internal/mcp/tools/execution"
	"github.com/kubilitics/kubilitics-ai/internal/metrics"
	"github.com/kubilitics/kubilitics-ai/internal/safety"
)

// Package server implements the Model Context Protocol (MCP) server.
//
// CRITICAL: The MCP Server is THE SOLE INTERFACE between the LLM and the Kubernetes cluster.
//
// Responsibilities:
//   - Implement the Model Context Protocol specification (Anthropic standard)
//   - Register all available tools for the LLM to call
//   - Validate tool calls and their arguments
//   - Execute tool calls and return results to LLM
//   - Maintain MCP protocol state (session management, message ordering)
//   - Handle streaming of tool results for long-running operations
//   - Enforce tool call limits and timeouts
//   - Log all tool calls for auditability and debugging

// MCPServer defines the interface for the Model Context Protocol server.
type MCPServer interface {
	// RegisterTool registers a new tool that the LLM can call.
	RegisterTool(name string, description string, schema interface{}, handler ToolHandler) error

	// ListTools returns all registered tools with their schemas and descriptions.
	ListTools(ctx context.Context) ([]Tool, error)

	// ExecuteTool executes a tool call from the LLM.
	ExecuteTool(ctx context.Context, toolName string, args map[string]interface{}) (interface{}, error)

	// GetTool retrieves a tool definition by name.
	GetTool(name string) (*Tool, error)

	// Start starts the MCP server (websocket or stdio transport).
	Start(ctx context.Context) error

	// Stop gracefully stops the MCP server.
	Stop(ctx context.Context) error

	// GetStats returns server statistics.
	GetStats() map[string]interface{}
}

// Tool represents a single tool available to the LLM.
type Tool struct {
	Name                  string      `json:"name"`
	Description           string      `json:"description"`
	InputSchema           interface{} `json:"inputSchema"`
	Category              string      `json:"category"`
	Destructive           bool        `json:"destructive"`
	RequiresAI            bool        `json:"requiresAI"`
	RequiredAutonomyLevel int         `json:"requiredAutonomyLevel"`
}

// ToolHandler is the function signature for tool execution handlers.
type ToolHandler func(ctx context.Context, args map[string]interface{}) (interface{}, error)

// ToolCall represents a single tool execution record.
type ToolCall struct {
	ToolName      string
	Args          map[string]interface{}
	Result        interface{}
	Error         error
	Duration      time.Duration
	Timestamp     time.Time
	CorrelationID string
}

// mcpServerImpl is the concrete implementation of MCPServer.
type mcpServerImpl struct {
	config         *config.Config
	backendProxy   *backend.Proxy
	auditLog       audit.Logger
	analysisTools  *analysistools.AnalysisTools   // Tier-2 deep analysis tools (A-CORE-003)
	executionTools *executiontools.ExecutionTools // Safety-gated execution tools (A-CORE-004)

	// Tool registry
	mu       sync.RWMutex
	tools    map[string]*toolRegistration
	handlers map[string]ToolHandler

	// Server state
	running   bool
	startTime time.Time
	stopChan  chan struct{}

	// Statistics
	stats struct {
		sync.RWMutex
		TotalCalls      int64
		SuccessfulCalls int64
		FailedCalls     int64
		AvgDuration     time.Duration
		CallsByTool     map[string]int64
	}

	// Rate limiting
	rateLimiter *rateLimiter
}

// toolRegistration holds the tool definition and handler.
type toolRegistration struct {
	Tool    *Tool
	Handler ToolHandler
}

// rateLimiter implements simple token bucket rate limiting.
type rateLimiter struct {
	mu         sync.Mutex
	maxTokens  int
	tokens     int
	refillRate time.Duration
	lastRefill time.Time
}

// NewMCPServer creates a new MCP server with all tool registrations.
func NewMCPServer(cfg *config.Config, backendProxy *backend.Proxy, auditLog audit.Logger, store db.Store) (MCPServer, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if backendProxy == nil {
		return nil, fmt.Errorf("backend proxy is required")
	}
	if auditLog == nil {
		return nil, fmt.Errorf("audit logger is required")
	}
	if store == nil {
		return nil, fmt.Errorf("store is required")
	}

	safetyEngine, err := safety.NewEngine(store)
	if err != nil {
		return nil, fmt.Errorf("failed to create safety engine: %w", err)
	}

	server := &mcpServerImpl{
		config:         cfg,
		backendProxy:   backendProxy,
		auditLog:       auditLog,
		analysisTools:  analysistools.NewAnalysisTools(backendProxy),
		executionTools: executiontools.NewExecutionTools(backendProxy, safetyEngine, auditLog),
		tools:          make(map[string]*toolRegistration),
		handlers:       make(map[string]ToolHandler),
		stopChan:       make(chan struct{}),
		rateLimiter:    newRateLimiter(100, time.Second), // 100 calls per second
	}

	server.stats.CallsByTool = make(map[string]int64)

	// Register all tools from taxonomy
	if err := server.registerAllTools(); err != nil {
		return nil, fmt.Errorf("failed to register tools: %w", err)
	}

	return server, nil
}

// RegisterTool registers a new tool with the MCP server.
func (s *mcpServerImpl) RegisterTool(name string, description string, schema interface{}, handler ToolHandler) error {
	return s.registerToolWithCategory(name, description, schema, handler, "", false, false, 0)
}

// registerToolWithCategory registers a tool with full metadata.
func (s *mcpServerImpl) registerToolWithCategory(name string, description string, schema interface{}, handler ToolHandler, category string, destructive bool, requiresAI bool, requiredAutonomyLevel int) error {
	if name == "" {
		return fmt.Errorf("tool name is required")
	}
	if handler == nil {
		return fmt.Errorf("tool handler is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.tools[name]; exists {
		return fmt.Errorf("tool %s already registered", name)
	}

	tool := &Tool{
		Name:                  name,
		Description:           description,
		InputSchema:           schema,
		Category:              category,
		Destructive:           destructive,
		RequiresAI:            requiresAI,
		RequiredAutonomyLevel: requiredAutonomyLevel,
	}

	s.tools[name] = &toolRegistration{
		Tool:    tool,
		Handler: handler,
	}

	return nil
}

// ListTools returns all registered tools.
func (s *mcpServerImpl) ListTools(ctx context.Context) ([]Tool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]Tool, 0, len(s.tools))
	for _, reg := range s.tools {
		result = append(result, *reg.Tool)
	}

	return result, nil
}

// GetTool retrieves a tool definition by name.
func (s *mcpServerImpl) GetTool(name string) (*Tool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	reg, exists := s.tools[name]
	if !exists {
		return nil, fmt.Errorf("tool not found: %s", name)
	}

	return reg.Tool, nil
}

// ExecuteTool executes a tool call from the LLM.
func (s *mcpServerImpl) ExecuteTool(ctx context.Context, toolName string, args map[string]interface{}) (interface{}, error) {
	// Rate limiting
	if !s.rateLimiter.Allow() {
		return nil, fmt.Errorf("rate limit exceeded")
	}

	startTime := time.Now()
	correlationID := audit.GenerateCorrelationID()
	ctx = audit.WithCorrelationID(ctx, correlationID)

	// Get tool registration
	s.mu.RLock()
	reg, exists := s.tools[toolName]
	s.mu.RUnlock()

	if !exists {
		s.recordFailure(toolName)
		return nil, fmt.Errorf("tool not found: %s", toolName)
	}

	// Log tool call start
	s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
		WithCorrelationID(correlationID).
		WithDescription(fmt.Sprintf("Executing tool: %s", toolName)).
		WithResult(audit.ResultPending))

	// Execute tool handler
	result, err := reg.Handler(ctx, args)
	duration := time.Since(startTime)
	metrics.MCPToolDuration.WithLabelValues(toolName).Observe(duration.Seconds())

	// Record statistics
	if err != nil {
		s.recordFailure(toolName)
		metrics.MCPToolCalls.WithLabelValues(toolName, "error").Inc()
		s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionFailed).
			WithCorrelationID(correlationID).
			WithDescription(fmt.Sprintf("Tool execution failed: %s", toolName)).
			WithError(err, "tool_execution_failed").
			WithResult(audit.ResultFailure))
		return nil, fmt.Errorf("tool execution failed: %w", err)
	}

	s.recordSuccess(toolName, duration)
	metrics.MCPToolCalls.WithLabelValues(toolName, "success").Inc()
	s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithCorrelationID(correlationID).
		WithDescription(fmt.Sprintf("Tool executed successfully: %s", toolName)).
		WithResult(audit.ResultSuccess))

	return result, nil
}

// Start starts the MCP server.
func (s *mcpServerImpl) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("server already running")
	}
	s.running = true
	s.startTime = time.Now()
	s.mu.Unlock()

	correlationID := audit.GenerateCorrelationID()
	ctx = audit.WithCorrelationID(ctx, correlationID)

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
		WithCorrelationID(correlationID).
		WithDescription("MCP Server started").
		WithResult(audit.ResultSuccess))

	return nil
}

// Stop gracefully stops the MCP server.
func (s *mcpServerImpl) Stop(ctx context.Context) error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.running = false
	s.mu.Unlock()

	close(s.stopChan)

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventServerShutdown).
		WithDescription("MCP Server stopped").
		WithResult(audit.ResultSuccess))

	return nil
}

// GetStats returns server statistics.
func (s *mcpServerImpl) GetStats() map[string]interface{} {
	s.stats.RLock()
	defer s.stats.RUnlock()

	s.mu.RLock()
	toolCount := len(s.tools)
	running := s.running
	startTime := s.startTime
	s.mu.RUnlock()

	var uptime time.Duration
	if running {
		uptime = time.Since(startTime)
	}

	var successRate float64
	if s.stats.TotalCalls > 0 {
		successRate = float64(s.stats.SuccessfulCalls) / float64(s.stats.TotalCalls) * 100
	}

	return map[string]interface{}{
		"running":          running,
		"uptime":           uptime.String(),
		"registered_tools": toolCount,
		"total_calls":      s.stats.TotalCalls,
		"successful_calls": s.stats.SuccessfulCalls,
		"failed_calls":     s.stats.FailedCalls,
		"success_rate":     fmt.Sprintf("%.2f%%", successRate),
		"avg_duration":     s.stats.AvgDuration.String(),
		"calls_by_tool":    s.stats.CallsByTool,
	}
}

// recordSuccess records a successful tool call.
func (s *mcpServerImpl) recordSuccess(toolName string, duration time.Duration) {
	s.stats.Lock()
	defer s.stats.Unlock()

	s.stats.TotalCalls++
	s.stats.SuccessfulCalls++
	s.stats.CallsByTool[toolName]++

	// Update average duration
	if s.stats.TotalCalls == 1 {
		s.stats.AvgDuration = duration
	} else {
		s.stats.AvgDuration = time.Duration(
			(int64(s.stats.AvgDuration)*int64(s.stats.TotalCalls-1) + int64(duration)) / int64(s.stats.TotalCalls),
		)
	}
}

// recordFailure records a failed tool call.
func (s *mcpServerImpl) recordFailure(toolName string) {
	s.stats.Lock()
	defer s.stats.Unlock()

	s.stats.TotalCalls++
	s.stats.FailedCalls++
	s.stats.CallsByTool[toolName]++
}

// registerAllTools registers all tools from the taxonomy.
func (s *mcpServerImpl) registerAllTools() error {
	totalTools := 0

	// Register observation tools
	observationTools := tools.GetToolsByCategory(tools.CategoryObservation)
	for _, toolDef := range observationTools {
		handler := s.createObservationHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register observation tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register analysis tools
	analysisTools := tools.GetToolsByCategory(tools.CategoryAnalysis)
	for _, toolDef := range analysisTools {
		handler := s.createAnalysisHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register analysis tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register recommendation tools
	recommendationTools := tools.GetToolsByCategory(tools.CategoryRecommendation)
	for _, toolDef := range recommendationTools {
		handler := s.createRecommendationHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register recommendation tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register troubleshooting tools
	troubleshootingTools := tools.GetToolsByCategory(tools.CategoryTroubleshooting)
	for _, toolDef := range troubleshootingTools {
		handler := s.createTroubleshootingHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register troubleshooting tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register security tools
	securityTools := tools.GetToolsByCategory(tools.CategorySecurity)
	for _, toolDef := range securityTools {
		handler := s.createSecurityHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register security tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register cost tools
	costTools := tools.GetToolsByCategory(tools.CategoryCost)
	for _, toolDef := range costTools {
		handler := s.createCostHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register cost tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register action tools
	actionTools := tools.GetToolsByCategory(tools.CategoryAction)
	for _, toolDef := range actionTools {
		handler := s.createActionHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register action tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register automation tools
	automationTools := tools.GetToolsByCategory(tools.CategoryAutomation)
	for _, toolDef := range automationTools {
		handler := s.createAutomationHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register automation tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	// Register execution tools (safety-gated)
	executionToolDefs := tools.GetToolsByCategory(tools.CategoryExecution)
	for _, toolDef := range executionToolDefs {
		handler := s.createExecutionHandler(&toolDef)
		if err := s.registerToolWithCategory(toolDef.Name, toolDef.Description, toolDef.InputSchema, handler, string(toolDef.Category), toolDef.Destructive, toolDef.RequiresAI, toolDef.RequiredAutonomyLevel); err != nil {
			return fmt.Errorf("failed to register execution tool %s: %w", toolDef.Name, err)
		}
		totalTools++
	}

	s.auditLog.Log(context.Background(), audit.NewEvent(audit.EventServerStarted).
		WithDescription(fmt.Sprintf("Registered %d tools across 9 categories (includes 12 deep-analysis A-CORE-003 tools and 9 safety-gated A-CORE-004 execution tools)", totalTools)).
		WithResult(audit.ResultSuccess))

	return nil
}

// createObservationHandler creates a handler for observation tools.
// All routing is delegated to routeObservationTool (handlers_observation.go).
func (s *mcpServerImpl) createObservationHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name // capture
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeObservationTool(ctx, name, args)
	}
}

// createAnalysisHandler creates a handler for analysis tools.
// Tier-2 deep analysis tools (added in A-CORE-003) are routed to analysisTools.HandlerMap();
// the legacy Tier-1 AI-synthesised tools fall through to routeAnalysisTool.
func (s *mcpServerImpl) createAnalysisHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	// Check if this tool has a deep-analysis handler (A-CORE-003 tools).
	if deepHandler, ok := s.analysisTools.HandlerMap()[name]; ok {
		return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			return deepHandler(ctx, args)
		}
	}
	// Fall back to Tier-1 HTTP-based analysis router.
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeAnalysisTool(ctx, name, args)
	}
}

// createRecommendationHandler creates a handler for recommendation tools.
func (s *mcpServerImpl) createRecommendationHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeRecommendationTool(ctx, name, args)
	}
}

// createTroubleshootingHandler creates a handler for troubleshooting tools.
func (s *mcpServerImpl) createTroubleshootingHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeTroubleshootingTool(ctx, name, args)
	}
}

// createSecurityHandler creates a handler for security tools.
func (s *mcpServerImpl) createSecurityHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeSecurityTool(ctx, name, args)
	}
}

// createCostHandler creates a handler for cost tools.
func (s *mcpServerImpl) createCostHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeCostTool(ctx, name, args)
	}
}

// createActionHandler creates a handler for action tools.
func (s *mcpServerImpl) createActionHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeActionTool(ctx, name, args)
	}
}

// createExecutionHandler creates a handler for safety-gated execution tools.
func (s *mcpServerImpl) createExecutionHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	if execHandler, ok := s.executionTools.HandlerMap()[name]; ok {
		return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
			return execHandler(ctx, args)
		}
	}
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return nil, fmt.Errorf("execution tool handler not found: %s", name)
	}
}

// createAutomationHandler creates a handler for automation tools.
func (s *mcpServerImpl) createAutomationHandler(toolDef *tools.ToolDefinition) ToolHandler {
	name := toolDef.Name
	return func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
		return s.routeAutomationTool(ctx, name, args)
	}
}

// newRateLimiter creates a new rate limiter.
func newRateLimiter(maxTokens int, refillRate time.Duration) *rateLimiter {
	return &rateLimiter{
		maxTokens:  maxTokens,
		tokens:     maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

// Allow checks if a request is allowed under rate limiting.
func (rl *rateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Refill tokens based on elapsed time
	now := time.Now()
	elapsed := now.Sub(rl.lastRefill)
	if elapsed >= rl.refillRate {
		periods := int(elapsed / rl.refillRate)
		rl.tokens = min(rl.maxTokens, rl.tokens+periods)
		rl.lastRefill = now
	}

	// Check if we have tokens available
	if rl.tokens > 0 {
		rl.tokens--
		return true
	}

	return false
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// MarshalJSON implements custom JSON marshaling for Tool.
func (t *Tool) MarshalJSON() ([]byte, error) {
	type Alias Tool
	return json.Marshal(&struct {
		*Alias
	}{
		Alias: (*Alias)(t),
	})
}

// nsQuery is a helper to build a namespace query string.
func nsQuery(namespace string) string {
	if namespace != "" {
		return "?namespace=" + url.PathEscape(namespace)
	}
	return ""
}
