package server

import (
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	appconfig "github.com/kubilitics/kubilitics-ai/internal/config"
)

func createServerTestConfig() *appconfig.Config {
	var cfg appconfig.Config
	cfg.Server.Port = 8081
	cfg.Server.Host = "localhost"
	cfg.LLM.Provider = "openai"
	cfg.LLM.OpenAI = map[string]interface{}{
		"api_key": "test-key",
		"model":   "gpt-4o",
	}
	cfg.LLM.Configured = true
	cfg.Safety.Enabled = false
	cfg.Analytics.Enabled = false
	cfg.Autonomy.DefaultLevel = 3
	return &cfg
}

func TestNewServer(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Safety.Enabled = true
	cfg.Analytics.Enabled = true

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if srv == nil {
		t.Fatal("NewServer() returned nil")
	}

	// Check components initialized
	if srv.llmAdapter == nil {
		t.Error("LLM adapter not initialized")
	}

	if srv.safetyEngine == nil {
		t.Error("Safety engine not initialized")
	}

	if srv.analyticsEngine == nil {
		t.Error("Analytics engine not initialized")
	}
}

func TestNewServer_NilConfig(t *testing.T) {
	_, err := NewServer(nil)
	if err == nil {
		t.Error("Expected error for nil config, got nil")
	}
}

func TestServerLifecycle(t *testing.T) {
	// Use a different port to avoid conflicts
	cfg := createServerTestConfig()
	cfg.Server.Port = 18080
	cfg.Safety.Enabled = true
	cfg.Analytics.Enabled = true

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// Start server
	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Wait a bit for server to be ready
	time.Sleep(100 * time.Millisecond)

	// Check server is running
	if !srv.IsRunning() {
		t.Error("Server should be running after Start()")
	}

	// Test health endpoint
	resp, err := http.Get("http://localhost:18080/health")
	if err != nil {
		t.Errorf("Health check failed: %v", err)
	} else {
		if resp.StatusCode != http.StatusOK {
			t.Errorf("Expected status 200, got %d", resp.StatusCode)
		}
		resp.Body.Close()
	}

	// Stop server
	if err := srv.Stop(); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	// Check server is stopped
	if srv.IsRunning() {
		t.Error("Server should not be running after Stop()")
	}
}

func TestHealthEndpoint(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Server.Port = 18081

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Stop()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:18081/health")
	if err != nil {
		t.Fatalf("GET /health failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Health response: %s", string(body))
}

func TestReadyEndpoint(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Server.Port = 18082

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Stop()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:18082/ready")
	if err != nil {
		t.Fatalf("GET /ready failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Ready response: %s", string(body))
}

func TestInfoEndpoint(t *testing.T) {
	// Use OpenAI instead of Ollama to avoid connection issues in tests
	cfg := createServerTestConfig()
	cfg.Server.Port = 18083
	cfg.Safety.Enabled = true
	cfg.Analytics.Enabled = true

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Stop()

	time.Sleep(100 * time.Millisecond)

	resp, err := http.Get("http://localhost:18083/info")
	if err != nil {
		t.Fatalf("GET /info failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Info response: %s", string(body))
}

func TestGetComponents(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Server.Port = 18084
	cfg.Safety.Enabled = true
	cfg.Analytics.Enabled = true

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// Check components are accessible
	if srv.GetLLMAdapter() == nil {
		t.Error("GetLLMAdapter() returned nil")
	}

	if srv.GetSafetyEngine() == nil {
		t.Error("GetSafetyEngine() returned nil")
	}

	if srv.GetAnalyticsEngine() == nil {
		t.Error("GetAnalyticsEngine() returned nil")
	}
}

func TestOllamaProvider(t *testing.T) {
	// Skip if Ollama is not running
	t.Skip("Skipping Ollama test - requires Ollama running on localhost:11434")

	cfg := createServerTestConfig()
	cfg.Server.Port = 18085
	cfg.LLM.Provider = "ollama"
	cfg.LLM.Ollama = map[string]interface{}{
		"model":    "llama3",
		"base_url": "http://localhost:11434",
	}

	// This will work even if Ollama is not running
	// The client will be created but connections will fail gracefully
	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() with Ollama error: %v", err)
	}

	if srv.llmAdapter == nil {
		t.Error("Ollama LLM adapter not initialized")
	}
}

func TestServerDoubleStart(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Server.Port = 18086

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// First start should succeed
	if err := srv.Start(); err != nil {
		t.Fatalf("First Start() error: %v", err)
	}
	defer srv.Stop()

	// Second start should fail
	err = srv.Start()
	if err == nil {
		t.Error("Expected error for double Start(), got nil")
	}
}

func TestServerStopBeforeStart(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Server.Port = 18087

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	// Stop before start should fail
	err = srv.Stop()
	if err == nil {
		t.Error("Expected error for Stop() before Start(), got nil")
	}
}

func TestServerContext(t *testing.T) {
	cfg := createServerTestConfig()
	cfg.Server.Port = 18088

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer() error: %v", err)
	}

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Wait in background
	waitDone := make(chan struct{})
	go func() {
		srv.Wait()
		close(waitDone)
	}()

	// Stop server
	if err := srv.Stop(); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}

	// Wait should unblock
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	select {
	case <-waitDone:
		// Success - Wait() returned
	case <-ctx.Done():
		t.Error("Wait() did not return after Stop()")
	}
}
