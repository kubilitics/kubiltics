package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	appconfig "github.com/kubilitics/kubilitics-ai/internal/config"
)

// TestServerDegradedMode verifies that the server starts and operates
// correctly when no LLM provider is configured (degraded mode).
func TestServerDegradedMode(t *testing.T) {
	// Create a config with NO LLM credentials
	cfg := &appconfig.Config{}
	cfg.Server.Port = 18090
	cfg.Server.Host = "localhost"

	// Explicitly set provider to empty or none, and no API keys
	cfg.LLM.Provider = "openai"               // Even if provider is set, missing key should trigger degraded mode
	cfg.LLM.OpenAI = map[string]interface{}{} // Empty map, no api_key

	// Enable other components to ensure they still work
	cfg.Analytics.Enabled = true
	cfg.Safety.Enabled = true
	cfg.Autonomy.DefaultLevel = 2

	// Initialize server
	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("Failed to create server in degraded mode: %v", err)
	}

	// Verify LLM adapter is initialized but in "none" state
	adapter := srv.GetLLMAdapter()
	if adapter == nil {
		t.Fatal("LLM adapter should not be nil in degraded mode")
	}

	// Start server
	if err := srv.Start(); err != nil {
		t.Fatalf("Failed to start server: %v", err)
	}
	defer srv.Stop()

	// Give it a moment to start
	time.Sleep(100 * time.Millisecond)

	// 1. Verify /health endpoint reports llm_configured: false
	resp, err := http.Get("http://localhost:18090/health")
	if err != nil {
		t.Fatalf("Failed to call /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("/health returned %d, expected 200", resp.StatusCode)
	}

	var healthResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&healthResp); err != nil {
		t.Fatalf("Failed to decode /health response: %v", err)
	}

	if configured, ok := healthResp["llm_configured"].(bool); !ok || configured {
		t.Errorf("Expected llm_configured=false, got %v", healthResp["llm_configured"])
	}

	// 2. Verify non-LLM endpoints work (e.g., /info)
	resp, err = http.Get("http://localhost:18090/info")
	if err != nil {
		t.Fatalf("Failed to call /info: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("/info returned %d, expected 200", resp.StatusCode)
	}

	// 3. Verify LLM endpoints return 503 Service Unavailable
	// /api/v1/llm/complete
	reqBody := `{"messages":[{"role":"user","content":"hello"}]}`
	resp, err = http.Post("http://localhost:18090/api/v1/llm/complete", "application/json", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("Failed to call /api/v1/llm/complete: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("/api/v1/llm/complete returned %d, expected 503", resp.StatusCode)
	}

	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyStr := string(bodyBytes)
	if !strings.Contains(bodyStr, "LLM not configured") {
		t.Errorf("Expected error message about configuration, got: %s", bodyStr)
	}
}

func TestLLMAdapterDegradedConfig(t *testing.T) {
	// Test that LLM calls return specific error when unconfigured
	cfg := &appconfig.Config{}
	// No key provided

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer failed: %v", err)
	}

	adapter := srv.GetLLMAdapter()

	// Test Complete
	_, _, err = adapter.Complete(context.TODO(), nil, nil)
	if err == nil {
		t.Error("Expected error from Complete() in degraded mode, got nil")
	} else if !strings.Contains(err.Error(), "LLM provider not configured") {
		t.Errorf("Expected 'LLM provider not configured' error, got: %v", err)
	}

	// Test CountTokens
	_, err = adapter.CountTokens(context.TODO(), nil, nil)
	if err == nil {
		t.Error("Expected error from CountTokens() in degraded mode, got nil")
	}
}
