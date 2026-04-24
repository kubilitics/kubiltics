package config

import (
	"fmt"
	"net"
	"os"
	"strings"
)

// ValidationError represents a configuration validation error.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("config validation failed for %s: %s", e.Field, e.Message)
}

// Validate validates the configuration and returns validation errors.
func (c *Config) Validate() []error {
	var errs []error

	// Validate server configuration
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		errs = append(errs, &ValidationError{
			Field:   "server.port",
			Message: fmt.Sprintf("port must be between 1 and 65535, got %d", c.Server.Port),
		})
	}

	if c.Server.TLSEnabled {
		if c.Server.TLSCertPath == "" {
			errs = append(errs, &ValidationError{
				Field:   "server.tls_cert_path",
				Message: "tls_cert_path is required when tls_enabled is true",
			})
		} else if _, err := os.Stat(c.Server.TLSCertPath); os.IsNotExist(err) {
			errs = append(errs, &ValidationError{
				Field:   "server.tls_cert_path",
				Message: fmt.Sprintf("certificate file does not exist: %s", c.Server.TLSCertPath),
			})
		}

		if c.Server.TLSKeyPath == "" {
			errs = append(errs, &ValidationError{
				Field:   "server.tls_key_path",
				Message: "tls_key_path is required when tls_enabled is true",
			})
		} else if _, err := os.Stat(c.Server.TLSKeyPath); os.IsNotExist(err) {
			errs = append(errs, &ValidationError{
				Field:   "server.tls_key_path",
				Message: fmt.Sprintf("key file does not exist: %s", c.Server.TLSKeyPath),
			})
		}
	}

	// Validate backend configuration
	if c.Backend.Address == "" {
		errs = append(errs, &ValidationError{
			Field:   "backend.address",
			Message: "backend address is required",
		})
	} else {
		// Validate host:port format
		host, port, err := net.SplitHostPort(c.Backend.Address)
		if err != nil {
			errs = append(errs, &ValidationError{
				Field:   "backend.address",
				Message: fmt.Sprintf("invalid address format (expected host:port): %v", err),
			})
		} else if host == "" {
			errs = append(errs, &ValidationError{
				Field:   "backend.address",
				Message: "backend host cannot be empty",
			})
		} else if port == "" {
			errs = append(errs, &ValidationError{
				Field:   "backend.address",
				Message: "backend port cannot be empty",
			})
		}
	}

	if c.Backend.Timeout < 1 {
		errs = append(errs, &ValidationError{
			Field:   "backend.timeout",
			Message: fmt.Sprintf("timeout must be at least 1 second, got %d", c.Backend.Timeout),
		})
	}

	// Validate LLM configuration
	validProviders := map[string]bool{
		"openai":    true,
		"anthropic": true,
		"ollama":    true,
		"custom":    true,
	}
	if !validProviders[c.LLM.Provider] {
		errs = append(errs, &ValidationError{
			Field:   "llm.provider",
			Message: fmt.Sprintf("invalid provider '%s', must be one of: openai, anthropic, ollama, custom", c.LLM.Provider),
		})
	}

	// Provider-specific validation
	switch c.LLM.Provider {
	case "openai":
		if apiKey, ok := c.LLM.OpenAI["api_key"].(string); ok && apiKey != "" {
			c.LLM.Configured = true
		} else if os.Getenv("OPENAI_API_KEY") != "" {
			// If env var is present, it's configured (even if not in map yet)
			c.LLM.Configured = true
		} else {
			// Not configured, but strict validation might require it?
			// The legacy logic allowed it to be unconfigured (degraded mode).
			// But here we return errors if missing!
			// Legacy `server/config.go` said: "Missing credentials are not fatal... returns HTTP 503".
			// So we should NOT append errors if key is missing, unless we want to enforce it.
			// The new config system seems stricter.
			// Let's adopt the legacy behavior: Warn/Set flag, but DON'T error if missing?
			// BUT the current implementation DOES append errors.
			// "OpenAI API key is required"
			// If I remove the error, I can support degraded mode.
			// I like degraded mode.
			// So I will REMOVE the error return for missing keys, and instead just set Configured=false.
		}

		// Check for key to set Configured
		hasKey := false
		if apiKey, ok := c.LLM.OpenAI["api_key"].(string); ok && apiKey != "" {
			hasKey = true
		} else if os.Getenv("OPENAI_API_KEY") != "" {
			hasKey = true
		}
		c.LLM.Configured = hasKey

		// We still validate model if configured, or maybe always?
		// If not configured, we might skip model validation?
		if hasKey {
			if model, ok := c.LLM.OpenAI["model"].(string); !ok || model == "" {
				errs = append(errs, &ValidationError{
					Field:   "llm.openai.model",
					Message: "OpenAI model is required",
				})
			}
		}

	case "anthropic":
		hasKey := false
		if apiKey, ok := c.LLM.Anthropic["api_key"].(string); ok && apiKey != "" {
			hasKey = true
		} else if os.Getenv("ANTHROPIC_API_KEY") != "" {
			hasKey = true
		}
		c.LLM.Configured = hasKey

		if hasKey {
			if model, ok := c.LLM.Anthropic["model"].(string); !ok || model == "" {
				errs = append(errs, &ValidationError{
					Field:   "llm.anthropic.model",
					Message: "Anthropic model is required",
				})
			}
		}

	case "ollama":
		// Ollama is always configured (defaults exist or no key needed)
		c.LLM.Configured = true

		if baseURL, ok := c.LLM.Ollama["base_url"].(string); !ok || baseURL == "" {
			errs = append(errs, &ValidationError{
				Field:   "llm.ollama.base_url",
				Message: "Ollama base URL is required",
			})
		}
		// Model is optional? No, usually required.
		if model, ok := c.LLM.Ollama["model"].(string); !ok || model == "" {
			errs = append(errs, &ValidationError{
				Field:   "llm.ollama.model",
				Message: "Ollama model is required",
			})
		}

	case "custom":
		if baseURL, ok := c.LLM.Custom["base_url"].(string); ok && baseURL != "" {
			c.LLM.Configured = true
		} else {
			c.LLM.Configured = false
		}
	}

	// Validate autonomy configuration
	if c.Autonomy.DefaultLevel < 0 || c.Autonomy.DefaultLevel > 5 {
		errs = append(errs, &ValidationError{
			Field:   "autonomy.default_level",
			Message: fmt.Sprintf("default_level must be between 0 and 5, got %d", c.Autonomy.DefaultLevel),
		})
	}

	// Validate database configuration
	validDatabaseTypes := map[string]bool{
		"sqlite":   true,
		"postgres": true,
	}
	if !validDatabaseTypes[c.Database.Type] {
		errs = append(errs, &ValidationError{
			Field:   "database.type",
			Message: fmt.Sprintf("invalid database type '%s', must be one of: sqlite, postgres", c.Database.Type),
		})
	}

	switch c.Database.Type {
	case "sqlite":
		if c.Database.SQLitePath == "" {
			errs = append(errs, &ValidationError{
				Field:   "database.sqlite_path",
				Message: "sqlite_path is required when database type is sqlite",
			})
		}
	case "postgres":
		if c.Database.PostgresURL == "" {
			errs = append(errs, &ValidationError{
				Field:   "database.postgres_url",
				Message: "postgres_url is required when database type is postgres",
			})
		}
	}

	// Validate analytics configuration
	if c.Analytics.TimeseriesRetentionDays < 1 {
		errs = append(errs, &ValidationError{
			Field:   "analytics.timeseries_retention_days",
			Message: fmt.Sprintf("retention days must be at least 1, got %d", c.Analytics.TimeseriesRetentionDays),
		})
	}

	// Validate cache configuration
	if c.Cache.TTLSeconds < 0 {
		errs = append(errs, &ValidationError{
			Field:   "cache.ttl_seconds",
			Message: fmt.Sprintf("ttl_seconds cannot be negative, got %d", c.Cache.TTLSeconds),
		})
	}

	if c.Cache.MaxSizeMB < 0 {
		errs = append(errs, &ValidationError{
			Field:   "cache.max_size_mb",
			Message: fmt.Sprintf("max_size_mb cannot be negative, got %d", c.Cache.MaxSizeMB),
		})
	}

	// Validate logging configuration
	validLogLevels := map[string]bool{
		"debug": true,
		"info":  true,
		"warn":  true,
		"error": true,
	}
	if !validLogLevels[strings.ToLower(c.Logging.Level)] {
		errs = append(errs, &ValidationError{
			Field:   "logging.level",
			Message: fmt.Sprintf("invalid log level '%s', must be one of: debug, info, warn, error", c.Logging.Level),
		})
	}

	validLogFormats := map[string]bool{
		"json": true,
		"text": true,
	}
	if !validLogFormats[strings.ToLower(c.Logging.Format)] {
		errs = append(errs, &ValidationError{
			Field:   "logging.format",
			Message: fmt.Sprintf("invalid log format '%s', must be one of: json, text", c.Logging.Format),
		})
	}

	// Validate budget configuration
	if c.Budget.GlobalMonthlyBudget < 0 {
		errs = append(errs, &ValidationError{
			Field:   "budget.global_monthly_budget",
			Message: fmt.Sprintf("global_monthly_budget cannot be negative, got %.2f", c.Budget.GlobalMonthlyBudget),
		})
	}

	if c.Budget.PerUserMonthlyBudget < 0 {
		errs = append(errs, &ValidationError{
			Field:   "budget.per_user_monthly_budget",
			Message: fmt.Sprintf("per_user_monthly_budget cannot be negative, got %.2f", c.Budget.PerUserMonthlyBudget),
		})
	}

	if c.Budget.PerInvestigationLimit < 0 {
		errs = append(errs, &ValidationError{
			Field:   "budget.per_investigation_limit",
			Message: fmt.Sprintf("per_investigation_limit cannot be negative, got %d", c.Budget.PerInvestigationLimit),
		})
	}

	return errs
}
