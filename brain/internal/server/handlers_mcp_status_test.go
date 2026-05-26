package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	mcpserver "github.com/vellankikoti/kubilitics/brain/internal/mcp/server"
)

// stubMCPServer satisfies the mcpserver.MCPServer interface for handler tests.
type stubMCPServer struct {
	stats      map[string]interface{}
	cert       map[string]interface{}
	budget     map[string]interface{}
	guardrails map[string]interface{}
}

func (m *stubMCPServer) RegisterTool(name, description string, schema interface{}, handler mcpserver.ToolHandler) error {
	return nil
}
func (m *stubMCPServer) ListTools(_ context.Context) ([]mcpserver.Tool, error) { return nil, nil }
func (m *stubMCPServer) ExecuteTool(_ context.Context, _ string, _ map[string]interface{}) (interface{}, error) {
	return nil, nil
}
func (m *stubMCPServer) GetTool(_ string) (*mcpserver.Tool, error) { return nil, nil }
func (m *stubMCPServer) Start(_ context.Context) error             { return nil }
func (m *stubMCPServer) Stop(_ context.Context) error              { return nil }
func (m *stubMCPServer) GetStats() map[string]interface{}          { return m.stats }
func (m *stubMCPServer) GetCertificationSummary() map[string]interface{} { return m.cert }
func (m *stubMCPServer) GetBudgetStats() map[string]interface{}    { return m.budget }
func (m *stubMCPServer) GetGuardrailsConfig() map[string]interface{} { return m.guardrails }

func buildMCPStatusServer(mcp mcpserver.MCPServer) *Server {
	return &Server{mcpServer: mcp}
}

func mcpGET(t *testing.T, srv *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	srv.handleMCPDispatch(w, req)
	return w
}

func TestHandleMCPDispatch_NoMCPServer(t *testing.T) {
	srv := &Server{mcpServer: nil}
	w := mcpGET(t, srv, "/api/v1/mcp/stats")
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestHandleMCPDispatch_MethodNotAllowed(t *testing.T) {
	srv := buildMCPStatusServer(&stubMCPServer{
		stats:      map[string]interface{}{},
		cert:       map[string]interface{}{},
		budget:     map[string]interface{}{},
		guardrails: map[string]interface{}{},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/mcp/stats", nil)
	w := httptest.NewRecorder()
	srv.handleMCPDispatch(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandleMCPDispatch_UnknownPath(t *testing.T) {
	srv := buildMCPStatusServer(&stubMCPServer{
		stats:      map[string]interface{}{},
		cert:       map[string]interface{}{},
		budget:     map[string]interface{}{},
		guardrails: map[string]interface{}{},
	})
	w := mcpGET(t, srv, "/api/v1/mcp/nonexistent")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandleMCPStats(t *testing.T) {
	stub := &stubMCPServer{
		stats: map[string]interface{}{
			"running":          true,
			"registered_tools": 157,
		},
		cert: map[string]interface{}{
			"enabled":     true,
			"certified":   0,
			"provisional": 148,
			"uncertified": 9,
			"blocked":     9,
		},
		budget: map[string]interface{}{
			"enabled":     true,
			"total_calls": 5,
			"limit":       50,
			"remaining":   45,
		},
		guardrails: map[string]interface{}{
			"enabled":                    true,
			"redactor_enabled":           true,
			"injection_scanner_enabled":  true,
			"max_tool_calls_per_session": 50,
		},
	}
	srv := buildMCPStatusServer(stub)
	w := mcpGET(t, srv, "/api/v1/mcp/stats")

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}

	if resp["running"] != true {
		t.Errorf("expected running=true")
	}
	if resp["certification"] == nil {
		t.Error("expected certification key")
	}
	if resp["budget"] == nil {
		t.Error("expected budget key")
	}
}

func TestHandleMCPStats_EmptyPath(t *testing.T) {
	stub := &stubMCPServer{
		stats:      map[string]interface{}{"running": false},
		cert:       map[string]interface{}{"enabled": false},
		budget:     map[string]interface{}{"enabled": false},
		guardrails: map[string]interface{}{"enabled": false},
	}
	srv := buildMCPStatusServer(stub)
	// bare /api/v1/mcp maps to stats
	w := mcpGET(t, srv, "/api/v1/mcp")
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandleMCPCertification(t *testing.T) {
	stub := &stubMCPServer{
		stats: map[string]interface{}{},
		cert: map[string]interface{}{
			"enabled":       true,
			"certified":     10,
			"provisional":   120,
			"uncertified":   27,
			"blocked":       9,
			"blocked_tools": []string{"delete_resource", "restart_pod"},
		},
		budget:     map[string]interface{}{},
		guardrails: map[string]interface{}{},
	}
	srv := buildMCPStatusServer(stub)
	w := mcpGET(t, srv, "/api/v1/mcp/certification")

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resp["enabled"] != true {
		t.Errorf("expected enabled=true")
	}
	if resp["blocked_tools"] == nil {
		t.Error("expected blocked_tools key")
	}
}

func TestHandleMCPGuardrails(t *testing.T) {
	stub := &stubMCPServer{
		stats: map[string]interface{}{},
		cert:  map[string]interface{}{},
		budget: map[string]interface{}{
			"enabled":     true,
			"total_calls": 3,
			"limit":       50,
			"remaining":   47,
		},
		guardrails: map[string]interface{}{
			"enabled":                    true,
			"redactor_enabled":           true,
			"injection_scanner_enabled":  true,
			"max_tool_calls_per_session": float64(50), // JSON numbers decode as float64
		},
	}
	srv := buildMCPStatusServer(stub)
	w := mcpGET(t, srv, "/api/v1/mcp/guardrails")

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resp["guardrails"] == nil {
		t.Error("expected guardrails key")
	}
	if resp["budget"] == nil {
		t.Error("expected budget key")
	}
	gr := resp["guardrails"].(map[string]interface{})
	if gr["redactor_enabled"] != true {
		t.Errorf("expected redactor_enabled=true, got %v", gr["redactor_enabled"])
	}
	if gr["injection_scanner_enabled"] != true {
		t.Errorf("expected injection_scanner_enabled=true, got %v", gr["injection_scanner_enabled"])
	}
	if gr["max_tool_calls_per_session"] != float64(50) {
		t.Errorf("expected max_tool_calls_per_session=50, got %v", gr["max_tool_calls_per_session"])
	}
}
