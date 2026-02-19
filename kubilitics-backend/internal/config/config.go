package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Port                int      `mapstructure:"port"`
	DatabasePath        string   `mapstructure:"database_path"`
	LogLevel            string   `mapstructure:"log_level"`   // debug | info | warn | error
	LogFormat           string   `mapstructure:"log_format"`  // json | text (BE-OBS-002)
	AllowedOrigins      []string `mapstructure:"allowed_origins"`
	KubeconfigPath      string   `mapstructure:"kubeconfig_path"`
	KubeconfigAutoLoad  bool     `mapstructure:"kubeconfig_auto_load"`    // On startup, if no clusters in DB, add all contexts from default kubeconfig (Docker Desktop, kind, etc.)
	RequestTimeoutSec   int      `mapstructure:"request_timeout_sec"`     // HTTP read/write; 0 = use server default
	TopologyTimeoutSec  int      `mapstructure:"topology_timeout_sec"`    // Topology build context timeout
	ShutdownTimeoutSec  int      `mapstructure:"shutdown_timeout_sec"`    // Graceful shutdown wait
	MaxClusters         int      `mapstructure:"max_clusters"`            // Max registered clusters (e.g. 100); 0 = default
	K8sTimeoutSec       int      `mapstructure:"k8s_timeout_sec"`         // Timeout for outbound K8s API calls; 0 = default
	TopologyCacheTTLSec int      `mapstructure:"topology_cache_ttl_sec"`  // Topology cache TTL; 0 = cache disabled
	TopologyMaxNodes    int      `mapstructure:"topology_max_nodes"`      // Max nodes per topology response; 0 = no limit (C1.4)
	K8sRateLimitPerSec  float64  `mapstructure:"k8s_rate_limit_per_sec"`  // Token bucket rate per cluster (req/s); 0 = no limit (C1.5)
	K8sRateLimitBurst   int      `mapstructure:"k8s_rate_limit_burst"`    // Token bucket burst per cluster; 0 = no limit (C1.5)
	ApplyMaxYAMLBytes   int      `mapstructure:"apply_max_yaml_bytes"`    // Max YAML body size for POST /apply (D1.2); 0 = default 512KB
	KCLIRateLimitPerSec float64  `mapstructure:"kcli_rate_limit_per_sec"` // Token bucket rate per cluster for /kcli APIs; 0 = disabled
	KCLIRateLimitBurst  int      `mapstructure:"kcli_rate_limit_burst"`   // Burst for /kcli APIs; 0 uses sane default
	KCLIStreamMaxConns  int      `mapstructure:"kcli_stream_max_conns"`   // Max concurrent /kcli/stream sessions per cluster; 0 uses default
	KCLIAllowShellMode  bool     `mapstructure:"kcli_allow_shell_mode"`   // Allow /kcli/stream?mode=shell (interactive shell)
	AIBackendURL        string   `mapstructure:"ai_backend_url"`         // AI backend URL for kcli AI commands (default: http://localhost:8081)

	// Session management (Phase 4: Session Management)
	MaxConcurrentSessions int `mapstructure:"max_concurrent_sessions"` // Max concurrent sessions per user; 0 = unlimited (default: 5)
	SessionInactivityTimeoutSec int `mapstructure:"session_inactivity_timeout_sec"` // Auto-expire sessions after inactivity; 0 = use token expiry
	TokenCleanupIntervalSec int `mapstructure:"token_cleanup_interval_sec"` // Token cleanup job interval in seconds (default: 3600)

	// Password policy (Phase 5: Advanced Security Features)
	PasswordMinLength        int `mapstructure:"password_min_length"`         // Minimum password length (default: 12)
	PasswordRequireUppercase bool `mapstructure:"password_require_uppercase"` // Require uppercase letters
	PasswordRequireLowercase bool `mapstructure:"password_require_lowercase"` // Require lowercase letters
	PasswordRequireNumbers   bool `mapstructure:"password_require_numbers"`   // Require numbers
	PasswordRequireSpecial   bool `mapstructure:"password_require_special"`   // Require special characters
	PasswordHistoryCount     int `mapstructure:"password_history_count"`      // Prevent reuse of last N passwords (default: 5)
	PasswordExpirationDays   int `mapstructure:"password_expiration_days"`    // Force password change after N days (0 = disabled)

	// Auth (BE-AUTH-001): disabled = no login (desktop default), optional = accept Bearer or anonymous, required = require Bearer
	AuthMode        string `mapstructure:"auth_mode"`         // disabled | optional | required
	AuthJWTSecret   string `mapstructure:"auth_jwt_secret"`   // Signing secret when auth enabled; required if mode != disabled
	AuthAdminUser   string `mapstructure:"auth_admin_user"`   // Bootstrap admin username when no users exist
	AuthAdminPass   string `mapstructure:"auth_admin_pass"`   // Bootstrap admin password (plaintext; only used on first run)

	// gRPC (for kubilitics-ai integration)
	GRPCPort     int  `mapstructure:"grpc_port"`      // gRPC server port (default: 50051)
	GRPCTLSEnabled bool `mapstructure:"grpc_tls_enabled"` // Enable TLS for gRPC (default: false)

	// Metrics endpoint authentication
	MetricsAuthEnabled bool `mapstructure:"metrics_auth_enabled"` // Require auth for /metrics endpoint (default: false)

	// TLS (BE-TLS-001): Enable HTTPS/TLS encryption
	TLSEnabled bool   `mapstructure:"tls_enabled"`   // Enable TLS/HTTPS
	TLSCertPath string `mapstructure:"tls_cert_path"`  // Path to TLS certificate file (PEM format)
	TLSKeyPath  string `mapstructure:"tls_key_path"`   // Path to TLS private key file (PEM format)

	// Tracing (BE-OBS-001): OpenTelemetry distributed tracing
	TracingEnabled      bool   `mapstructure:"tracing_enabled"`       // Enable distributed tracing
	TracingEndpoint     string `mapstructure:"tracing_endpoint"`      // OTLP endpoint (e.g., http://localhost:4317 or http://localhost:4318)
	TracingServiceName  string `mapstructure:"tracing_service_name"`  // Service name for traces (default: kubilitics-backend)
	TracingSamplingRate float64 `mapstructure:"tracing_sampling_rate"` // Sampling rate (0.0-1.0, default: 1.0)

	// OIDC (Phase 2: Enterprise Authentication)
	OIDCEnabled       bool   `mapstructure:"oidc_enabled"`        // Enable OIDC SSO
	OIDCIssuerURL     string `mapstructure:"oidc_issuer_url"`     // OIDC issuer URL (e.g., https://accounts.google.com)
	OIDCClientID      string `mapstructure:"oidc_client_id"`      // OIDC client ID
	OIDCClientSecret  string `mapstructure:"oidc_client_secret"`  // OIDC client secret
	OIDCRedirectURL   string `mapstructure:"oidc_redirect_url"`    // OIDC redirect URL (e.g., http://localhost:819/api/v1/auth/oidc/callback)
	OIDCScopes        string `mapstructure:"oidc_scopes"`         // OIDC scopes (comma-separated, default: "openid profile email")
	OIDCGroupClaim    string `mapstructure:"oidc_group_claim"`    // OIDC group claim name (default: "groups")
	OIDCRoleMapping   string `mapstructure:"oidc_role_mapping"`   // JSON mapping: {"group1": "admin", "group2": "operator"}

	// SAML 2.0 (Phase 2: Enterprise Authentication)
	SAMLEnabled                    bool   `mapstructure:"saml_enabled"`                      // Enable SAML 2.0 SSO
	SAMLIdpMetadataURL             string `mapstructure:"saml_idp_metadata_url"`             // IdP metadata URL (e.g., https://idp.example.com/metadata)
	SAMLIdpEntityID                string `mapstructure:"saml_idp_entity_id"`               // IdP entity ID (if not in metadata)
	SAMLCertificate                string `mapstructure:"saml_certificate"`                 // SP certificate (PEM format) for signing requests
	SAMLPrivateKey                 string `mapstructure:"saml_private_key"`                 // SP private key (PEM format) for signing requests
	SAMLAssertionConsumerServiceURL string `mapstructure:"saml_assertion_consumer_service_url"` // ACS URL (e.g., http://localhost:819/api/v1/auth/saml/acs)
	SAMLSingleLogoutServiceURL     string `mapstructure:"saml_single_logout_service_url"`  // SLO URL (e.g., http://localhost:819/api/v1/auth/saml/slo)
	SAMLAttributeMapping           string `mapstructure:"saml_attribute_mapping"`           // JSON mapping: {"email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "username": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", "groups": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"}
	SAMLNameIDFormat               string `mapstructure:"saml_name_id_format"`             // NameID format (default: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient")

	// MFA TOTP (Phase 5: Advanced Security Features)
	MFARequired      bool   `mapstructure:"mfa_required"`       // Require MFA for all users
	MFAEnforcedRoles string `mapstructure:"mfa_enforced_roles"` // Comma-separated roles that require MFA (e.g., "admin,operator")
	MFAEncryptionKey string `mapstructure:"mfa_encryption_key"` // AES-GCM key for encrypting TOTP secrets (32 bytes base64 encoded)
}

func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("/etc/kubilitics/")
	viper.AddConfigPath("$HOME/.kubilitics")
	viper.AddConfigPath(".")

	// Defaults
	viper.SetDefault("port", 819)
	viper.SetDefault("database_path", "./kubilitics.db")
	viper.SetDefault("log_level", "info")
	viper.SetDefault("log_format", "json") // BE-OBS-002: JSON structured logging by default
	// Development-safe default: no wildcard. Production must set explicit origins (e.g. https://your-domain.com).
	// Tauri desktop WebView uses origin `tauri://localhost` for all fetch() calls — this MUST be in the list
	// or the browser blocks every API request with a CORS error (even though the backend is local).
	// The sidecar spawner also sets KUBILITICS_ALLOWED_ORIGINS env var at runtime which overrides this default.
	viper.SetDefault("allowed_origins", []string{
		"tauri://localhost", // Tauri v2 WebView origin (macOS/Windows/Linux desktop)
		"tauri://",         // Tauri origin without explicit host (some platforms)
		"http://localhost:5173", // Vite dev server
		"http://localhost:819",  // Backend self-origin (health dashboards etc.)
	})
	viper.SetDefault("kubeconfig_path", "")
	viper.SetDefault("kubeconfig_auto_load", true)
	viper.SetDefault("request_timeout_sec", 30)
	viper.SetDefault("topology_timeout_sec", 30)
	viper.SetDefault("shutdown_timeout_sec", 15)
	viper.SetDefault("max_clusters", 100)
	viper.SetDefault("k8s_timeout_sec", 30)
	viper.SetDefault("topology_cache_ttl_sec", 30)
	viper.SetDefault("topology_max_nodes", 5000)  // recommended cap for large clusters (C1.4)
	viper.SetDefault("k8s_rate_limit_per_sec", 0) // 0 = disabled
	viper.SetDefault("k8s_rate_limit_burst", 0)
	viper.SetDefault("apply_max_yaml_bytes", 5*1024*1024) // 5MB for YAML apply (BE-DATA-001); standard API body limit 512KB via middleware
	viper.SetDefault("kcli_rate_limit_per_sec", 12.0)
	viper.SetDefault("kcli_rate_limit_burst", 24)
	viper.SetDefault("kcli_stream_max_conns", 4)
	viper.SetDefault("kcli_allow_shell_mode", false) // Security: shell mode requires explicit opt-in
	viper.SetDefault("ai_backend_url", "http://localhost:8081")
	viper.SetDefault("grpc_port", 50051)
	viper.SetDefault("grpc_tls_enabled", false)
	viper.SetDefault("metrics_auth_enabled", false) // Default: public metrics (Prometheus scraping)

	// Session management defaults (Phase 4: Session Management)
	viper.SetDefault("max_concurrent_sessions", 5)
	viper.SetDefault("session_inactivity_timeout_sec", 0) // 0 = use token expiry
	viper.SetDefault("token_cleanup_interval_sec", 3600) // Run cleanup every hour

	// Password policy defaults (Phase 5: Advanced Security Features)
	viper.SetDefault("password_min_length", 12)
	viper.SetDefault("password_require_uppercase", true)
	viper.SetDefault("password_require_lowercase", true)
	viper.SetDefault("password_require_numbers", true)
	viper.SetDefault("password_require_special", true)
	viper.SetDefault("password_history_count", 5)
	viper.SetDefault("password_expiration_days", 90)

	// Auth defaults: disabled for desktop/local use (Headlamp/Lens model)
	viper.SetDefault("auth_mode", "disabled")
	viper.SetDefault("auth_jwt_secret", "")
	viper.SetDefault("auth_admin_user", "")
	viper.SetDefault("auth_admin_pass", "")

	// TLS defaults: disabled for development, enable in production (BE-TLS-001)
	viper.SetDefault("tls_enabled", false)
	viper.SetDefault("tls_cert_path", "")
	viper.SetDefault("tls_key_path", "")

	// Tracing defaults (BE-OBS-001): disabled by default, enable via OTEL_EXPORTER_OTLP_ENDPOINT or config
	viper.SetDefault("tracing_enabled", false)
	viper.SetDefault("tracing_endpoint", "")
	viper.SetDefault("tracing_service_name", "kubilitics-backend")
	viper.SetDefault("tracing_sampling_rate", 1.0)

	// OIDC defaults (Phase 2: Enterprise Authentication)
	viper.SetDefault("oidc_enabled", false)
	viper.SetDefault("oidc_issuer_url", "")
	viper.SetDefault("oidc_client_id", "")
	viper.SetDefault("oidc_client_secret", "")
	viper.SetDefault("oidc_redirect_url", "")
	viper.SetDefault("oidc_scopes", "openid profile email")
	viper.SetDefault("oidc_group_claim", "groups")
	viper.SetDefault("oidc_role_mapping", "")

	// Environment variables
	viper.SetEnvPrefix("KUBILITICS")
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
		// Config file not found; using defaults and env vars
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	// Normalize allowed_origins: env KUBILITICS_ALLOWED_ORIGINS is often comma-separated (e.g. from Helm).
	// BA-5: Handle both comma-separated string and already-split array, always trim whitespace.
	if len(cfg.AllowedOrigins) == 1 && strings.Contains(cfg.AllowedOrigins[0], ",") {
		// Single string with commas - split and trim
		parts := strings.Split(cfg.AllowedOrigins[0], ",")
		cfg.AllowedOrigins = make([]string, 0, len(parts))
		for _, p := range parts {
			if o := strings.TrimSpace(p); o != "" {
				cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
			}
		}
	} else {
		// Already split array - trim whitespace from each element
		normalized := make([]string, 0, len(cfg.AllowedOrigins))
		for _, origin := range cfg.AllowedOrigins {
			if trimmed := strings.TrimSpace(origin); trimmed != "" {
				normalized = append(normalized, trimmed)
			}
		}
		cfg.AllowedOrigins = normalized
	}

	// P0-F: Always append Tauri origins AFTER env and file are applied (Unmarshal above uses
	// viper state after AutomaticEnv and ReadInConfig). So KUBILITICS_ALLOWED_ORIGINS override
	// still gets tauri://localhost and tauri:// appended. When port 819 is already in use (e.g.
	// make restart), the desktop skips spawning the sidecar; the existing backend still allows
	// tauri://localhost.
	tauriOrigins := []string{"tauri://localhost", "tauri://"}
	for _, o := range tauriOrigins {
		found := false
		for _, existing := range cfg.AllowedOrigins {
			if existing == o {
				found = true
				break
			}
		}
		if !found {
			cfg.AllowedOrigins = append(cfg.AllowedOrigins, o)
		}
	}

	// BE-OBS-001: Auto-enable tracing if OTEL_EXPORTER_OTLP_ENDPOINT is set
	if !cfg.TracingEnabled && os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") != "" {
		cfg.TracingEnabled = true
		if cfg.TracingEndpoint == "" {
			cfg.TracingEndpoint = os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
		}
	}

	return &cfg, nil
}
