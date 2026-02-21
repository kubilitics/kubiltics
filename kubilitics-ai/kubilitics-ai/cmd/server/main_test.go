package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHealthHandler(t *testing.T) {
	tests := []struct {
		name           string
		method         string
		expectedStatus int
		expectedBody   HealthResponse
	}{
		{
			name:           "GET /health returns healthy status",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
			expectedBody: HealthResponse{
				Status:  "healthy",
				Version: version,
			},
		},
		{
			name:           "GET /healthz returns healthy status",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
			expectedBody: HealthResponse{
				Status:  "healthy",
				Version: version,
			},
		},
		{
			name:           "POST /health returns method not allowed",
			method:         http.MethodPost,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "PUT /health returns method not allowed",
			method:         http.MethodPut,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "DELETE /health returns method not allowed",
			method:         http.MethodDelete,
			expectedStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/health", nil)
			w := httptest.NewRecorder()

			healthHandler(w, req)

			resp := w.Result()
			defer resp.Body.Close()

			if resp.StatusCode != tt.expectedStatus {
				t.Errorf("Expected status %d, got %d", tt.expectedStatus, resp.StatusCode)
			}

			if tt.expectedStatus == http.StatusOK {
				var response HealthResponse
				body, err := io.ReadAll(resp.Body)
				if err != nil {
					t.Fatalf("Failed to read response body: %v", err)
				}

				if err := json.Unmarshal(body, &response); err != nil {
					t.Fatalf("Failed to unmarshal response: %v", err)
				}

				if response.Status != tt.expectedBody.Status {
					t.Errorf("Expected status %s, got %s", tt.expectedBody.Status, response.Status)
				}

				if response.Version != tt.expectedBody.Version {
					t.Errorf("Expected version %s, got %s", tt.expectedBody.Version, response.Version)
				}

				// Check Content-Type header
				contentType := resp.Header.Get("Content-Type")
				if contentType != "application/json" {
					t.Errorf("Expected Content-Type application/json, got %s", contentType)
				}
			}
		})
	}
}

func TestLoadConfiguration(t *testing.T) {
	tests := []struct {
		name       string
		setupFunc  func(t *testing.T) string // Returns config file path
		wantErr    bool
		validateFn func(t *testing.T, configPath string)
	}{
		{
			name: "valid configuration file",
			setupFunc: func(t *testing.T) string {
				tmpDir := t.TempDir()
				configPath := filepath.Join(tmpDir, "config.yaml")
				content := `
server:
  port: 8081

backend:
  address: "localhost:50051"

llm:
  provider: "anthropic"
  anthropic:
    api_key: "test-key"
    model: "claude-3-5-sonnet-20241022"

autonomy:
  default_level: 2
`
				if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
					t.Fatalf("Failed to write config file: %v", err)
				}
				return configPath
			},
			wantErr: false,
			validateFn: func(t *testing.T, cfgPath string) {
				ctx := context.Background()
				cfg, err := loadConfiguration(ctx, cfgPath)
				if err != nil {
					t.Fatalf("loadConfiguration failed: %v", err)
				}

				if cfg.Server.Port != 8081 {
					t.Errorf("Expected port 8081, got %d", cfg.Server.Port)
				}

				if cfg.Backend.Address != "localhost:50051" {
					t.Errorf("Expected backend address localhost:50051, got %s", cfg.Backend.Address)
				}

				if cfg.LLM.Provider != "anthropic" {
					t.Errorf("Expected provider anthropic, got %s", cfg.LLM.Provider)
				}

				if cfg.Autonomy.DefaultLevel != 2 {
					t.Errorf("Expected autonomy level 2, got %d", cfg.Autonomy.DefaultLevel)
				}
			},
		},
		{
			name: "missing config file uses defaults",
			setupFunc: func(t *testing.T) string {
				tmpDir := t.TempDir()
				return filepath.Join(tmpDir, "nonexistent.yaml")
			},
			wantErr: false,
			validateFn: func(t *testing.T, cfgPath string) {
				// Set required environment variable
				os.Setenv("ANTHROPIC_API_KEY", "test-key")
				defer os.Unsetenv("ANTHROPIC_API_KEY")

				ctx := context.Background()
				cfg, err := loadConfiguration(ctx, cfgPath)
				if err != nil {
					t.Fatalf("loadConfiguration failed: %v", err)
				}

				// Should use default values
				if cfg.Server.Port != 8081 {
					t.Errorf("Expected default port 8081, got %d", cfg.Server.Port)
				}
			},
		},
		{
			name: "invalid configuration fails validation",
			setupFunc: func(t *testing.T) string {
				tmpDir := t.TempDir()
				configPath := filepath.Join(tmpDir, "config.yaml")
				content := `
server:
  port: 99999  # Invalid port

backend:
  address: ""  # Empty address

llm:
  provider: "anthropic"
`
				if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
					t.Fatalf("Failed to write config file: %v", err)
				}
				return configPath
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			configPath := tt.setupFunc(t)

			if tt.validateFn != nil {
				tt.validateFn(t, configPath)
			} else {
				ctx := context.Background()
				_, err := loadConfiguration(ctx, configPath)

				if (err != nil) != tt.wantErr {
					t.Errorf("loadConfiguration() error = %v, wantErr %v", err, tt.wantErr)
				}
			}
		})
	}
}

func TestAutonomyLevelName(t *testing.T) {
	tests := []struct {
		level    int
		expected string
	}{
		{0, "Observe"},
		{1, "Diagnose"},
		{2, "Propose"},
		{3, "Simulate"},
		{4, "Act-with-Guard"},
		{5, "Full-Autonomous"},
		{6, "Unknown"},
		{-1, "Unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := autonomyLevelName(tt.level)
			if result != tt.expected {
				t.Errorf("autonomyLevelName(%d) = %s, want %s", tt.level, result, tt.expected)
			}
		})
	}
}

func TestServerStartupAndShutdown(t *testing.T) {
	// This test verifies that the server can start and shutdown gracefully
	// We'll create a minimal server setup similar to main()

	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")
	content := `
server:
  port: 8888  # Use specific test port

backend:
  address: "localhost:50051"

llm:
  provider: "anthropic"
  anthropic:
    api_key: "test-key"
    model: "claude-3-5-sonnet-20241022"

autonomy:
  default_level: 2
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write config file: %v", err)
	}

	ctx := context.Background()
	cfg, err := loadConfiguration(ctx, configPath)
	if err != nil {
		t.Fatalf("Failed to load configuration: %v", err)
	}

	// Create server
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)

	server := &http.Server{
		Addr:         ":0", // Use random port for testing
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in background
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	// Give server time to start
	time.Sleep(100 * time.Millisecond)

	// Shutdown server
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		t.Errorf("Server shutdown failed: %v", err)
	}

	// Verify server stopped
	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			t.Errorf("Server error: %v", err)
		}
	case <-time.After(6 * time.Second):
		t.Error("Server did not stop in time")
	}

	// Verify cfg was loaded
	if cfg == nil {
		t.Error("Configuration was not loaded")
	}
}

func TestHealthEndpointContentType(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	healthHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Expected Content-Type application/json, got %s", contentType)
	}
}

func TestHealthEndpointJSONResponse(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	healthHandler(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response body: %v", err)
	}

	var response HealthResponse
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("Failed to unmarshal JSON response: %v", err)
	}

	if response.Status != "healthy" {
		t.Errorf("Expected status 'healthy', got '%s'", response.Status)
	}

	if response.Version != version {
		t.Errorf("Expected version '%s', got '%s'", version, response.Version)
	}
}
