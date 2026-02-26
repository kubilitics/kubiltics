package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	reasoningengine "github.com/kubilitics/kubilitics-ai/internal/reasoning/engine"
	mcpserver "github.com/kubilitics/kubilitics-ai/internal/mcp/server"
)

// WebSocket message types
const (
	MessageTypeText      = "text"
	MessageTypeTool      = "tool"
	MessageTypeError     = "error"
	MessageTypeComplete  = "complete"
	MessageTypeHeartbeat = "heartbeat"
)

// WSMessage represents a WebSocket message
type WSMessage struct {
	Type      string                 `json:"type"`
	Content   string                 `json:"content,omitempty"`
	Tool      interface{}            `json:"tool,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// WSRequest represents an incoming WebSocket request
type WSRequest struct {
	Messages []types.Message        `json:"messages"`
	Tools    []types.Tool           `json:"tools,omitempty"`
	Stream   bool                   `json:"stream"`
	Context  map[string]interface{} `json:"context,omitempty"` // Current screen, resource, namespace
}

// defaultAllowedOrigins contains safe defaults for local development.
var defaultAllowedOrigins = []string{
	"http://localhost:3000",
	"http://localhost:5173",
	"tauri://localhost",
	"tauri://",
	"http://tauri.localhost",
}

// newUpgrader creates a WebSocket upgrader with origin checking.
// allowedOrigins: a list of permitted origins.
//   - If nil or empty, defaultAllowedOrigins is used.
//   - Pass []string{"*"} to allow any origin (development only).
func newUpgrader(allowedOrigins []string) websocket.Upgrader {
	if len(allowedOrigins) == 0 {
		allowedOrigins = defaultAllowedOrigins
	}

	// Build a set for O(1) lookup.
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[strings.ToLower(strings.TrimRight(o, "/"))] = true
	}
	allowAll := allowed["*"]

	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			if allowAll {
				return true
			}
			origin := strings.ToLower(strings.TrimRight(r.Header.Get("Origin"), "/"))
			if origin == "" {
				// No Origin header — allow same-host (non-browser) clients.
				return true
			}
			return allowed[origin]
		},
	}
}

// WSConnection represents an active WebSocket connection
type WSConnection struct {
	conn           *websocket.Conn
	server         *Server
	mu             sync.Mutex
	ctx            context.Context
	cancel         context.CancelFunc
	sessionID      string
	conversationID string // active conversation ID for history tracking
}

// handleWebSocket handles WebSocket connections for AI chat
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// AI-017: Enforce TLS for WebSocket connections
	if s.config.Server.RequireTLS && r.TLS == nil {
		http.Error(w, "TLS required for WebSocket connections", http.StatusUpgradeRequired)
		log.Printf("WebSocket connection rejected: TLS required but not used (remote: %s)", r.RemoteAddr)
		return
	}

	// Upgrade HTTP connection to WebSocket with origin checking.
	up := newUpgrader(s.config.Server.AllowedOrigins)
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Create connection context
	ctx, cancel := context.WithCancel(s.ctx)

	// Parse context from query params (e.g. ?namespace=default&resource=pod)
	wsContext := map[string]interface{}{
		"namespace": r.URL.Query().Get("namespace"),
		"resource":  r.URL.Query().Get("resource"),
		"screen":    r.URL.Query().Get("screen"),
	}

	// Create a new conversation for this connection
	var conversationID string
	if s.conversationStore != nil {
		conv := s.conversationStore.CreateConversation(wsContext)
		conversationID = conv.ID
	}

	// Create WebSocket connection
	wsConn := &WSConnection{
		conn:           conn,
		server:         s,
		ctx:            ctx,
		cancel:         cancel,
		sessionID:      fmt.Sprintf("ws-%d", time.Now().UnixNano()),
		conversationID: conversationID,
	}

	log.Printf("WebSocket connection established: %s (conversation: %s)", wsConn.sessionID, conversationID)

	// Handle connection
	wsConn.handle()
}

// handle manages the WebSocket connection lifecycle
func (wsc *WSConnection) handle() {
	defer func() {
		wsc.cancel()
		wsc.conn.Close()
		// Clean up conversation on disconnect to avoid unbounded growth.
		if wsc.server.conversationStore != nil && wsc.conversationID != "" {
			_ = wsc.server.conversationStore.DeleteConversation(wsc.conversationID)
		}
		log.Printf("WebSocket connection closed: %s", wsc.sessionID)
	}()

	// Start heartbeat
	go wsc.heartbeat()

	// Read messages
	for {
		select {
		case <-wsc.ctx.Done():
			return
		default:
			// Read message from client
			var req WSRequest
			err := wsc.conn.ReadJSON(&req)
			if err != nil {
				// Only keep connection open for recoverable JSON decode errors; close on connection/EOF errors
				var syntaxErr *json.SyntaxError
				var typeErr *json.UnmarshalTypeError
				if errors.As(err, &syntaxErr) || errors.As(err, &typeErr) {
					log.Printf("WebSocket invalid JSON (keeping connection open): %v", err)
					wsc.sendError(fmt.Sprintf("Invalid message format: %v", err))
					continue
				}
				if !websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					return
				}
				log.Printf("WebSocket read error: %v", err)
				return
			}

			// Process request
			if req.Stream {
				wsc.handleStreamRequest(&req)
			} else {
				wsc.handleCompleteRequest(&req)
			}
		}
	}
}

// maxHistoryMessages is the rolling-window size for conversation history.
// Keeps the last N assistant+user message pairs before the new user message.
const maxHistoryMessages = 10

// historyCharBudget is the soft limit on total characters of history to inject.
// Roughly 1 char ≈ 0.25 tokens so 16000 chars ≈ 4000 tokens of history.
const historyCharBudget = 16_000

// buildMessagesWithHistory prepends stored conversation history to the
// incoming user message(s), respecting maxHistoryMessages and historyCharBudget.
// The returned slice is safe to pass directly to the LLM adapter.
func buildMessagesWithHistory(cs *ConversationStore, convID string, incoming []types.Message) []types.Message {
	if cs == nil || convID == "" {
		return incoming
	}
	conv, err := cs.GetConversation(convID)
	if err != nil || len(conv.Messages) == 0 {
		return incoming
	}

	// Collect history messages (exclude the very last user message we just stored
	// to avoid duplicating it — the caller will include it via `incoming`).
	hist := conv.Messages
	// Drop the last message if it is the user message we just added.
	if len(hist) > 0 && hist[len(hist)-1].Role == "user" {
		hist = hist[:len(hist)-1]
	}

	// Apply rolling-window cap.
	if len(hist) > maxHistoryMessages {
		hist = hist[len(hist)-maxHistoryMessages:]
	}

	// Apply character-budget cap (newest messages take priority).
	totalChars := 0
	startIdx := len(hist)
	for i := len(hist) - 1; i >= 0; i-- {
		totalChars += len(hist[i].Content)
		if totalChars > historyCharBudget {
			startIdx = i + 1
			break
		}
		startIdx = i
	}
	hist = hist[startIdx:]

	// Convert ConversationMessage → types.Message.
	out := make([]types.Message, 0, len(hist)+len(incoming))
	for _, m := range hist {
		out = append(out, types.Message{Role: m.Role, Content: m.Content})
	}
	out = append(out, incoming...)
	return out
}

// handleStreamRequest handles streaming LLM requests.
// When the server has a ToolExecutor (MCP connected), the full agentic loop
// (CompleteWithTools) is used.  Otherwise it falls back to CompleteStream.
func (wsc *WSConnection) handleStreamRequest(req *WSRequest) {
	llmAdapter := wsc.server.GetLLMAdapter()
	if llmAdapter == nil {
		wsc.sendError("LLM adapter not initialized")
		return
	}

	// Persist user messages to conversation history.
	cs := wsc.server.conversationStore
	if cs != nil && wsc.conversationID != "" {
		for _, msg := range req.Messages {
			if msg.Role == "user" {
				_ = cs.AddMessage(wsc.conversationID, msg.Role, msg.Content, nil)
			}
		}
	}

	// Prepend conversation history so LLM has context.
	req.Messages = buildMessagesWithHistory(cs, wsc.conversationID, req.Messages)

	// Prefer the agentic loop when tools can be executed.
	toolExecutor := wsc.server.GetToolExecutor()
	if toolExecutor != nil {
		wsc.handleAgenticStream(req, llmAdapter, cs, toolExecutor)
		return
	}

	// Fallback: simple streaming (no tool execution).
	wsc.handleLegacyStream(req, llmAdapter, cs)
}

// handleAgenticStream runs the full multi-turn tool-calling loop and streams
// all events (text tokens, tool calls, results) to the client.
func (wsc *WSConnection) handleAgenticStream(
	req *WSRequest,
	llmAdapter interface {
		CompleteWithTools(context.Context, []types.Message, []types.Tool, types.ToolExecutor, types.AgentConfig) (<-chan types.AgentStreamEvent, error)
	},
	cs *ConversationStore,
	executor types.ToolExecutor,
) {
	// Use pod-first chat tool subset so the LLM gets a focused set (list_resources,
	// get_resource, get_logs, get_events, get_cluster_health, analyze_pod_health)
	// unless the client explicitly sends tools.
	tools := req.Tools
	if len(tools) == 0 {
		tools = reasoningengine.GetChatToolSchemas()
	}
	// Enforce API limit (OpenAI/Anthropic max 128 tools) so the request never fails with array_above_max_length.
	tools = types.CapToolsForAPI(tools)

	cfg := types.DefaultAgentConfig()
	evtCh, err := llmAdapter.CompleteWithTools(wsc.ctx, req.Messages, tools, executor, cfg)
	if err != nil {
		wsc.sendError(fmt.Sprintf("Failed to start agentic loop: %v", err))
		return
	}

	var fullResponse strings.Builder

	for evt := range evtCh {
		select {
		case <-wsc.ctx.Done():
			return
		default:
		}

		if evt.Err != nil {
			wsc.sendError(fmt.Sprintf("Agent error: %v", evt.Err))
			return
		}

		if evt.TextToken != "" {
			fullResponse.WriteString(evt.TextToken)
			wsc.send(&WSMessage{
				Type:      MessageTypeText,
				Content:   evt.TextToken,
				Timestamp: time.Now(),
			})
		}

		if evt.ToolEvent != nil {
			wsc.send(&WSMessage{
				Type:      MessageTypeTool,
				Tool:      evt.ToolEvent,
				Timestamp: time.Now(),
			})
		}

		if evt.Done {
			// Persist assistant response.
			if cs != nil && wsc.conversationID != "" {
				if resp := fullResponse.String(); resp != "" {
					_ = cs.AddMessage(wsc.conversationID, "assistant", resp, nil)
				}
			}
			wsc.send(&WSMessage{Type: MessageTypeComplete, Timestamp: time.Now()})
			return
		}
	}
}

// handleLegacyStream is the original streaming path without tool execution.
func (wsc *WSConnection) handleLegacyStream(
	req *WSRequest,
	llmAdapter interface {
		CompleteStream(context.Context, []types.Message, []types.Tool) (chan string, chan interface{}, error)
	},
	cs *ConversationStore,
) {
	textChan, toolChan, err := llmAdapter.CompleteStream(wsc.ctx, req.Messages, req.Tools)
	if err != nil {
		wsc.sendError(fmt.Sprintf("Failed to start streaming: %v", err))
		return
	}

	var fullResponse strings.Builder

	for {
		select {
		case <-wsc.ctx.Done():
			return

		case token, ok := <-textChan:
			if !ok {
				if cs != nil && wsc.conversationID != "" {
					if resp := fullResponse.String(); resp != "" {
						_ = cs.AddMessage(wsc.conversationID, "assistant", resp, nil)
					}
				}
				wsc.send(&WSMessage{Type: MessageTypeComplete, Timestamp: time.Now()})
				return
			}
			fullResponse.WriteString(token)
			wsc.send(&WSMessage{
				Type:      MessageTypeText,
				Content:   token,
				Timestamp: time.Now(),
			})

		case tool, ok := <-toolChan:
			if !ok {
				continue
			}
			wsc.send(&WSMessage{
				Type:      MessageTypeTool,
				Tool:      tool,
				Timestamp: time.Now(),
			})
		}
	}
}

// convertMCPTools converts MCP tool list to LLM types.Tool slice.
func convertMCPTools(mcpTools []mcpserver.Tool) []types.Tool {
	out := make([]types.Tool, len(mcpTools))
	for i, t := range mcpTools {
		schema, _ := t.InputSchema.(map[string]interface{})
		out[i] = types.Tool{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  schema,
		}
	}
	return out
}

// handleCompleteRequest handles non-streaming LLM requests
func (wsc *WSConnection) handleCompleteRequest(req *WSRequest) {
	// Get LLM adapter
	llmAdapter := wsc.server.GetLLMAdapter()
	if llmAdapter == nil {
		wsc.sendError("LLM adapter not initialized")
		return
	}

	// Persist user messages to conversation history
	cs := wsc.server.conversationStore
	if cs != nil && wsc.conversationID != "" {
		for _, msg := range req.Messages {
			if msg.Role == "user" {
				_ = cs.AddMessage(wsc.conversationID, msg.Role, msg.Content, nil)
			}
		}
	}

	// Prepend conversation history so LLM has context.
	req.Messages = buildMessagesWithHistory(cs, wsc.conversationID, req.Messages)

	// Call LLM
	response, tools, err := llmAdapter.Complete(wsc.ctx, req.Messages, req.Tools)
	if err != nil {
		wsc.sendError(fmt.Sprintf("LLM error: %v", err))
		return
	}

	// Persist assistant response to conversation history
	if cs != nil && wsc.conversationID != "" && response != "" {
		_ = cs.AddMessage(wsc.conversationID, "assistant", response, nil)
	}

	// Send response
	wsc.send(&WSMessage{
		Type:      MessageTypeText,
		Content:   response,
		Timestamp: time.Now(),
	})

	// Send tools if any
	for _, tool := range tools {
		wsc.send(&WSMessage{
			Type:      MessageTypeTool,
			Tool:      tool,
			Timestamp: time.Now(),
		})
	}

	// Send complete
	wsc.send(&WSMessage{
		Type:      MessageTypeComplete,
		Timestamp: time.Now(),
	})
}

// send sends a message to the client
func (wsc *WSConnection) send(msg *WSMessage) error {
	wsc.mu.Lock()
	defer wsc.mu.Unlock()

	wsc.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return wsc.conn.WriteJSON(msg)
}

// sendError sends an error message to the client
func (wsc *WSConnection) sendError(errMsg string) {
	wsc.send(&WSMessage{
		Type:      MessageTypeError,
		Error:     errMsg,
		Timestamp: time.Now(),
	})
}

// heartbeat sends periodic heartbeat messages
func (wsc *WSConnection) heartbeat() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-wsc.ctx.Done():
			return
		case <-ticker.C:
			wsc.send(&WSMessage{
				Type:      MessageTypeHeartbeat,
				Timestamp: time.Now(),
			})
		}
	}
}

// ConversationMessage represents a message in conversation history
type ConversationMessage struct {
	Role      string                 `json:"role"`
	Content   string                 `json:"content"`
	Timestamp time.Time              `json:"timestamp"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Conversation represents a conversation session
type Conversation struct {
	ID        string                 `json:"id"`
	Messages  []ConversationMessage  `json:"messages"`
	Context   map[string]interface{} `json:"context,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
}

// ConversationStore stores conversation history (in-memory for now)
type ConversationStore struct {
	mu            sync.RWMutex
	conversations map[string]*Conversation
}

// NewConversationStore creates a new conversation store
func NewConversationStore() *ConversationStore {
	return &ConversationStore{
		conversations: make(map[string]*Conversation),
	}
}

// CreateConversation creates a new conversation
func (cs *ConversationStore) CreateConversation(context map[string]interface{}) *Conversation {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	conv := &Conversation{
		ID:        fmt.Sprintf("conv-%d", time.Now().UnixNano()),
		Messages:  make([]ConversationMessage, 0),
		Context:   context,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	cs.conversations[conv.ID] = conv
	return conv
}

// GetConversation retrieves a conversation by ID
func (cs *ConversationStore) GetConversation(id string) (*Conversation, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	conv, ok := cs.conversations[id]
	if !ok {
		return nil, fmt.Errorf("conversation not found: %s", id)
	}

	return conv, nil
}

// GetOrCreateConversation retrieves an existing conversation or creates a new
// one with the given id if it does not exist yet. The created conversation has
// no messages and an empty context.
func (cs *ConversationStore) GetOrCreateConversation(id string) *Conversation {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if conv, ok := cs.conversations[id]; ok {
		return conv
	}

	conv := &Conversation{
		ID:        id,
		Messages:  make([]ConversationMessage, 0),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	cs.conversations[id] = conv
	return conv
}

// AddMessage adds a message to a conversation
func (cs *ConversationStore) AddMessage(convID string, role, content string, metadata map[string]interface{}) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	conv, ok := cs.conversations[convID]
	if !ok {
		return fmt.Errorf("conversation not found: %s", convID)
	}

	msg := ConversationMessage{
		Role:      role,
		Content:   content,
		Timestamp: time.Now(),
		Metadata:  metadata,
	}

	conv.Messages = append(conv.Messages, msg)
	conv.UpdatedAt = time.Now()

	return nil
}

// ListConversations returns all conversations
func (cs *ConversationStore) ListConversations() []*Conversation {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	convs := make([]*Conversation, 0, len(cs.conversations))
	for _, conv := range cs.conversations {
		convs = append(convs, conv)
	}

	return convs
}

// DeleteConversation deletes a conversation
func (cs *ConversationStore) DeleteConversation(id string) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if _, ok := cs.conversations[id]; !ok {
		return fmt.Errorf("conversation not found: %s", id)
	}

	delete(cs.conversations, id)
	return nil
}

// handleConversationsList handles listing conversations
func (s *Server) handleConversationsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var conversations []*Conversation
	if s.conversationStore != nil {
		conversations = s.conversationStore.ListConversations()
	} else {
		conversations = []*Conversation{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"conversations": conversations,
		"count":         len(conversations),
	})
}

// handleConversationGet handles getting a specific conversation by ID.
// If the conversation does not exist it is created so callers always receive
// a valid (possibly empty) conversation object rather than a 404.
func (s *Server) handleConversationGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract conversation ID from path: /api/v1/conversations/{id}
	// TrimSuffix handles any trailing slash left by the mux.
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/conversations/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "conversation ID required", http.StatusBadRequest)
		return
	}

	if s.conversationStore == nil {
		http.Error(w, "conversation store not available", http.StatusServiceUnavailable)
		return
	}

	// GetOrCreate: always return 200 with a valid conversation object.
	conv := s.conversationStore.GetOrCreateConversation(id)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(conv)
}
