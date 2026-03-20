package server

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
	"github.com/kubilitics/kubilitics-ai/internal/mcp/tools"
)

// MCPServer implements the Model Context Protocol server for Kubilitics AI
type MCPServer struct {
	config     *config.Config
	backend    *backend.Proxy
	auditLog   audit.Logger
	
	// Tool registry and handlers
	mu           sync.RWMutex
	toolHandlers map[string]ToolHandler
	enabledTools map[string]bool
	
	// Safety and security
	readOnlyMode     bool
	requireApproval  bool
	maxConcurrent    int
	
	// Statistics
	stats            MCPStats
}

// ToolHandler defines the interface for tool implementations
type ToolHandler interface {
	Execute(ctx context.Context, params map[string]interface{}) (interface{}, error)
	Validate(params map[string]interface{}) error
	GetDefinition() tools.ToolDefinition
}

// MCPStats tracks MCP server statistics
type MCPStats struct {
	TotalRequests    int64
	SuccessfulCalls  int64
	FailedCalls      int64
	ToolUsage        map[string]int64
	AverageLatency   float64
}

// ToolRequest represents an MCP tool execution request
type ToolRequest struct {
	Tool   string                 `json:"tool"`
	Params map[string]interface{} `json:"params"`
}

// ToolResponse represents an MCP tool execution response
type ToolResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// NewMCPServer creates a new MCP Server instance
func NewMCPServer(cfg *config.Config, backendProxy *backend.Proxy, auditLog audit.Logger) (*MCPServer, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if backendProxy == nil {
		return nil, fmt.Errorf("backend proxy is required")
	}
	if auditLog == nil {
		return nil, fmt.Errorf("audit logger is required")
	}

	server := &MCPServer{
		config:       cfg,
		backend:      backendProxy,
		auditLog:     auditLog,
		toolHandlers: make(map[string]ToolHandler),
		enabledTools: make(map[string]bool),
		readOnlyMode: cfg.Autonomy.ReadOnly,
		maxConcurrent: 10,
		stats: MCPStats{
			ToolUsage: make(map[string]int64),
		},
	}

	// Register all available tools
	server.registerTools()

	return server, nil
}

// registerTools registers all MCP tool handlers
func (s *MCPServer) registerTools() {
	// Enable all non-destructive tools by default
	for _, tool := range tools.ToolTaxonomy {
		if !tool.Destructive || !s.readOnlyMode {
			s.enabledTools[tool.Name] = true
		}
	}
}

// RegisterToolHandler registers a custom tool handler
func (s *MCPServer) RegisterToolHandler(name string, handler ToolHandler) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.toolHandlers[name]; exists {
		return fmt.Errorf("tool handler already registered: %s", name)
	}

	s.toolHandlers[name] = handler
	s.enabledTools[name] = true

	s.auditLog.Log(context.Background(), audit.NewEvent(audit.EventServerStarted).
		WithDescription(fmt.Sprintf("Registered MCP tool: %s", name)).
		WithResult(audit.ResultSuccess))

	return nil
}

// ExecuteTool executes an MCP tool request
func (s *MCPServer) ExecuteTool(ctx context.Context, request *ToolRequest) (*ToolResponse, error) {
	// Update statistics
	s.mu.Lock()
	s.stats.TotalRequests++
	s.stats.ToolUsage[request.Tool]++
	s.mu.Unlock()

	// Check if tool is enabled
	s.mu.RLock()
	enabled, exists := s.enabledTools[request.Tool]
	handler, hasHandler := s.toolHandlers[request.Tool]
	s.mu.RUnlock()

	if !exists || !enabled {
		return &ToolResponse{
			Success: false,
			Error:   fmt.Sprintf("tool not available: %s", request.Tool),
		}, fmt.Errorf("tool not available: %s", request.Tool)
	}

	// Get tool definition
	toolDef := tools.GetToolByName(request.Tool)
	if toolDef == nil {
		return &ToolResponse{
			Success: false,
			Error:   fmt.Sprintf("tool definition not found: %s", request.Tool),
		}, fmt.Errorf("tool definition not found: %s", request.Tool)
	}

	// Check for destructive operations
	if toolDef.Destructive && s.readOnlyMode {
		return &ToolResponse{
			Success: false,
			Error:   "destructive operations disabled in read-only mode",
		}, fmt.Errorf("destructive operations disabled")
	}

	// Log tool execution
	correlationID := audit.GenerateCorrelationID()
	ctx = audit.WithCorrelationID(ctx, correlationID)

	s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
		WithCorrelationID(correlationID).
		WithDescription(fmt.Sprintf("Executing MCP tool: %s", request.Tool)).
		WithResult(audit.ResultPending))

	// Execute tool handler if available
	if hasHandler {
		// Validate parameters
		if err := handler.Validate(request.Params); err != nil {
			s.mu.Lock()
			s.stats.FailedCalls++
			s.mu.Unlock()

			s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
				WithCorrelationID(correlationID).
				WithDescription("Tool validation failed").
				WithError(err, "validation_failed").
				WithResult(audit.ResultFailure))

			return &ToolResponse{
				Success: false,
				Error:   fmt.Sprintf("validation failed: %v", err),
			}, err
		}

		// Execute handler
		result, err := handler.Execute(ctx, request.Params)
		if err != nil {
			s.mu.Lock()
			s.stats.FailedCalls++
			s.mu.Unlock()

			s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
				WithCorrelationID(correlationID).
				WithDescription("Tool execution failed").
				WithError(err, "execution_failed").
				WithResult(audit.ResultFailure))

			return &ToolResponse{
				Success: false,
				Error:   fmt.Sprintf("execution failed: %v", err),
			}, err
		}

		s.mu.Lock()
		s.stats.SuccessfulCalls++
		s.mu.Unlock()

		s.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
			WithCorrelationID(correlationID).
			WithDescription("Tool executed successfully").
			WithResult(audit.ResultSuccess))

		return &ToolResponse{
			Success: true,
			Data:    result,
		}, nil
	}

	// No handler registered - return tool definition for AI to implement
	return &ToolResponse{
		Success: false,
		Error:   fmt.Sprintf("tool handler not implemented: %s", request.Tool),
	}, fmt.Errorf("tool handler not implemented")
}

// ListTools returns all available tools
func (s *MCPServer) ListTools() []tools.ToolDefinition {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var availableTools []tools.ToolDefinition
	for _, tool := range tools.ToolTaxonomy {
		if enabled, exists := s.enabledTools[tool.Name]; exists && enabled {
			availableTools = append(availableTools, tool)
		}
	}

	return availableTools
}

// GetStats returns MCP server statistics
func (s *MCPServer) GetStats() MCPStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Create a copy to avoid race conditions
	statsCopy := MCPStats{
		TotalRequests:   s.stats.TotalRequests,
		SuccessfulCalls: s.stats.SuccessfulCalls,
		FailedCalls:     s.stats.FailedCalls,
		AverageLatency:  s.stats.AverageLatency,
		ToolUsage:       make(map[string]int64),
	}

	for k, v := range s.stats.ToolUsage {
		statsCopy.ToolUsage[k] = v
	}

	return statsCopy
}

// EnableTool enables a specific tool
func (s *MCPServer) EnableTool(toolName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	toolDef := tools.GetToolByName(toolName)
	if toolDef == nil {
		return fmt.Errorf("tool not found: %s", toolName)
	}

	if toolDef.Destructive && s.readOnlyMode {
		return fmt.Errorf("cannot enable destructive tool in read-only mode: %s", toolName)
	}

	s.enabledTools[toolName] = true
	return nil
}

// DisableTool disables a specific tool
func (s *MCPServer) DisableTool(toolName string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.enabledTools[toolName] = false
	return nil
}

// ServeToolRequest handles incoming MCP tool requests (JSON-RPC style)
func (s *MCPServer) ServeToolRequest(ctx context.Context, requestJSON []byte) ([]byte, error) {
	var request ToolRequest
	if err := json.Unmarshal(requestJSON, &request); err != nil {
		return nil, fmt.Errorf("invalid request JSON: %w", err)
	}

	response, err := s.ExecuteTool(ctx, &request)
	if err != nil {
		// Error already logged in ExecuteTool
	}

	responseJSON, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal response: %w", err)
	}

	return responseJSON, nil
}

// SetReadOnlyMode enables/disables read-only mode
func (s *MCPServer) SetReadOnlyMode(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.readOnlyMode = enabled

	// Disable destructive tools if read-only mode is enabled
	if enabled {
		for _, tool := range tools.ToolTaxonomy {
			if tool.Destructive {
				s.enabledTools[tool.Name] = false
			}
		}
	}
}

// IsReadOnlyMode returns whether read-only mode is enabled
func (s *MCPServer) IsReadOnlyMode() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readOnlyMode
}
