package config

import "context"

// Package config provides configuration management for kubilitics-ai.
//
// Responsibilities:
//   - Load configuration from YAML files, environment variables, and CLI flags
//   - Validate configuration on startup
//   - Provide runtime access to all configuration
//   - Support configuration reloading (for some settings)
//   - Manage sensitive data (API keys, credentials)
//   - Establish reasonable defaults
//
// Configuration Sources (priority order, high to low):
//  1. CLI flags (highest priority)
//  2. Environment variables (KUBILITICS_* prefix)
//  3. YAML config files (default: /etc/kubilitics/config.yaml)
//  4. Built-in defaults (lowest priority)
//
// Main Configuration Sections:
//
//  1. Server
//     - port: Listen port (default 8081)
//     - tls_enabled: Enable TLS
//     - tls_cert_path: Path to certificate
//     - tls_key_path: Path to key
//
//  2. Backend
//     - address: kubilitics-backend gRPC address (default localhost:50051)
//     - timeout: gRPC timeout
//     - tls_enabled: Use TLS for backend
//
//  3. LLM Provider
//     - provider: "openai" | "anthropic" | "ollama" | "custom"
//     - openai_api_key: OpenAI API key
//     - openai_model: Model name
//     - anthropic_api_key: Anthropic API key
//     - anthropic_model: Model name
//     - ollama_base_url: Ollama instance URL
//     - ollama_model: Model name
//     - custom_base_url: Custom endpoint URL
//
//  4. Autonomy
//     - default_level: Default autonomy level (1-5)
//     - allow_level_override: Can users change their level
//
//  5. Safety
//     - enable_immutable_rules: Enforce immutable safety rules
//     - enable_custom_policies: Allow custom policy creation
//     - require_approval_for_deletions: Always require approval for delete
//     - require_approval_for_risky_ops: Ask before high-risk operations
//
//  6. Database
//     - type: "sqlite" | "postgres"
//     - sqlite_path: Path to SQLite file
//     - postgres_url: PostgreSQL connection string
//
//  7. Analytics
//     - timeseries_retention_days: Keep metrics for N days
//     - enable_anomaly_detection: Turn on anomaly detection
//     - enable_forecasting: Turn on forecasting
//
//  8. Cache
//     - enable_caching: Turn on query caching
//     - cache_ttl_seconds: Default cache lifetime
//     - max_cache_size_mb: Maximum cache size
//
//  9. Logging
//     - level: "debug" | "info" | "warn" | "error"
//     - format: "json" | "text"
//
//  10. Budget
//     - global_monthly_budget: Total spending limit
//     - per_user_monthly_budget: Per-user spending limit
//     - per_investigation_limit: Max tokens/cost per investigation
//
// Config struct contains all configuration fields
type Config struct {
	// Server configuration
	Server struct {
		Port        int
		Host        string
		TLSEnabled  bool
		RequireTLS  bool // Enforces TLS for WebSocket connections
		TLSCertPath string
		TLSKeyPath  string
		// AllowedOrigins is a list of origins permitted to open WebSocket connections.
		// Use ["*"] to allow any origin (development only).
		// If empty, defaults to ["http://localhost:3000", "http://localhost:5173"].
		AllowedOrigins []string
	}

	// Backend configuration
	Backend struct {
		Address     string // gRPC address (e.g. localhost:50051)
		HTTPBaseURL string // REST API base URL (e.g. http://localhost:819) for draw.io export, etc.
		Timeout     int
		TLSEnabled  bool
		TLSCertPath string // client cert for mTLS
		TLSKeyPath  string // client key for mTLS
		TLSCAPath   string // custom CA certificate
	}

	// LLM provider configuration
	LLM struct {
		Provider   string
		Configured bool
		OpenAI     map[string]interface{}
		Anthropic  map[string]interface{}
		Ollama     map[string]interface{}
		Custom     map[string]interface{}
	}

	// Autonomy configuration
	Autonomy struct {
		DefaultLevel       int
		AllowLevelOverride bool
	}

	// Safety configuration
	Safety struct {
		Enabled                 bool
		EnableImmutableRules    bool
		EnableCustomPolicies    bool
		RequireApprovalForDelet bool
		RequireApprovalForRisky bool
	}

	// Database configuration
	Database struct {
		Type        string
		SQLitePath  string
		PostgresURL string
	}

	// MCP configuration
	MCP struct {
		Enabled bool
	}

	// Analytics configuration
	Analytics struct {
		Enabled                 bool
		TimeseriesRetentionDays int
		EnableAnomalyDetection  bool
		EnableForecasting       bool
	}

	// Cache configuration
	Cache struct {
		EnableCaching bool
		TTLSeconds    int
		MaxSizeMB     int
	}

	// Logging configuration
	Logging struct {
		Level  string
		Format string
	}

	// Budget configuration
	Budget struct {
		GlobalMonthlyBudget   float64
		PerUserMonthlyBudget  float64
		PerInvestigationLimit int
	}
}

// ConfigManager defines the interface for configuration access.
type ConfigManager interface {
	// Load loads configuration from all sources.
	Load(ctx context.Context) error

	// Get returns the current configuration.
	Get(ctx context.Context) *Config

	// Validate validates configuration is correct and complete.
	Validate(ctx context.Context) error

	// Watch watches for configuration changes and reloads (if supported).
	Watch(ctx context.Context) <-chan Config

	// Reload reloads configuration from sources (selective settings).
	Reload(ctx context.Context) error
}

// NewConfigManager creates a new configuration manager.
func NewConfigManager(configPath string) (ConfigManager, error) {
	mgr := &viperConfigManager{
		configPath: configPath,
		config:     DefaultConfig(),
		watchChan:  make(chan Config, 1),
	}
	return mgr, nil
}

// NewConfigManagerWithDefaults creates a config manager with default config path.
func NewConfigManagerWithDefaults() (ConfigManager, error) {
	return NewConfigManager("/etc/kubilitics/config.yaml")
}
