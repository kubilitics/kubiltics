package websocket

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

func setupTestWebSocketHandler(t *testing.T) (*Handler, *Hub, *repository.SQLiteRepository) {
	t.Helper()
	repo, err := repository.NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	
	hub := NewHub(context.Background())
	go hub.Run()
	
	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
		AllowedOrigins: []string{"http://localhost:5173"},
	}
	
	handler := NewHandler(context.Background(), hub, nil, cfg, repo)
	return handler, hub, repo
}

func TestHandler_ExtractBearer_FromHeader(t *testing.T) {
	_, _, repo := setupTestWebSocketHandler(t)
	defer repo.Close()
	
	handler := &Handler{
		cfg: &config.Config{},
		repo: repo,
	}
	
	req := httptest.NewRequest(http.MethodGet, "/ws/resources", nil)
	req.Header.Set("Authorization", "Bearer test-token-123")
	
	token := handler.extractBearer(req)
	if token != "test-token-123" {
		t.Errorf("Expected token 'test-token-123', got '%s'", token)
	}
}

func TestHandler_ExtractBearer_FromQueryParam(t *testing.T) {
	_, _, repo := setupTestWebSocketHandler(t)
	defer repo.Close()
	
	handler := &Handler{
		cfg: &config.Config{},
		repo: repo,
	}
	
	req := httptest.NewRequest(http.MethodGet, "/ws/resources?token=query-token-456", nil)
	
	token := handler.extractBearer(req)
	if token != "query-token-456" {
		t.Errorf("Expected token 'query-token-456', got '%s'", token)
	}
}

func TestHandler_ExtractBearer_NoToken(t *testing.T) {
	_, _, repo := setupTestWebSocketHandler(t)
	defer repo.Close()
	
	handler := &Handler{
		cfg: &config.Config{},
		repo: repo,
	}
	
	req := httptest.NewRequest(http.MethodGet, "/ws/resources", nil)
	
	token := handler.extractBearer(req)
	if token != "" {
		t.Errorf("Expected empty token, got '%s'", token)
	}
}

func TestHandler_RejectConnection(t *testing.T) {
	_, _, repo := setupTestWebSocketHandler(t)
	defer repo.Close()
	
	handler := &Handler{
		cfg: &config.Config{},
		repo: repo,
	}
	
	rec := httptest.NewRecorder()
	handler.rejectConnection(rec, "Test error message")
	
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", rec.Code)
	}
	if rec.Header().Get("WWW-Authenticate") != "Bearer" {
		t.Error("Expected WWW-Authenticate header")
	}
	if rec.Body.String() != `{"error":"Test error message"}` {
		t.Errorf("Expected error message, got %s", rec.Body.String())
	}
}

func TestNewHandler_DefaultOrigins(t *testing.T) {
	cfg := &config.Config{
		AllowedOrigins: []string{},
	}
	
	hub := NewHub(context.Background())
	handler := NewHandler(context.Background(), hub, nil, cfg, nil)
	
	if handler == nil {
		t.Fatal("Handler should not be nil")
	}
}

func TestNewHandler_CustomOrigins(t *testing.T) {
	cfg := &config.Config{
		AllowedOrigins: []string{"https://example.com", "https://app.example.com"},
	}
	
	hub := NewHub(context.Background())
	handler := NewHandler(context.Background(), hub, nil, cfg, nil)
	
	if handler == nil {
		t.Fatal("Handler should not be nil")
	}
}

// TestWebSocketUpgrade_WithValidToken tests WebSocket upgrade with valid token
// Note: This is a simplified test - full WebSocket upgrade requires more setup
func TestHandler_CheckOrigin_AllowedOrigin(t *testing.T) {
	cfg := &config.Config{
		AllowedOrigins: []string{"http://localhost:5173"},
	}
	hub := NewHub(context.Background())
	handler := NewHandler(context.Background(), hub, nil, cfg, nil)
	
	req := httptest.NewRequest(http.MethodGet, "/ws/resources", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	
	allowed := handler.upgrader.CheckOrigin(req)
	if !allowed {
		t.Error("Origin should be allowed")
	}
}

func TestHandler_CheckOrigin_DisallowedOrigin(t *testing.T) {
	cfg := &config.Config{
		AllowedOrigins: []string{"http://localhost:5173"},
	}
	hub := NewHub(context.Background())
	handler := NewHandler(context.Background(), hub, nil, cfg, nil)
	
	req := httptest.NewRequest(http.MethodGet, "/ws/resources", nil)
	req.Header.Set("Origin", "http://evil.com")
	
	allowed := handler.upgrader.CheckOrigin(req)
	if allowed {
		t.Error("Origin should not be allowed")
	}
}

func TestHandler_CheckOrigin_NoOriginHeader(t *testing.T) {
	cfg := &config.Config{
		AllowedOrigins: []string{"http://localhost:5173"},
	}
	hub := NewHub(context.Background())
	handler := NewHandler(context.Background(), hub, nil, cfg, nil)
	
	req := httptest.NewRequest(http.MethodGet, "/ws/resources", nil)
	// No Origin header
	
	allowed := handler.upgrader.CheckOrigin(req)
	// Should allow if no origin (for native apps)
	if !allowed {
		t.Error("Should allow connection when no Origin header")
	}
}

// Mock websocket upgrader for testing
type mockUpgrader struct {
	checkOrigin func(*http.Request) bool
}

func (m *mockUpgrader) Upgrade(w http.ResponseWriter, r *http.Request, responseHeader http.Header) (*websocket.Conn, error) {
	return nil, nil
}
