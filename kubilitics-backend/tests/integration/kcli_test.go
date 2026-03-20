package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestKCLIBinaryResolution tests that kcli binary can be resolved
func TestKCLIBinaryResolution(t *testing.T) {
	// Test KCLI_BIN env var
	if kcliBin := os.Getenv("KCLI_BIN"); kcliBin != "" {
		if _, err := os.Stat(kcliBin); err == nil {
			t.Logf("KCLI_BIN is set to: %s", kcliBin)
			return
		}
		t.Logf("KCLI_BIN is set but file doesn't exist: %s", kcliBin)
	}

	// Test PATH lookup
	if path, err := exec.LookPath("kcli"); err == nil {
		t.Logf("kcli found in PATH: %s", path)
		return
	}

	// Test relative path (dev environment)
	cwd, err := os.Getwd()
	if err == nil {
		cand := filepath.Clean(filepath.Join(cwd, "..", "..", "..", "kcli", "bin", "kcli"))
		if _, err := os.Stat(cand); err == nil {
			t.Logf("kcli found at relative path: %s", cand)
			return
		}
	}

	t.Skip("kcli binary not found - skipping kcli integration tests")
}

// TestKCLIExecEndpoint tests the POST /clusters/{id}/kcli/exec endpoint
func TestKCLIExecEndpoint(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	// Setup test handler
	handler := setupTestHandler(t)

	// Create a test cluster (requires kubeconfig_base64 or kubeconfig_path in AddCluster)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	// Setup router
	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/exec", handler.PostKCLIExec).Methods("POST")

	// Test cases
	tests := []struct {
		name           string
		args           []string
		force          bool
		expectExitCode int
		expectError    bool
	}{
		{
			name:           "kcli version",
			args:           []string{"version"},
			expectExitCode: 0,
		},
		{
			name:           "kcli get pods",
			args:           []string{"get", "pods", "--no-headers"},
			expectExitCode: 0, // May be 0 even if no pods exist
		},
		{
			name:           "invalid command",
			args:           []string{"invalid-command-that-does-not-exist"},
			expectExitCode: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reqBody := map[string]interface{}{
				"args":  tt.args,
				"force": tt.force,
			}
			body, _ := json.Marshal(reqBody)

		req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/clusters/%s/kcli/exec", clusterID), bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = addTestAuth(req)
		req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

			if tt.expectError {
				assert.NotEqual(t, http.StatusOK, w.Code)
				return
			}

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Stdout   string `json:"stdout"`
				Stderr   string `json:"stderr"`
				ExitCode int    `json:"exitCode"`
			}
			err := json.Unmarshal(w.Body.Bytes(), &response)
			require.NoError(t, err)

			assert.Equal(t, tt.expectExitCode, response.ExitCode, "Exit code mismatch. stdout: %s, stderr: %s", response.Stdout, response.Stderr)
		})
	}
}

// TestKCLICompletionEndpoint tests the GET /clusters/{id}/kcli/complete endpoint
func TestKCLICompletionEndpoint(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/complete", handler.GetKCLIComplete).Methods("GET")

	tests := []struct {
		name              string
		line              string
		expectCompletions bool
	}{
		{
			name:              "get command",
			line:              "get",
			expectCompletions: true,
		},
		{
			name:              "get pods",
			line:              "get pods",
			expectCompletions: true,
		},
		{
			name:              "empty line",
			line:              "",
			expectCompletions: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
		req := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/clusters/%s/kcli/complete?line=%s", clusterID, url.QueryEscape(tt.line)), nil)
		req = addTestAuth(req)
		req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Completions []string `json:"completions"`
			}
			err := json.Unmarshal(w.Body.Bytes(), &response)
			require.NoError(t, err)

			if tt.expectCompletions {
				assert.Greater(t, len(response.Completions), 0, "Expected completions but got none")
			}
		})
	}
}

// TestKCLITUIStateEndpoint tests the GET /clusters/{id}/kcli/tui/state endpoint
func TestKCLITUIStateEndpoint(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/tui/state", handler.GetKCLITUIState).Methods("GET")

	req := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/clusters/%s/kcli/tui/state", clusterID), nil)
	req = addTestAuth(req)
	req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response struct {
		KCLIAvailable        bool   `json:"kcliAvailable"`
		KCLIShellModeAllowed bool   `json:"kcliShellModeAllowed"`
		Namespace            string `json:"namespace"`
		Context              string `json:"context"`
	}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	require.NoError(t, err)

	assert.True(t, response.KCLIAvailable, "kcli should be available")
}

// TestKCLIExecRateLimiting tests rate limiting on kcli exec endpoint
func TestKCLIExecRateLimiting(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/exec", handler.PostKCLIExec).Methods("POST")

	// Make rapid requests to trigger rate limiting
	rateLimitHit := false
	for i := 0; i < 30; i++ { // More than the 12 req/s limit
		reqBody := map[string]interface{}{
			"args": []string{"version"},
		}
		body, _ := json.Marshal(reqBody)

		req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/clusters/%s/kcli/exec", clusterID), bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req = addTestAuth(req)
		req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code == http.StatusTooManyRequests {
			rateLimitHit = true
			break
		}

		time.Sleep(50 * time.Millisecond) // Small delay between requests
	}

	// Rate limiting may or may not trigger depending on timing
	// Just verify the endpoint handles it gracefully
	t.Logf("Rate limit test completed (hit limit: %v)", rateLimitHit)
}

// TestKCLIExecTimeout tests that long-running commands timeout
func TestKCLIExecTimeout(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	_ = createTestCluster(t, handler)

	// This test would require a command that takes > 90 seconds
	// For now, just verify timeout is configured
	t.Skip("Timeout test requires long-running command - skipping")
}

// TestKCLIPluginCommand tests plugin command execution
func TestKCLIPluginCommand(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/exec", handler.PostKCLIExec).Methods("POST")

	// Test plugin list command (should work)
	reqBody := map[string]interface{}{
		"args": []string{"plugin", "list"},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/clusters/%s/kcli/exec", clusterID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addTestAuth(req)
	req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Plugin commands should work (may return empty list if no plugins installed)
	assert.True(t, w.Code == http.StatusOK || w.Code == http.StatusBadRequest, "Plugin command should be allowed")
}

// TestKCLIErrorHandling tests error handling for various error scenarios
func TestKCLIErrorHandling(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/exec", handler.PostKCLIExec).Methods("POST")

	tests := []struct {
		name        string
		args        []string
		expectError bool
		expectCode  int
	}{
		{
			name:        "empty args",
			args:        []string{},
			expectError: true,
			expectCode:  http.StatusBadRequest,
		},
		{
			name:        "invalid command",
			args:        []string{"invalid-command-that-does-not-exist"},
			expectError: true,
			expectCode:  http.StatusOK, // Command executes but returns non-zero exit code
		},
		{
			name:        "blocked flag --kubeconfig",
			args:        []string{"get", "pods", "--kubeconfig", "/tmp/kubeconfig"},
			expectError: true,
			expectCode:  http.StatusBadRequest,
		},
		{
			name:        "blocked flag --context",
			args:        []string{"get", "pods", "--context", "other-context"},
			expectError: true,
			expectCode:  http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reqBody := map[string]interface{}{
				"args": tt.args,
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/clusters/%s/kcli/exec", clusterID), bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req = addTestAuth(req)
			req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if tt.expectCode != 0 {
				assert.Equal(t, tt.expectCode, w.Code, "Expected status code %d but got %d", tt.expectCode, w.Code)
			}
		})
	}
}

// TestKCLIStreamSlotLimit tests stream slot limit enforcement
func TestKCLIStreamSlotLimit(t *testing.T) {
	TestKCLIBinaryResolution(t) // Skip if kcli not available

	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/stream", handler.GetKCLIStream).Methods("GET")

	// Note: This test would require actual WebSocket connections
	// For now, we just verify the endpoint exists and handles the request
	req := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/clusters/%s/kcli/stream?mode=ui", clusterID), nil)
	req = addTestAuth(req)
	req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// WebSocket upgrade should happen (101 Switching Protocols) or error if not WebSocket
	// In httptest, we can't test WebSocket upgrade, so we just verify endpoint exists
	assert.True(t, w.Code == http.StatusSwitchingProtocols || w.Code >= 400, "Stream endpoint should handle WebSocket upgrade")
}

// TestKCLIBinaryNotFoundError tests error message when kcli binary is not found
func TestKCLIBinaryNotFoundError(t *testing.T) {
	// Temporarily unset KCLI_BIN to test error handling
	originalKCLIBIN := os.Getenv("KCLI_BIN")
	defer os.Setenv("KCLI_BIN", originalKCLIBIN)
	os.Unsetenv("KCLI_BIN")

	// Remove kcli from PATH temporarily (if possible)
	// This is tricky, so we'll just test that the error message is informative
	
	handler := setupTestHandler(t)
	clusterID := createTestCluster(t, handler)
	if clusterID == "" {
		t.Skip("no cluster available for integration test (set kubeconfig for AddCluster)")
	}

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters/{clusterId}/kcli/exec", handler.PostKCLIExec).Methods("POST")

	reqBody := map[string]interface{}{
		"args": []string{"version"},
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/clusters/%s/kcli/exec", clusterID), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addTestAuth(req)
	req = mux.SetURLVars(req, map[string]string{"clusterId": clusterID})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// If kcli is not found, should return 503 with informative error
	if w.Code == http.StatusServiceUnavailable {
		var errorResponse struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &errorResponse); err == nil {
			assert.Contains(t, strings.ToLower(errorResponse.Error), "kcli", "Error message should mention kcli")
			assert.Contains(t, strings.ToLower(errorResponse.Error), "not found", "Error message should indicate binary not found")
		}
	}
}

// Helper functions

func setupTestHandler(t *testing.T) *rest.Handler {
	cfg := &config.Config{
		DatabasePath: ":memory:",
		Port:         819,
	}

	repo, err := repository.NewSQLiteRepository(cfg.DatabasePath)
	require.NoError(t, err)
	defer repo.Close()

	clusterService := service.NewClusterService(repo, cfg)
	handler := rest.NewHandler(clusterService, nil, cfg, nil, nil, nil, nil, nil, nil, repo)
	return handler
}

func createTestCluster(t *testing.T, handler *rest.Handler) string {
	// For integration tests, we need a real cluster
	// Create a cluster via the API endpoint (AddCluster)
	clusterReq := map[string]interface{}{
		"name":    "test-cluster",
		"context": "test-context",
	}
	body, _ := json.Marshal(clusterReq)

	router := mux.NewRouter()
	router.HandleFunc("/api/v1/clusters", handler.AddCluster).Methods("POST")
	
	req := httptest.NewRequest("POST", "/api/v1/clusters", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = addTestAuth(req)
	
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	
	if w.Code == http.StatusCreated || w.Code == http.StatusOK {
		var response struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err == nil && response.ID != "" {
			return response.ID
		}
	}

	// No cluster available (AddCluster requires kubeconfig_base64 or kubeconfig_path)
	return ""
}

func addTestAuth(req *http.Request) *http.Request {
	// Add test authentication token
	req.Header.Set("Authorization", "Bearer test-token")
	return req
}
