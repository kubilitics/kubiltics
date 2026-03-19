package config

// DefaultConfig returns a configuration with all default values.
func DefaultConfig() *Config {
	cfg := &Config{}

	// Server defaults
	cfg.Server.Port = 8081
	cfg.Server.TLSEnabled = false
	cfg.Server.TLSCertPath = ""
	cfg.Server.TLSKeyPath = ""

	// Backend defaults
	cfg.Backend.Address = "localhost:50051"
	cfg.Backend.HTTPBaseURL = "http://localhost:819"
	cfg.Backend.Timeout = 30
	cfg.Backend.TLSEnabled = false

	// LLM defaults
	cfg.LLM.Provider = "anthropic"
	cfg.LLM.OpenAI = map[string]interface{}{
		"model":      "gpt-4",
		"max_tokens": 2048,
	}
	cfg.LLM.Anthropic = map[string]interface{}{
		"model":      "claude-3-5-sonnet-20241022",
		"max_tokens": 2048,
	}
	cfg.LLM.Ollama = map[string]interface{}{
		"base_url": "http://localhost:11434",
		"model":    "llama3",
	}
	cfg.LLM.Custom = map[string]interface{}{
		"base_url":   "",
		"model":      "",
		"max_tokens": 2048,
	}

	// Autonomy defaults
	cfg.Autonomy.DefaultLevel = 2 // Propose (requires approval)
	cfg.Autonomy.AllowLevelOverride = true

	// Safety defaults
	cfg.Safety.EnableImmutableRules = true
	cfg.Safety.EnableCustomPolicies = true
	cfg.Safety.RequireApprovalForDelet = true
	cfg.Safety.RequireApprovalForRisky = true

	// Database defaults
	cfg.Database.Type = "sqlite"
	cfg.Database.SQLitePath = "/var/lib/kubilitics/kubilitics-ai.db"
	cfg.Database.PostgresURL = ""

	// Analytics defaults
	cfg.Analytics.TimeseriesRetentionDays = 7
	cfg.Analytics.EnableAnomalyDetection = true
	cfg.Analytics.EnableForecasting = true

	// Cache defaults
	cfg.Cache.EnableCaching = true
	cfg.Cache.TTLSeconds = 300
	cfg.Cache.MaxSizeMB = 100

	// Logging defaults
	cfg.Logging.Level = "info"
	cfg.Logging.Format = "json"

	// MCP defaults — always enabled; MCP is the core tool layer for cluster intelligence.
	cfg.MCP.Enabled = true

	// Safety defaults — enabled by default
	cfg.Safety.Enabled = true

	// Analytics defaults — enabled by default
	cfg.Analytics.Enabled = true

	// Budget defaults
	cfg.Budget.GlobalMonthlyBudget = 0.0 // 0 means no limit
	cfg.Budget.PerUserMonthlyBudget = 0.0
	cfg.Budget.PerInvestigationLimit = 0

	return cfg
}
