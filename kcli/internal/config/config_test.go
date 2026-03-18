package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDefaultWhenMissing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	s, err := LoadStore()
	if err != nil {
		t.Fatalf("LoadStore error: %v", err)
	}
	if s.ActiveProfile != "default" {
		t.Fatalf("expected default active profile, got %q", s.ActiveProfile)
	}
	if s.Current().General.Theme != "ocean" {
		t.Fatalf("expected default theme ocean, got %q", s.Current().General.Theme)
	}
}

func TestSaveAndLoadRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg := Default()
	if err := cfg.SetByKey("tui.refresh_interval", "5s"); err != nil {
		t.Fatalf("SetByKey error: %v", err)
	}
	if err := cfg.SetByKey("shell.aliases.kg", "get pods"); err != nil {
		t.Fatalf("SetByKey alias error: %v", err)
	}
	if err := Save(cfg); err != nil {
		t.Fatalf("Save error: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("Load after save error: %v", err)
	}
	if loaded.TUI.RefreshInterval != "5s" {
		t.Fatalf("expected refresh interval 5s, got %q", loaded.TUI.RefreshInterval)
	}
	if loaded.Shell.Aliases["kg"] != "get pods" {
		t.Fatalf("expected alias kg, got %+v", loaded.Shell.Aliases)
	}

	path, err := FilePath()
	if err != nil {
		t.Fatalf("FilePath error: %v", err)
	}
	if want := filepath.Join(home, ".kcli", "config.yaml"); path != want {
		t.Fatalf("unexpected config path %q want %q", path, want)
	}
}

func TestValidateRejectsInvalidValues(t *testing.T) {
	cfg := Default()
	cfg.General.Theme = "invalid"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid theme error")
	}

	cfg = Default()
	cfg.Logs.MaxPods = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid logs.maxPods error")
	}
}

func TestSetByKeyRejectsInvalidInput(t *testing.T) {
	cfg := Default()
	if err := cfg.SetByKey("performance.memory_limit_mb", "abc"); err == nil {
		t.Fatal("expected memory limit parse error")
	}
	if err := cfg.SetByKey("unknown.key", "x"); err == nil {
		t.Fatal("expected unsupported key error")
	}
}

func TestAIConfigRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg := Default()
	if err := cfg.SetByKey("ai.provider", "openai"); err != nil {
		t.Fatalf("set ai.provider: %v", err)
	}
	if err := cfg.SetByKey("ai.model", "gpt-4o-mini"); err != nil {
		t.Fatalf("set ai.model: %v", err)
	}
	if err := cfg.SetByKey("ai.budget_monthly_usd", "75"); err != nil {
		t.Fatalf("set ai budget: %v", err)
	}
	if err := cfg.SetByKey("ai.soft_limit_percent", "85"); err != nil {
		t.Fatalf("set ai soft limit: %v", err)
	}
	if err := Save(cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if loaded.AI.Provider != "openai" || loaded.AI.Model != "gpt-4o-mini" {
		t.Fatalf("unexpected ai config: %+v", loaded.AI)
	}
	if loaded.AI.BudgetMonthlyUSD != 75 || loaded.AI.SoftLimitPercent != 85 {
		t.Fatalf("unexpected ai budget config: %+v", loaded.AI)
	}
}
func TestMultiProfileSwitching(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	s := DefaultStore()
	s.Profiles["prod"] = Default()
	s.Profiles["prod"].General.Theme = "amber"
	if err := SaveStore(s); err != nil {
		t.Fatalf("SaveStore error: %v", err)
	}

	loaded, err := LoadStore()
	if err != nil {
		t.Fatalf("LoadStore error: %v", err)
	}
	if _, ok := loaded.Profiles["prod"]; !ok {
		t.Fatal("prod profile missing")
	}

	loaded.ActiveProfile = "prod"
	if loaded.Current().General.Theme != "amber" {
		t.Fatalf("expected amber theme in prod, got %q", loaded.Current().General.Theme)
	}
}

func TestLegacyConfigMigration(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Write old format config
	path, _ := FilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0755)
	legacy := `general: {theme: forest}`
	_ = os.WriteFile(path, []byte(legacy), 0644)

	s, err := LoadStore()
	if err != nil {
		t.Fatalf("LoadStore migration error: %v", err)
	}
	if s.ActiveProfile != "default" {
		t.Fatal("expected default profile after migration")
	}
	if s.Current().General.Theme != "forest" {
		t.Fatalf("expected theme forest after migration, got %q", s.Current().General.Theme)
	}
}

func TestNormalizeKeyForAccount(t *testing.T) {
	if got := NormalizeKeyForAccount("ai.apikey"); got != "ai.api_key" {
		t.Fatalf("expected ai.api_key, got %q", got)
	}
	if got := NormalizeKeyForAccount("integrations.pagerDutyKey"); got != "integrations.pagerduty_key" {
		t.Fatalf("expected integrations.pagerduty_key, got %q", got)
	}
	if got := NormalizeKeyForAccount("ai.api_key"); got != "ai.api_key" {
		t.Fatalf("expected ai.api_key, got %q", got)
	}
}

func TestAddKeychainKey(t *testing.T) {
	cfg := Default()
	cfg.AddKeychainKey("ai.api_key")
	if len(cfg.KeychainKeys) != 1 || cfg.KeychainKeys[0] != "ai.api_key" {
		t.Fatalf("expected [ai.api_key], got %v", cfg.KeychainKeys)
	}
	cfg.AddKeychainKey("ai.api_key")
	if len(cfg.KeychainKeys) != 1 {
		t.Fatalf("expected no duplicate, got %v", cfg.KeychainKeys)
	}
	cfg.AddKeychainKey("integrations.pagerduty_key")
	if len(cfg.KeychainKeys) != 2 {
		t.Fatalf("expected 2 keys, got %v", cfg.KeychainKeys)
	}
	cfg.AddKeychainKey("unknown.key")
	if len(cfg.KeychainKeys) != 2 {
		t.Fatalf("expected keychainable-only, got %v", cfg.KeychainKeys)
	}
}

func TestSaveStoreZeroesKeychainBackedSecrets(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg := Default()
	cfg.AI.APIKey = "sk-secret-not-on-disk"
	cfg.KeychainKeys = []string{"ai.api_key"}
	if err := Save(cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(home, ".kcli", "config.yaml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if strings.Contains(string(raw), "sk-secret-not-on-disk") {
		t.Fatal("keychain-backed secret must not be written to config file")
	}
}

// --- Thorough validation tests (P1-5) ---

func TestValidateDefaultConfigPasses(t *testing.T) {
	cfg := Default()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should pass validation: %v", err)
	}
}

func TestValidateNilConfig(t *testing.T) {
	var cfg *Config
	if err := cfg.Validate(); err == nil {
		t.Fatal("nil config should fail validation")
	}
}

func TestValidateMultiError(t *testing.T) {
	cfg := Default()
	cfg.General.Theme = "nope"
	cfg.General.StartupTimeBudget = "not-a-duration"
	cfg.Logs.MaxPods = 0
	cfg.Performance.MemoryLimitMB = 1

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected validation errors")
	}
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if len(ve.Errs) < 4 {
		t.Fatalf("expected at least 4 errors, got %d: %v", len(ve.Errs), ve.Errs)
	}
	// Verify the error string contains all issues
	msg := err.Error()
	for _, substr := range []string{"general.theme", "general.startupTimeBudget", "logs.maxPods", "performance.memoryLimitMB"} {
		if !strings.Contains(msg, substr) {
			t.Errorf("expected error to mention %q, got: %s", substr, msg)
		}
	}
}

func TestValidateURLFields(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(*Config)
		wantErr string
	}{
		{
			name: "valid prometheus URL",
			setup: func(c *Config) {
				c.Integrations.PrometheusEndpoint = "http://prometheus:9090"
			},
		},
		{
			name: "valid https URL",
			setup: func(c *Config) {
				c.Integrations.JiraURL = "https://mycompany.atlassian.net"
			},
		},
		{
			name: "missing scheme",
			setup: func(c *Config) {
				c.Integrations.PrometheusEndpoint = "prometheus:9090"
			},
			wantErr: "integrations.prometheusEndpoint",
		},
		{
			name: "relative path not URL",
			setup: func(c *Config) {
				c.Integrations.LokiEndpoint = "/loki/api"
			},
			wantErr: "integrations.lokiEndpoint",
		},
		{
			name: "ftp scheme rejected",
			setup: func(c *Config) {
				c.Integrations.OpenCostEndpoint = "ftp://opencost:9090"
			},
			wantErr: "integrations.opencostEndpoint",
		},
		{
			name: "slack webhook valid",
			setup: func(c *Config) {
				c.Integrations.SlackWebhook = "https://hooks.slack.com/services/T00/B00/xxx"
			},
		},
		{
			name: "slack webhook bad",
			setup: func(c *Config) {
				c.Integrations.SlackWebhook = "not-a-url"
			},
			wantErr: "integrations.slackWebhook",
		},
		{
			name: "ai endpoint valid",
			setup: func(c *Config) {
				c.AI.Endpoint = "https://api.openai.com/v1"
			},
		},
		{
			name: "ai endpoint bad",
			setup: func(c *Config) {
				c.AI.Endpoint = "just-a-host"
			},
			wantErr: "ai.endpoint",
		},
		{
			name: "empty URLs are fine",
			setup: func(c *Config) {
				c.Integrations.PrometheusEndpoint = ""
				c.Integrations.LokiEndpoint = ""
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := Default()
			tt.setup(cfg)
			err := cfg.Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got: %v", err)
				}
			} else {
				if err == nil {
					t.Fatal("expected validation error")
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("expected error about %q, got: %v", tt.wantErr, err)
				}
			}
		})
	}
}

func TestValidateDefaultOutputFormat(t *testing.T) {
	tests := []struct {
		format  string
		wantErr bool
	}{
		{"", false},
		{"table", false},
		{"json", false},
		{"yaml", false},
		{"JSON", false}, // case insensitive
		{"xml", true},
		{"csv", true},
	}
	for _, tt := range tests {
		t.Run("format_"+tt.format, func(t *testing.T) {
			cfg := Default()
			cfg.General.DefaultOutputFormat = tt.format
			err := cfg.Validate()
			if tt.wantErr && err == nil {
				t.Fatalf("expected error for format %q", tt.format)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error for format %q: %v", tt.format, err)
			}
		})
	}
}

func TestValidateDurationFields(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(*Config)
		wantErr bool
	}{
		{
			name:  "valid startup budget",
			setup: func(c *Config) { c.General.StartupTimeBudget = "500ms" },
		},
		{
			name:    "invalid startup budget",
			setup:   func(c *Config) { c.General.StartupTimeBudget = "abc" },
			wantErr: true,
		},
		{
			name:    "negative startup budget",
			setup:   func(c *Config) { c.General.StartupTimeBudget = "-1s" },
			wantErr: true,
		},
		{
			name:  "valid cache TTL",
			setup: func(c *Config) { c.Performance.CacheTTL = "30s" },
		},
		{
			name:    "invalid cache TTL",
			setup:   func(c *Config) { c.Performance.CacheTTL = "forever" },
			wantErr: true,
		},
		{
			name:  "valid refresh interval",
			setup: func(c *Config) { c.TUI.RefreshInterval = "1s" },
		},
		{
			name:    "zero refresh interval",
			setup:   func(c *Config) { c.TUI.RefreshInterval = "0s" },
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := Default()
			tt.setup(cfg)
			err := cfg.Validate()
			if tt.wantErr && err == nil {
				t.Fatal("expected validation error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateNumericBounds(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(*Config)
		wantErr bool
	}{
		{"recentLimit=0", func(c *Config) { c.Context.RecentLimit = 0 }, true},
		{"recentLimit=1001", func(c *Config) { c.Context.RecentLimit = 1001 }, true},
		{"recentLimit=500", func(c *Config) { c.Context.RecentLimit = 500 }, false},
		{"maxPods=501", func(c *Config) { c.Logs.MaxPods = 501 }, true},
		{"maxPods=250", func(c *Config) { c.Logs.MaxPods = 250 }, false},
		{"memoryLimitMB=63", func(c *Config) { c.Performance.MemoryLimitMB = 63 }, true},
		{"memoryLimitMB=65537", func(c *Config) { c.Performance.MemoryLimitMB = 65537 }, true},
		{"memoryLimitMB=512", func(c *Config) { c.Performance.MemoryLimitMB = 512 }, false},
		{"maxListSize=-1", func(c *Config) { c.TUI.MaxListSize = -1 }, true},
		{"maxListSize=100001", func(c *Config) { c.TUI.MaxListSize = 100001 }, true},
		{"maxListSize=0", func(c *Config) { c.TUI.MaxListSize = 0 }, false},
		{"maxListSize=5000", func(c *Config) { c.TUI.MaxListSize = 5000 }, false},
		{"maxInputChars=-1", func(c *Config) { c.AI.MaxInputChars = -1 }, true},
		{"maxInputChars=0", func(c *Config) { c.AI.MaxInputChars = 0 }, false},
		{"budget=-1", func(c *Config) { c.AI.BudgetMonthlyUSD = -1 }, true},
		{"budget=0", func(c *Config) { c.AI.BudgetMonthlyUSD = 0 }, false},
		{"softLimit=0", func(c *Config) { c.AI.SoftLimitPercent = 0 }, true},
		{"softLimit=100", func(c *Config) { c.AI.SoftLimitPercent = 100 }, true},
		{"softLimit=50", func(c *Config) { c.AI.SoftLimitPercent = 50 }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := Default()
			tt.setup(cfg)
			err := cfg.Validate()
			if tt.wantErr && err == nil {
				t.Fatal("expected validation error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateGitopsEngine(t *testing.T) {
	tests := []struct {
		value   string
		wantErr bool
	}{
		{"", false},
		{"argocd", false},
		{"flux", false},
		{"jenkins", true},
	}
	for _, tt := range tests {
		t.Run("gitops_"+tt.value, func(t *testing.T) {
			cfg := Default()
			cfg.Integrations.GitopsEngine = tt.value
			err := cfg.Validate()
			if tt.wantErr && err == nil {
				t.Fatalf("expected error for gitops engine %q", tt.value)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("unexpected error for gitops engine %q: %v", tt.value, err)
			}
		})
	}
}

func TestValidationErrorUnwrap(t *testing.T) {
	cfg := Default()
	cfg.General.Theme = "bad"
	cfg.Logs.MaxPods = -1

	err := cfg.Validate()
	if err == nil {
		t.Fatal("expected error")
	}
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatal("expected *ValidationError")
	}
	unwrapped := ve.Unwrap()
	if len(unwrapped) != len(ve.Errs) {
		t.Fatalf("Unwrap returned %d errors, expected %d", len(unwrapped), len(ve.Errs))
	}
}

func TestSetByKeyDefaultOutputFormat(t *testing.T) {
	cfg := Default()
	if err := cfg.SetByKey("general.default_output_format", "json"); err != nil {
		t.Fatalf("set default_output_format: %v", err)
	}
	if cfg.General.DefaultOutputFormat != "json" {
		t.Fatalf("expected json, got %q", cfg.General.DefaultOutputFormat)
	}
	if err := cfg.SetByKey("general.default_output_format", "xml"); err == nil {
		t.Fatal("expected error for invalid output format")
	}
}

func TestGetByKeyDefaultOutputFormat(t *testing.T) {
	cfg := Default()
	cfg.General.DefaultOutputFormat = "yaml"
	v, err := cfg.GetByKey("general.default_output_format")
	if err != nil {
		t.Fatalf("GetByKey: %v", err)
	}
	if v != "yaml" {
		t.Fatalf("expected yaml, got %v", v)
	}
}

func TestLoadStoreWarningsOnInvalidConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	path, _ := FilePath()
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	// Write a store-format config with an invalid URL
	content := `active_profile: default
profiles:
  default:
    general:
      theme: ocean
      startupTimeBudget: 250ms
    context:
      recentLimit: 10
    tui:
      refreshInterval: 2s
      colors: true
      animations: true
    logs:
      followNewPods: true
      maxPods: 20
      colors: true
    performance:
      cacheTTL: 60s
      memoryLimitMB: 256
    shell:
      promptFormat: "[{{.context}}/{{.namespace}}]$ "
    ai:
      enabled: true
      budgetMonthlyUSD: 50
      softLimitPercent: 80
    integrations:
      prometheusEndpoint: "not-a-valid-url"
`
	_ = os.WriteFile(path, []byte(content), 0o644)

	s, err := LoadStore()
	if err != nil {
		t.Fatalf("LoadStore should not fail on validation warnings: %v", err)
	}
	if len(s.Warnings) == 0 {
		t.Fatal("expected warnings for invalid prometheus URL")
	}
	if !strings.Contains(s.Warnings[0], "prometheusEndpoint") {
		t.Fatalf("expected warning about prometheusEndpoint, got: %s", s.Warnings[0])
	}
}
