package config

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/viper"
)

// viperConfigManager implements ConfigManager using Viper.
type viperConfigManager struct {
	configPath string
	config     *Config
	viper      *viper.Viper
	watchChan  chan Config
}

// Load loads configuration from all sources.
func (m *viperConfigManager) Load(ctx context.Context) error {
	// Initialize viper
	m.viper = viper.New()

	// Set config file path
	m.viper.SetConfigFile(m.configPath)
	m.viper.SetConfigType("yaml")

	// Set environment variable prefix
	m.viper.SetEnvPrefix("KUBILITICS")
	m.viper.AutomaticEnv()
	m.viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// Set defaults
	m.setDefaults()

	// Try to read config file (optional)
	if err := m.viper.ReadInConfig(); err != nil {
		// Config file not found is OK if it doesn't exist, we'll use defaults + env vars
		// Check both ConfigFileNotFoundError and os.IsNotExist for file not found
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// File not found via viper - OK, use defaults
		} else if os.IsNotExist(err) {
			// File not found via os - OK, use defaults
		} else {
			// Other error reading config file
			return fmt.Errorf("error reading config file: %w", err)
		}
	}

	// Unmarshal into config struct
	if err := m.unmarshalConfig(); err != nil {
		return fmt.Errorf("error unmarshaling config: %w", err)
	}

	// Apply environment variable overrides for sensitive data
	m.applyEnvOverrides()

	return nil
}

// Get returns the current configuration.
func (m *viperConfigManager) Get(ctx context.Context) *Config {
	return m.config
}

// Validate validates configuration is correct and complete.
func (m *viperConfigManager) Validate(ctx context.Context) error {
	errs := m.config.Validate()
	if len(errs) > 0 {
		// Combine all errors into a single error message
		var errMsgs []string
		for _, err := range errs {
			errMsgs = append(errMsgs, err.Error())
		}
		return fmt.Errorf("configuration validation failed:\n  - %s", strings.Join(errMsgs, "\n  - "))
	}
	return nil
}

// Watch watches for configuration changes and reloads.
func (m *viperConfigManager) Watch(ctx context.Context) <-chan Config {
	// Start watching config file
	m.viper.WatchConfig()
	m.viper.OnConfigChange(func(e fsnotify.Event) {
		// Reload config
		if err := m.unmarshalConfig(); err != nil {
			// Log error but don't send to channel
			return
		}
		// Send updated config to channel
		select {
		case m.watchChan <- *m.config:
		default:
			// Channel full, skip this update
		}
	})

	return m.watchChan
}

// Reload reloads configuration from sources.
func (m *viperConfigManager) Reload(ctx context.Context) error {
	// Re-read config file
	if err := m.viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return fmt.Errorf("error reading config file: %w", err)
		}
	}

	// Unmarshal into config struct
	if err := m.unmarshalConfig(); err != nil {
		return fmt.Errorf("error unmarshaling config: %w", err)
	}

	// Apply environment variable overrides
	m.applyEnvOverrides()

	return nil
}

// setDefaults sets default values in viper.
func (m *viperConfigManager) setDefaults() {
	defaults := DefaultConfig()

	// Server defaults
	m.viper.SetDefault("server.port", defaults.Server.Port)
	m.viper.SetDefault("server.tls_enabled", defaults.Server.TLSEnabled)
	m.viper.SetDefault("server.tls_cert_path", defaults.Server.TLSCertPath)
	m.viper.SetDefault("server.tls_key_path", defaults.Server.TLSKeyPath)

	// Backend defaults
	m.viper.SetDefault("backend.address", defaults.Backend.Address)
	m.viper.SetDefault("backend.http_base_url", defaults.Backend.HTTPBaseURL)
	m.viper.SetDefault("backend.timeout", defaults.Backend.Timeout)
	m.viper.SetDefault("backend.tls_enabled", defaults.Backend.TLSEnabled)

	// LLM defaults
	m.viper.SetDefault("llm.provider", defaults.LLM.Provider)
	m.viper.SetDefault("llm.openai", defaults.LLM.OpenAI)
	m.viper.SetDefault("llm.anthropic", defaults.LLM.Anthropic)
	m.viper.SetDefault("llm.ollama", defaults.LLM.Ollama)
	m.viper.SetDefault("llm.custom", defaults.LLM.Custom)

	// Autonomy defaults
	m.viper.SetDefault("autonomy.default_level", defaults.Autonomy.DefaultLevel)
	m.viper.SetDefault("autonomy.allow_level_override", defaults.Autonomy.AllowLevelOverride)

	// Safety defaults
	m.viper.SetDefault("safety.enable_immutable_rules", defaults.Safety.EnableImmutableRules)
	m.viper.SetDefault("safety.enable_custom_policies", defaults.Safety.EnableCustomPolicies)
	m.viper.SetDefault("safety.require_approval_for_deletions", defaults.Safety.RequireApprovalForDelet)
	m.viper.SetDefault("safety.require_approval_for_risky_ops", defaults.Safety.RequireApprovalForRisky)

	// Database defaults
	m.viper.SetDefault("database.type", defaults.Database.Type)
	m.viper.SetDefault("database.sqlite_path", defaults.Database.SQLitePath)
	m.viper.SetDefault("database.postgres_url", defaults.Database.PostgresURL)

	// MCP defaults — enable by default so the agentic tool loop is always active
	m.viper.SetDefault("mcp.enabled", defaults.MCP.Enabled)

	// Safety enabled default
	m.viper.SetDefault("safety.enabled", defaults.Safety.Enabled)

	// Analytics defaults
	m.viper.SetDefault("analytics.enabled", defaults.Analytics.Enabled)
	m.viper.SetDefault("analytics.timeseries_retention_days", defaults.Analytics.TimeseriesRetentionDays)
	m.viper.SetDefault("analytics.enable_anomaly_detection", defaults.Analytics.EnableAnomalyDetection)
	m.viper.SetDefault("analytics.enable_forecasting", defaults.Analytics.EnableForecasting)

	// Cache defaults
	m.viper.SetDefault("cache.enable_caching", defaults.Cache.EnableCaching)
	m.viper.SetDefault("cache.ttl_seconds", defaults.Cache.TTLSeconds)
	m.viper.SetDefault("cache.max_size_mb", defaults.Cache.MaxSizeMB)

	// Logging defaults
	m.viper.SetDefault("logging.level", defaults.Logging.Level)
	m.viper.SetDefault("logging.format", defaults.Logging.Format)

	// Budget defaults
	m.viper.SetDefault("budget.global_monthly_budget", defaults.Budget.GlobalMonthlyBudget)
	m.viper.SetDefault("budget.per_user_monthly_budget", defaults.Budget.PerUserMonthlyBudget)
	m.viper.SetDefault("budget.per_investigation_limit", defaults.Budget.PerInvestigationLimit)
}

// unmarshalConfig unmarshals viper config into Config struct.
func (m *viperConfigManager) unmarshalConfig() error {
	cfg := &Config{}

	// Server
	cfg.Server.Port = m.viper.GetInt("server.port")
	cfg.Server.TLSEnabled = m.viper.GetBool("server.tls_enabled")
	cfg.Server.TLSCertPath = m.viper.GetString("server.tls_cert_path")
	cfg.Server.TLSKeyPath = m.viper.GetString("server.tls_key_path")

	// Backend
	cfg.Backend.Address = m.viper.GetString("backend.address")
	cfg.Backend.HTTPBaseURL = m.viper.GetString("backend.http_base_url")
	cfg.Backend.Timeout = m.viper.GetInt("backend.timeout")
	cfg.Backend.TLSEnabled = m.viper.GetBool("backend.tls_enabled")

	// LLM
	cfg.LLM.Provider = m.viper.GetString("llm.provider")
	cfg.LLM.OpenAI = m.viper.GetStringMap("llm.openai")
	cfg.LLM.Anthropic = m.viper.GetStringMap("llm.anthropic")
	cfg.LLM.Ollama = m.viper.GetStringMap("llm.ollama")
	cfg.LLM.Custom = m.viper.GetStringMap("llm.custom")

	// Autonomy
	cfg.Autonomy.DefaultLevel = m.viper.GetInt("autonomy.default_level")
	cfg.Autonomy.AllowLevelOverride = m.viper.GetBool("autonomy.allow_level_override")

	// MCP
	cfg.MCP.Enabled = m.viper.GetBool("mcp.enabled")

	// Safety
	cfg.Safety.Enabled = m.viper.GetBool("safety.enabled")
	cfg.Safety.EnableImmutableRules = m.viper.GetBool("safety.enable_immutable_rules")
	cfg.Safety.EnableCustomPolicies = m.viper.GetBool("safety.enable_custom_policies")
	cfg.Safety.RequireApprovalForDelet = m.viper.GetBool("safety.require_approval_for_deletions")
	cfg.Safety.RequireApprovalForRisky = m.viper.GetBool("safety.require_approval_for_risky_ops")

	// Database
	cfg.Database.Type = m.viper.GetString("database.type")
	cfg.Database.SQLitePath = m.viper.GetString("database.sqlite_path")
	cfg.Database.PostgresURL = m.viper.GetString("database.postgres_url")

	// Analytics
	cfg.Analytics.Enabled = m.viper.GetBool("analytics.enabled")
	cfg.Analytics.TimeseriesRetentionDays = m.viper.GetInt("analytics.timeseries_retention_days")
	cfg.Analytics.EnableAnomalyDetection = m.viper.GetBool("analytics.enable_anomaly_detection")
	cfg.Analytics.EnableForecasting = m.viper.GetBool("analytics.enable_forecasting")

	// Cache
	cfg.Cache.EnableCaching = m.viper.GetBool("cache.enable_caching")
	cfg.Cache.TTLSeconds = m.viper.GetInt("cache.ttl_seconds")
	cfg.Cache.MaxSizeMB = m.viper.GetInt("cache.max_size_mb")

	// Logging
	cfg.Logging.Level = m.viper.GetString("logging.level")
	cfg.Logging.Format = m.viper.GetString("logging.format")

	// Budget
	cfg.Budget.GlobalMonthlyBudget = m.viper.GetFloat64("budget.global_monthly_budget")
	cfg.Budget.PerUserMonthlyBudget = m.viper.GetFloat64("budget.per_user_monthly_budget")
	cfg.Budget.PerInvestigationLimit = m.viper.GetInt("budget.per_investigation_limit")

	m.config = cfg
	return nil
}

// applyEnvOverrides applies environment variable overrides for sensitive data.
func (m *viperConfigManager) applyEnvOverrides() {
	// OpenAI API key from environment
	if apiKey := os.Getenv("OPENAI_API_KEY"); apiKey != "" {
		if m.config.LLM.OpenAI == nil {
			m.config.LLM.OpenAI = make(map[string]interface{})
		}
		m.config.LLM.OpenAI["api_key"] = apiKey
	}

	// Anthropic API key from environment
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		if m.config.LLM.Anthropic == nil {
			m.config.LLM.Anthropic = make(map[string]interface{})
		}
		m.config.LLM.Anthropic["api_key"] = apiKey
	}

	// Ollama base URL from environment
	if baseURL := os.Getenv("OLLAMA_BASE_URL"); baseURL != "" {
		if m.config.LLM.Ollama == nil {
			m.config.LLM.Ollama = make(map[string]interface{})
		}
		m.config.LLM.Ollama["base_url"] = baseURL
	}

	// Backend address from environment
	if addr := os.Getenv("KUBILITICS_BACKEND_ADDRESS"); addr != "" {
		m.config.Backend.Address = addr
	}

	// Backend HTTP URL from environment — support both naming conventions
	if httpURL := os.Getenv("KUBILITICS_BACKEND_HTTP_BASE_URL"); httpURL != "" {
		m.config.Backend.HTTPBaseURL = httpURL
	} else if httpURL := os.Getenv("KUBILITICS_BACKEND_URL"); httpURL != "" {
		m.config.Backend.HTTPBaseURL = httpURL
	}

	// Port from environment - only override if explicitly set
	if portEnv := os.Getenv("KUBILITICS_PORT"); portEnv != "" {
		// Port was explicitly set via environment, so viper has the value
		m.config.Server.Port = m.viper.GetInt("port")
	}

	// Autonomy level from environment - only override if explicitly set
	if levelEnv := os.Getenv("KUBILITICS_AUTONOMY_LEVEL"); levelEnv != "" {
		if level := m.viper.GetInt("autonomy_level"); level >= 0 && level <= 5 {
			m.config.Autonomy.DefaultLevel = level
		}
	}

	// TASK-AI-005: Database path from environment.
	// The Tauri sidecar passes KUBILITICS_DATABASE_PATH pointing to the user-writable
	// app-data directory (~/Library/Application Support/kubilitics/ai/kubilitics-ai.db).
	// Without this override the server defaults to /var/lib/kubilitics/ which is
	// read-only inside a signed/sandboxed macOS .app bundle.
	if dbPath := os.Getenv("KUBILITICS_DATABASE_PATH"); dbPath != "" {
		m.config.Database.SQLitePath = dbPath
	}
}
