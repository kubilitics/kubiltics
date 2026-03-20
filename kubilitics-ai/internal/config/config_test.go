package config

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	// Test server defaults
	assert.Equal(t, 8081, cfg.Server.Port)
	assert.False(t, cfg.Server.TLSEnabled)

	// Test backend defaults
	assert.Equal(t, "localhost:50051", cfg.Backend.Address)
	assert.Equal(t, 30, cfg.Backend.Timeout)

	// Test LLM defaults
	assert.Equal(t, "anthropic", cfg.LLM.Provider)
	assert.NotNil(t, cfg.LLM.OpenAI)
	assert.NotNil(t, cfg.LLM.Anthropic)

	// Test autonomy defaults
	assert.Equal(t, 2, cfg.Autonomy.DefaultLevel)
	assert.True(t, cfg.Autonomy.AllowLevelOverride)

	// Test safety defaults
	assert.True(t, cfg.Safety.EnableImmutableRules)
	assert.True(t, cfg.Safety.RequireApprovalForDelet)

	// Test database defaults
	assert.Equal(t, "sqlite", cfg.Database.Type)
	assert.NotEmpty(t, cfg.Database.SQLitePath)

	// Test analytics defaults
	assert.Equal(t, 7, cfg.Analytics.TimeseriesRetentionDays)
	assert.True(t, cfg.Analytics.EnableAnomalyDetection)

	// Test cache defaults
	assert.True(t, cfg.Cache.EnableCaching)
	assert.Equal(t, 300, cfg.Cache.TTLSeconds)

	// Test logging defaults
	assert.Equal(t, "info", cfg.Logging.Level)
	assert.Equal(t, "json", cfg.Logging.Format)

	// Test budget defaults
	assert.Equal(t, 0.0, cfg.Budget.GlobalMonthlyBudget)
}

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name      string
		modifyFn  func(*Config)
		wantError bool
		errorMsg  string
	}{
		{
			name: "valid default config",
			modifyFn: func(cfg *Config) {
				// Set required API key for validation to pass
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: false,
		},
		{
			name: "invalid port - too low",
			modifyFn: func(cfg *Config) {
				cfg.Server.Port = 0
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "port must be between 1 and 65535",
		},
		{
			name: "invalid port - too high",
			modifyFn: func(cfg *Config) {
				cfg.Server.Port = 70000
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "port must be between 1 and 65535",
		},
		{
			name: "missing backend address",
			modifyFn: func(cfg *Config) {
				cfg.Backend.Address = ""
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "backend address is required",
		},
		{
			name: "invalid backend address format",
			modifyFn: func(cfg *Config) {
				cfg.Backend.Address = "invalid-address"
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "invalid address format",
		},
		{
			name: "invalid LLM provider",
			modifyFn: func(cfg *Config) {
				cfg.LLM.Provider = "invalid"
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "invalid provider",
		},
		{
			name: "missing OpenAI API key",
			modifyFn: func(cfg *Config) {
				cfg.LLM.Provider = "openai"
				delete(cfg.LLM.OpenAI, "api_key")
			},
			wantError: false, // Now allowed for degraded mode
			errorMsg:  "",
		},
		{
			name: "missing Anthropic model",
			modifyFn: func(cfg *Config) {
				cfg.LLM.Provider = "anthropic"
				cfg.LLM.Anthropic["api_key"] = "test-key"
				delete(cfg.LLM.Anthropic, "model")
			},
			wantError: true,
			errorMsg:  "Anthropic model is required",
		},
		{
			name: "invalid autonomy level - too low",
			modifyFn: func(cfg *Config) {
				cfg.Autonomy.DefaultLevel = -1
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "default_level must be between 0 and 5",
		},
		{
			name: "invalid autonomy level - too high",
			modifyFn: func(cfg *Config) {
				cfg.Autonomy.DefaultLevel = 6
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "default_level must be between 0 and 5",
		},
		{
			name: "invalid database type",
			modifyFn: func(cfg *Config) {
				cfg.Database.Type = "invalid"
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "invalid database type",
		},
		{
			name: "missing sqlite path",
			modifyFn: func(cfg *Config) {
				cfg.Database.Type = "sqlite"
				cfg.Database.SQLitePath = ""
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "sqlite_path is required",
		},
		{
			name: "missing postgres url",
			modifyFn: func(cfg *Config) {
				cfg.Database.Type = "postgres"
				cfg.Database.PostgresURL = ""
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "postgres_url is required",
		},
		{
			name: "invalid log level",
			modifyFn: func(cfg *Config) {
				cfg.Logging.Level = "invalid"
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "invalid log level",
		},
		{
			name: "invalid log format",
			modifyFn: func(cfg *Config) {
				cfg.Logging.Format = "invalid"
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "invalid log format",
		},
		{
			name: "negative retention days",
			modifyFn: func(cfg *Config) {
				cfg.Analytics.TimeseriesRetentionDays = 0
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "retention days must be at least 1",
		},
		{
			name: "negative budget",
			modifyFn: func(cfg *Config) {
				cfg.Budget.GlobalMonthlyBudget = -100.0
				cfg.LLM.Anthropic["api_key"] = "test-key"
			},
			wantError: true,
			errorMsg:  "global_monthly_budget cannot be negative",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.modifyFn(cfg)

			errs := cfg.Validate()

			if tt.wantError {
				assert.NotEmpty(t, errs, "expected validation errors but got none")
				if len(errs) > 0 {
					found := false
					for _, err := range errs {
						if tt.errorMsg != "" && contains(err.Error(), tt.errorMsg) {
							found = true
							break
						}
					}
					if tt.errorMsg != "" {
						assert.True(t, found, "expected error message containing '%s', got: %v", tt.errorMsg, errs)
					}
				}
			} else {
				assert.Empty(t, errs, "expected no validation errors but got: %v", errs)
			}
		})
	}
}

func TestConfigManagerLoad(t *testing.T) {
	// Create temp directory for config file
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	// Create minimal valid config file
	configContent := `
server:
  port: 9090

backend:
  address: "backend:50051"
  timeout: 60

llm:
  provider: "anthropic"
  anthropic:
    api_key: "test-anthropic-key"
    model: "claude-3-5-sonnet-20241022"

autonomy:
  default_level: 3

logging:
  level: "debug"
  format: "text"
`
	err := os.WriteFile(configPath, []byte(configContent), 0644)
	require.NoError(t, err)

	// Create config manager
	mgr, err := NewConfigManager(configPath)
	require.NoError(t, err)

	// Load config
	ctx := context.Background()
	err = mgr.Load(ctx)
	require.NoError(t, err)

	// Get config
	cfg := mgr.Get(ctx)
	require.NotNil(t, cfg)

	// Verify loaded values
	assert.Equal(t, 9090, cfg.Server.Port)
	assert.Equal(t, "backend:50051", cfg.Backend.Address)
	assert.Equal(t, 60, cfg.Backend.Timeout)
	assert.Equal(t, "anthropic", cfg.LLM.Provider)
	assert.Equal(t, 3, cfg.Autonomy.DefaultLevel)
	assert.Equal(t, "debug", cfg.Logging.Level)
	assert.Equal(t, "text", cfg.Logging.Format)

	// Verify Anthropic config
	assert.NotNil(t, cfg.LLM.Anthropic)
	assert.Equal(t, "test-anthropic-key", cfg.LLM.Anthropic["api_key"])
	assert.Equal(t, "claude-3-5-sonnet-20241022", cfg.LLM.Anthropic["model"])
}

func TestConfigManagerEnvironmentOverrides(t *testing.T) {
	// Set environment variables
	os.Setenv("KUBILITICS_BACKEND_ADDRESS", "env-backend:9999")
	os.Setenv("KUBILITICS_PORT", "7070")
	os.Setenv("ANTHROPIC_API_KEY", "env-anthropic-key")
	defer func() {
		os.Unsetenv("KUBILITICS_BACKEND_ADDRESS")
		os.Unsetenv("KUBILITICS_PORT")
		os.Unsetenv("ANTHROPIC_API_KEY")
	}()

	// Create temp directory for config file
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	// Create config file with different values
	configContent := `
server:
  port: 8081

backend:
  address: "localhost:50051"

llm:
  provider: "anthropic"
  anthropic:
    model: "claude-3-5-sonnet-20241022"
`
	err := os.WriteFile(configPath, []byte(configContent), 0644)
	require.NoError(t, err)

	// Create config manager and load
	mgr, err := NewConfigManager(configPath)
	require.NoError(t, err)

	ctx := context.Background()
	err = mgr.Load(ctx)
	require.NoError(t, err)

	cfg := mgr.Get(ctx)

	// Environment variables should override config file
	assert.Equal(t, 7070, cfg.Server.Port, "PORT should be overridden by environment variable")
	assert.Equal(t, "env-backend:9999", cfg.Backend.Address, "backend address should be overridden by environment variable")
	assert.Equal(t, "env-anthropic-key", cfg.LLM.Anthropic["api_key"], "API key should come from environment variable")
}

func TestConfigManagerMissingFile(t *testing.T) {
	// Use non-existent config file path
	configPath := "/tmp/nonexistent-config.yaml"

	mgr, err := NewConfigManager(configPath)
	require.NoError(t, err)

	ctx := context.Background()
	err = mgr.Load(ctx)
	// Should not error - should use defaults
	require.NoError(t, err)

	cfg := mgr.Get(ctx)
	assert.NotNil(t, cfg)
	// Should have default values
	assert.Equal(t, 8081, cfg.Server.Port)
}

func TestConfigManagerValidation(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")

	// Create invalid config file (missing required fields)
	configContent := `
server:
  port: 99999

backend:
  address: ""

llm:
  provider: "invalid-provider"
`
	err := os.WriteFile(configPath, []byte(configContent), 0644)
	require.NoError(t, err)

	mgr, err := NewConfigManager(configPath)
	require.NoError(t, err)

	ctx := context.Background()
	err = mgr.Load(ctx)
	require.NoError(t, err)

	// Validation should fail
	err = mgr.Validate(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "configuration validation failed")
}

// Helper function
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
