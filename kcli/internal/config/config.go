package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kubilitics/kcli/internal/keychain"
	"gopkg.in/yaml.v3"
)

const (
	configDirName  = ".kcli"
	configFileName = "config.yaml"
)

var (
	allowedThemes = map[string]struct{}{
		"ocean":  {},
		"forest": {},
		"amber":  {},
	}
)

func ptr[T any](v T) *T { return &v }

type Store struct {
	ActiveProfile string             `yaml:"active_profile" json:"active_profile"`
	Profiles      map[string]*Config `yaml:"profiles" json:"profiles"`
}

type Config struct {
	General      GeneralConfig      `yaml:"general" json:"general"`
	Context      ContextConfig      `yaml:"context" json:"context"`
	TUI          TUIConfig          `yaml:"tui" json:"tui"`
	Logs         LogsConfig         `yaml:"logs" json:"logs"`
	Performance  PerformanceConfig  `yaml:"performance" json:"performance"`
	Shell        ShellConfig        `yaml:"shell" json:"shell"`
	AI           AIConfig           `yaml:"ai" json:"ai"`
	Integrations IntegrationsConfig `yaml:"integrations" json:"integrations"`
	// KeychainKeys lists config key paths whose values are stored in the system keychain (P3-9).
	// E.g. ["ai.api_key", "integrations.pagerDutyKey"]. Persisted in config file; values resolved on Load.
	KeychainKeys []string `yaml:"keychain_keys,omitempty" json:"keychain_keys,omitempty"`
}

// IntegrationsConfig holds external tool endpoint configuration.
type IntegrationsConfig struct {
	PrometheusEndpoint string `yaml:"prometheusEndpoint,omitempty" json:"prometheusEndpoint,omitempty"`
	GitopsEngine       string `yaml:"gitopsEngine,omitempty" json:"gitopsEngine,omitempty"` // "argocd" | "flux" | ""
	PagerDutyKey       string `yaml:"pagerDutyKey,omitempty" json:"pagerDutyKey,omitempty"`
	SlackWebhook       string `yaml:"slackWebhook,omitempty" json:"slackWebhook,omitempty"`
	JiraURL            string `yaml:"jiraUrl,omitempty" json:"jiraUrl,omitempty"`
	JiraToken          string `yaml:"jiraToken,omitempty" json:"jiraToken,omitempty"`
	JiraProject        string `yaml:"jiraProject,omitempty" json:"jiraProject,omitempty"`
	// OpenCostEndpoint is the base URL of an OpenCost instance (e.g. http://opencost:9090).
	// When set, kcli cost overview uses OpenCost's /allocation API for actual-usage billing data.
	// Auto-detected from the cluster if not set and the opencost service exists in the opencost namespace.
	OpenCostEndpoint string `yaml:"opencostEndpoint,omitempty" json:"opencostEndpoint,omitempty"`
	// LokiEndpoint is the base URL of a Loki instance (e.g. http://loki:3100).
	LokiEndpoint string `yaml:"lokiEndpoint,omitempty" json:"lokiEndpoint,omitempty"`
}

type GeneralConfig struct {
	Theme             string `yaml:"theme" json:"theme"`
	StartupTimeBudget string `yaml:"startupTimeBudget" json:"startupTimeBudget"`
	// KubectlPath is the path to the kubectl binary (default: "kubectl"). Use for air-gapped or custom wrappers.
	KubectlPath string `yaml:"kubectlPath" json:"kubectlPath"`
	// AuditEnabled records mutating kubectl commands to ~/.kcli/audit.json. Nil = default enabled. Set via kcli audit enable/disable.
	AuditEnabled *bool `yaml:"auditEnabled,omitempty" json:"auditEnabled,omitempty"`
}

type ContextConfig struct {
	Favorites   []string            `yaml:"favorites" json:"favorites"`
	Groups      map[string][]string `yaml:"groups" json:"groups"`
	RecentLimit int                 `yaml:"recentLimit" json:"recentLimit"`
}

type TUIConfig struct {
	RefreshInterval string `yaml:"refreshInterval" json:"refreshInterval"`
	Theme           string `yaml:"theme" json:"theme"`
	Colors          bool   `yaml:"colors" json:"colors"`
	Animations      bool   `yaml:"animations" json:"animations"`
	// MaxListSize limits the number of resources loaded in TUI (e.g. 2000). 0 = no limit. Use for large clusters to keep memory and latency under control.
	MaxListSize int `yaml:"maxListSize" json:"maxListSize"`
	// ReadOnly disables all mutations in the TUI (edit, exec, bulk-delete, etc.).
	// Useful for shared/demo/audit environments. Equivalent to --read-only flag.
	ReadOnly bool `yaml:"readOnly" json:"readOnly"`
}

type LogsConfig struct {
	FollowNewPods bool `yaml:"followNewPods" json:"followNewPods"`
	MaxPods       int  `yaml:"maxPods" json:"maxPods"`
	Colors        bool `yaml:"colors" json:"colors"`
}

type PerformanceConfig struct {
	CacheTTL      string `yaml:"cacheTTL" json:"cacheTTL"`
	MemoryLimitMB int    `yaml:"memoryLimitMB" json:"memoryLimitMB"`
}

type ShellConfig struct {
	PromptFormat string            `yaml:"promptFormat" json:"promptFormat"`
	Aliases      map[string]string `yaml:"aliases" json:"aliases"`
}

type AIConfig struct {
	Enabled          bool    `yaml:"enabled" json:"enabled"`
	Provider         string  `yaml:"provider" json:"provider"`
	Model            string  `yaml:"model" json:"model"`
	APIKey           string  `yaml:"apiKey,omitempty" json:"apiKey,omitempty"`
	Endpoint         string  `yaml:"endpoint,omitempty" json:"endpoint,omitempty"`
	BudgetMonthlyUSD float64 `yaml:"budgetMonthlyUSD" json:"budgetMonthlyUSD"`
	SoftLimitPercent float64 `yaml:"softLimitPercent" json:"softLimitPercent"`
	// MaxInputChars caps total prompt input sent to the provider (0 = no limit). Helps avoid cost and injection surface.
	MaxInputChars int `yaml:"maxInputChars" json:"maxInputChars"`
}

func Default() *Config {
	return &Config{
		General: GeneralConfig{
			Theme:             "ocean",
			StartupTimeBudget: "250ms",
			AuditEnabled:      ptr(true),
		},
		Context: ContextConfig{
			Favorites:   []string{},
			Groups:      map[string][]string{},
			RecentLimit: 10,
		},
		TUI: TUIConfig{
			RefreshInterval: "2s",
			Theme:           "",
			Colors:          true,
			Animations:      true,
		},
		Logs: LogsConfig{
			FollowNewPods: true,
			MaxPods:       20,
			Colors:        true,
		},
		Performance: PerformanceConfig{
			CacheTTL:      "60s",
			MemoryLimitMB: 256,
		},
		Shell: ShellConfig{
			PromptFormat: "[{{.context}}/{{.namespace}}]$ ",
			Aliases:      map[string]string{},
		},
		AI: AIConfig{
			Enabled:          true,
			Provider:         "",
			Model:            "",
			APIKey:           "",
			Endpoint:         "",
			BudgetMonthlyUSD: 50,
			SoftLimitPercent: 80,
			MaxInputChars:    16384,
		},
	}
}

func FilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, configDirName, configFileName), nil
}

func Load() (*Config, error) {
	s, err := LoadStore()
	if err != nil {
		return nil, err
	}
	return s.Current(), nil
}

func LoadStore() (*Store, error) {
	path, err := FilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			s := DefaultStore()
			return s, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		return DefaultStore(), nil
	}

	// Try to detect if it's an old single-config format or new Store format
	if !strings.Contains(string(b), "profiles:") {
		// Old format: migrate to Store
		cfg := Default()
		if err := yaml.Unmarshal(b, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse legacy config YAML: %w", err)
		}
		s := &Store{
			ActiveProfile: "default",
			Profiles: map[string]*Config{
				"default": cfg,
			},
		}
		return s, nil
	}

	s := DefaultStore()
	if err := yaml.Unmarshal(b, s); err != nil {
		return nil, fmt.Errorf("failed to parse config store YAML: %w", err)
	}
	if s.Profiles == nil {
		s.Profiles = map[string]*Config{"default": Default()}
	}
	if s.ActiveProfile == "" {
		s.ActiveProfile = "default"
	}
	for name, cfg := range s.Profiles {
		cfg.normalize()
		cfg.resolveKeychain(name)
	}
	return s, nil
}

func DefaultStore() *Store {
	return &Store{
		ActiveProfile: "default",
		Profiles: map[string]*Config{
			"default": Default(),
		},
	}
}

func (s *Store) Current() *Config {
	if s == nil || s.Profiles == nil {
		return Default()
	}
	cfg, ok := s.Profiles[s.ActiveProfile]
	if !ok {
		// Fallback to default if active not found
		if d, ok := s.Profiles["default"]; ok {
			return d
		}
		return Default()
	}
	return cfg
}

func Save(cfg *Config) error {
	s, err := LoadStore()
	if err != nil {
		return err
	}
	if s.Profiles == nil {
		s.Profiles = make(map[string]*Config)
	}
	s.Profiles[s.ActiveProfile] = cfg
	return SaveStore(s)
}

func SaveStore(s *Store) error {
	if s == nil {
		return fmt.Errorf("store is nil")
	}
	path, err := FilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// Marshal a copy with keychain-backed secrets zeroed so they are not written to disk (P3-9).
	out := &Store{ActiveProfile: s.ActiveProfile, Profiles: make(map[string]*Config)}
	for name, cfg := range s.Profiles {
		out.Profiles[name] = cfg.copyForSave()
	}
	b, err := yaml.Marshal(out)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func EnsureExists() (string, error) {
	path, err := FilePath()
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(path); err == nil {
		return path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	cfg := Default()
	if err := Save(cfg); err != nil {
		return "", err
	}
	return path, nil
}

func (c *Config) Validate() error {
	if c == nil {
		return fmt.Errorf("config is nil")
	}
	if err := validateTheme(c.General.Theme, "general.theme"); err != nil {
		return err
	}
	if _, err := parsePositiveDuration(c.General.StartupTimeBudget, "general.startupTimeBudget"); err != nil {
		return err
	}
	if c.Context.RecentLimit < 1 || c.Context.RecentLimit > 1000 {
		return fmt.Errorf("context.recentLimit must be between 1 and 1000")
	}
	if err := validateStringSlice(c.Context.Favorites, "context.favorites"); err != nil {
		return err
	}
	for name, members := range c.Context.Groups {
		if strings.TrimSpace(name) == "" {
			return fmt.Errorf("context.groups contains empty group name")
		}
		if err := validateStringSlice(members, "context.groups."+name); err != nil {
			return err
		}
	}
	if _, err := parsePositiveDuration(c.TUI.RefreshInterval, "tui.refreshInterval"); err != nil {
		return err
	}
	if strings.TrimSpace(c.TUI.Theme) != "" {
		if err := validateTheme(c.TUI.Theme, "tui.theme"); err != nil {
			return err
		}
	}
	if c.Logs.MaxPods < 1 || c.Logs.MaxPods > 500 {
		return fmt.Errorf("logs.maxPods must be between 1 and 500")
	}
	if _, err := parsePositiveDuration(c.Performance.CacheTTL, "performance.cacheTTL"); err != nil {
		return err
	}
	if c.Performance.MemoryLimitMB < 64 || c.Performance.MemoryLimitMB > 65536 {
		return fmt.Errorf("performance.memoryLimitMB must be between 64 and 65536")
	}
	if strings.TrimSpace(c.Shell.PromptFormat) == "" {
		return fmt.Errorf("shell.promptFormat cannot be empty")
	}
	for k, v := range c.Shell.Aliases {
		if strings.TrimSpace(k) == "" {
			return fmt.Errorf("shell.aliases contains empty alias name")
		}
		if strings.TrimSpace(v) == "" {
			return fmt.Errorf("shell.aliases.%s cannot be empty", k)
		}
	}
	if c.AI.BudgetMonthlyUSD < 0 {
		return fmt.Errorf("ai.budgetMonthlyUSD must be >= 0")
	}
	if c.AI.SoftLimitPercent <= 0 || c.AI.SoftLimitPercent >= 100 {
		return fmt.Errorf("ai.softLimitPercent must be > 0 and < 100")
	}
	return nil
}

func (c *Config) ResolvedTheme() string {
	if strings.TrimSpace(c.TUI.Theme) != "" {
		return strings.ToLower(strings.TrimSpace(c.TUI.Theme))
	}
	if strings.TrimSpace(c.General.Theme) != "" {
		return strings.ToLower(strings.TrimSpace(c.General.Theme))
	}
	return "ocean"
}

func (c *Config) RefreshIntervalDuration() time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(c.TUI.RefreshInterval))
	if err != nil || d <= 0 {
		return 2 * time.Second
	}
	return d
}

func (c *Config) SetByKey(key, value string) error {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return fmt.Errorf("key cannot be empty")
	}
	v := strings.TrimSpace(value)
	switch {
	case k == "general.theme":
		c.General.Theme = strings.ToLower(v)
	case k == "general.startuptimebudget", k == "general.startup_time_budget":
		c.General.StartupTimeBudget = v
	case k == "general.kubectlpath", k == "general.kubectl_path":
		c.General.KubectlPath = strings.TrimSpace(v)
	case k == "general.auditenabled", k == "general.audit_enabled":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("general.auditEnabled must be true or false")
		}
		c.General.AuditEnabled = ptr(b)
	case k == "context.recentlimit", k == "context.recent_limit":
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("context.recentLimit must be an integer")
		}
		c.Context.RecentLimit = n
	case k == "context.favorites":
		c.Context.Favorites = parseCSV(v)
	case strings.HasPrefix(k, "context.groups."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "context.groups."))
		if name == "" {
			return fmt.Errorf("context group name is required")
		}
		if c.Context.Groups == nil {
			c.Context.Groups = map[string][]string{}
		}
		c.Context.Groups[name] = parseCSV(v)
	case k == "tui.refreshinterval", k == "tui.refresh_interval":
		c.TUI.RefreshInterval = v
	case k == "tui.theme":
		c.TUI.Theme = strings.ToLower(v)
	case k == "tui.colors":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("tui.colors must be true or false")
		}
		c.TUI.Colors = b
	case k == "tui.animations":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("tui.animations must be true or false")
		}
		c.TUI.Animations = b
	case k == "tui.readonly", k == "tui.read_only":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("tui.readOnly must be true or false")
		}
		c.TUI.ReadOnly = b
	case k == "logs.follownewpods", k == "logs.follow_new_pods":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("logs.followNewPods must be true or false")
		}
		c.Logs.FollowNewPods = b
	case k == "logs.maxpods", k == "logs.max_pods":
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("logs.maxPods must be an integer")
		}
		c.Logs.MaxPods = n
	case k == "logs.colors":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("logs.colors must be true or false")
		}
		c.Logs.Colors = b
	case k == "performance.cachettl", k == "performance.cache_ttl":
		c.Performance.CacheTTL = v
	case k == "performance.memorylimitmb", k == "performance.memory_limit_mb":
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("performance.memoryLimitMB must be an integer")
		}
		c.Performance.MemoryLimitMB = n
	case k == "shell.promptformat", k == "shell.prompt_format":
		c.Shell.PromptFormat = value
	case strings.HasPrefix(k, "shell.aliases."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "shell.aliases."))
		if name == "" {
			return fmt.Errorf("alias name is required")
		}
		if c.Shell.Aliases == nil {
			c.Shell.Aliases = map[string]string{}
		}
		if v == "" {
			delete(c.Shell.Aliases, name)
		} else {
			c.Shell.Aliases[name] = value
		}
	case k == "ai.enabled":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("ai.enabled must be true or false")
		}
		c.AI.Enabled = b
	case k == "ai.provider":
		c.AI.Provider = strings.ToLower(v)
	case k == "ai.model":
		c.AI.Model = v
	case k == "ai.apikey", k == "ai.api_key":
		c.AI.APIKey = value
	case k == "ai.endpoint":
		c.AI.Endpoint = v
	case k == "ai.budgetmonthlyusd", k == "ai.budget_monthly_usd":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("ai.budgetMonthlyUSD must be a number")
		}
		c.AI.BudgetMonthlyUSD = f
	case k == "ai.softlimitpercent", k == "ai.soft_limit_percent":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("ai.softLimitPercent must be a number")
		}
		c.AI.SoftLimitPercent = f
	case k == "ai.maxinputchars", k == "ai.max_input_chars":
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return fmt.Errorf("ai.maxInputChars must be a non-negative integer")
		}
		c.AI.MaxInputChars = n
	case k == "integrations.prometheusendpoint", k == "integrations.prometheus_endpoint":
		c.Integrations.PrometheusEndpoint = v
	case k == "integrations.gitopsengine", k == "integrations.gitops_engine":
		c.Integrations.GitopsEngine = strings.ToLower(v)
	case k == "integrations.pagerdutykey", k == "integrations.pagerduty_key":
		c.Integrations.PagerDutyKey = value
	case k == "integrations.slackwebhook", k == "integrations.slack_webhook":
		c.Integrations.SlackWebhook = value
	case k == "integrations.jiraurl", k == "integrations.jira_url":
		c.Integrations.JiraURL = v
	case k == "integrations.jiratoken", k == "integrations.jira_token":
		c.Integrations.JiraToken = value
	case k == "integrations.jiraproject", k == "integrations.jira_project":
		c.Integrations.JiraProject = v
	case k == "integrations.opencostendpoint", k == "integrations.opencost_endpoint":
		c.Integrations.OpenCostEndpoint = strings.TrimRight(strings.TrimSpace(v), "/")
	case k == "integrations.lokiendpoint", k == "integrations.loki_endpoint":
		c.Integrations.LokiEndpoint = strings.TrimRight(strings.TrimSpace(v), "/")
	default:
		return fmt.Errorf("unsupported key %q", key)
	}
	c.normalize()
	return c.Validate()
}

func (c *Config) GetByKey(key string) (any, error) {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return nil, fmt.Errorf("key cannot be empty")
	}
	switch {
	case k == "general.theme":
		return c.General.Theme, nil
	case k == "general.startuptimebudget", k == "general.startup_time_budget":
		return c.General.StartupTimeBudget, nil
	case k == "general.kubectlpath", k == "general.kubectl_path":
		return c.General.KubectlPath, nil
	case k == "general.auditenabled", k == "general.audit_enabled":
		if c.General.AuditEnabled == nil {
			return true, nil
		}
		return *c.General.AuditEnabled, nil
	case k == "context.recentlimit", k == "context.recent_limit":
		return c.Context.RecentLimit, nil
	case k == "context.favorites":
		return append([]string(nil), c.Context.Favorites...), nil
	case strings.HasPrefix(k, "context.groups."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "context.groups."))
		if name == "" {
			return nil, fmt.Errorf("context group name is required")
		}
		return append([]string(nil), c.Context.Groups[name]...), nil
	case k == "tui.refreshinterval", k == "tui.refresh_interval":
		return c.TUI.RefreshInterval, nil
	case k == "tui.theme":
		return c.TUI.Theme, nil
	case k == "tui.colors":
		return c.TUI.Colors, nil
	case k == "tui.animations":
		return c.TUI.Animations, nil
	case k == "tui.readonly", k == "tui.read_only":
		return c.TUI.ReadOnly, nil
	case k == "logs.follownewpods", k == "logs.follow_new_pods":
		return c.Logs.FollowNewPods, nil
	case k == "logs.maxpods", k == "logs.max_pods":
		return c.Logs.MaxPods, nil
	case k == "logs.colors":
		return c.Logs.Colors, nil
	case k == "performance.cachettl", k == "performance.cache_ttl":
		return c.Performance.CacheTTL, nil
	case k == "performance.memorylimitmb", k == "performance.memory_limit_mb":
		return c.Performance.MemoryLimitMB, nil
	case k == "shell.promptformat", k == "shell.prompt_format":
		return c.Shell.PromptFormat, nil
	case strings.HasPrefix(k, "shell.aliases."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "shell.aliases."))
		if name == "" {
			return nil, fmt.Errorf("alias name is required")
		}
		v, ok := c.Shell.Aliases[name]
		if !ok {
			return "", nil
		}
		return v, nil
	case k == "ai.enabled":
		return c.AI.Enabled, nil
	case k == "ai.provider":
		return c.AI.Provider, nil
	case k == "ai.model":
		return c.AI.Model, nil
	case k == "ai.apikey", k == "ai.api_key":
		return maskIfSet(c.AI.APIKey), nil
	case k == "ai.endpoint":
		return c.AI.Endpoint, nil
	case k == "ai.budgetmonthlyusd", k == "ai.budget_monthly_usd":
		return c.AI.BudgetMonthlyUSD, nil
	case k == "ai.softlimitpercent", k == "ai.soft_limit_percent":
		return c.AI.SoftLimitPercent, nil
	case k == "ai.maxinputchars", k == "ai.max_input_chars":
		return c.AI.MaxInputChars, nil
	case k == "integrations.prometheusendpoint", k == "integrations.prometheus_endpoint":
		return c.Integrations.PrometheusEndpoint, nil
	case k == "integrations.gitopsengine", k == "integrations.gitops_engine":
		return c.Integrations.GitopsEngine, nil
	case k == "integrations.pagerdutykey", k == "integrations.pagerduty_key":
		return maskIfSet(c.Integrations.PagerDutyKey), nil
	case k == "integrations.slackwebhook", k == "integrations.slack_webhook":
		return maskIfSet(c.Integrations.SlackWebhook), nil
	case k == "integrations.jiraurl", k == "integrations.jira_url":
		return c.Integrations.JiraURL, nil
	case k == "integrations.jiratoken", k == "integrations.jira_token":
		return maskIfSet(c.Integrations.JiraToken), nil
	case k == "integrations.jiraproject", k == "integrations.jira_project":
		return c.Integrations.JiraProject, nil
	case k == "integrations.opencostendpoint", k == "integrations.opencost_endpoint":
		return c.Integrations.OpenCostEndpoint, nil
	case k == "integrations.lokiendpoint", k == "integrations.loki_endpoint":
		return c.Integrations.LokiEndpoint, nil
	default:
		return nil, fmt.Errorf("unsupported key %q", key)
	}
}

// KeychainableKeys are config key paths that may be stored in the system keychain (P3-9).
var KeychainableKeys = map[string]struct{}{
	"ai.api_key": {}, "ai.apikey": {},
	"integrations.pagerdutykey": {}, "integrations.pagerduty_key": {},
	"integrations.slackwebhook": {}, "integrations.slack_webhook": {},
	"integrations.jiratoken": {}, "integrations.jira_token": {},
}

// AddKeychainKey adds the normalized key to KeychainKeys if keychainable and not already present.
func (c *Config) AddKeychainKey(key string) {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return
	}
	if _, ok := KeychainableKeys[k]; !ok {
		return
	}
	norm := NormalizeKeyForAccount(k)
	for _, existing := range c.KeychainKeys {
		if strings.ToLower(existing) == norm {
			return
		}
	}
	c.KeychainKeys = append(c.KeychainKeys, norm)
}

// NormalizeKeyForAccount returns a canonical form for keychain account (e.g. ai.api_key).
// Exported for CLI when building keychain account names.
func NormalizeKeyForAccount(k string) string {
	k = strings.ToLower(strings.TrimSpace(k))
	// Prefer dotted form for persistence
	switch k {
	case "ai.apikey":
		return "ai.api_key"
	case "integrations.pagerdutykey":
		return "integrations.pagerduty_key"
	case "integrations.slackwebhook":
		return "integrations.slack_webhook"
	case "integrations.jiratoken":
		return "integrations.jira_token"
	}
	return k
}

// resolveKeychain fills keychain-backed keys from the system keychain (called after Load).
func (c *Config) resolveKeychain(profileName string) {
	if !keychain.Available() {
		return
	}
	for _, key := range c.KeychainKeys {
		account := profileName + "." + key
		val, err := keychain.Get(keychain.Service, account)
		if err != nil || val == "" {
			continue
		}
		_ = c.SetByKey(key, val)
	}
}

// copyForSave returns a deep copy of the config with keychain-backed fields zeroed
// so that secrets are not written to the config file.
func (c *Config) copyForSave() *Config {
	cp := *c
	cp.Context.Groups = make(map[string][]string)
	for k, v := range c.Context.Groups {
		cp.Context.Groups[k] = append([]string(nil), v...)
	}
	cp.Shell.Aliases = make(map[string]string)
	for k, v := range c.Shell.Aliases {
		cp.Shell.Aliases[k] = v
	}
	cp.KeychainKeys = append([]string(nil), c.KeychainKeys...)
	cp.AI = c.AI
	cp.Integrations = c.Integrations
	for _, key := range cp.KeychainKeys {
		zeroKeychainKey(&cp, key)
	}
	return &cp
}

func zeroKeychainKey(c *Config, key string) {
	k := strings.ToLower(strings.TrimSpace(key))
	switch k {
	case "ai.api_key", "ai.apikey":
		c.AI.APIKey = ""
	case "integrations.pagerduty_key", "integrations.pagerdutykey":
		c.Integrations.PagerDutyKey = ""
	case "integrations.slack_webhook", "integrations.slackwebhook":
		c.Integrations.SlackWebhook = ""
	case "integrations.jira_token", "integrations.jiratoken":
		c.Integrations.JiraToken = ""
	}
}

// Redacted returns a copy of the config with sensitive fields masked for display.
// AI.APIKey is replaced by "***" when non-empty to avoid leaking secrets in config view.
func (c *Config) Redacted() *Config {
	if c == nil {
		return nil
	}
	cp := *c
	cp.AI = c.AI
	cp.AI.APIKey = maskIfSet(c.AI.APIKey)
	return &cp
}

func maskIfSet(s string) string {
	if strings.TrimSpace(s) == "" {
		return s
	}
	return "***"
}

func (c *Config) ToYAML() (string, error) {
	b, err := yaml.Marshal(c)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (c *Config) ToJSON() (string, error) {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func AllowedThemeNames() []string {
	out := make([]string, 0, len(allowedThemes))
	for k := range allowedThemes {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (c *Config) normalize() {
	if c.Context.Groups == nil {
		c.Context.Groups = map[string][]string{}
	}
	if c.Shell.Aliases == nil {
		c.Shell.Aliases = map[string]string{}
	}
	c.General.Theme = strings.ToLower(strings.TrimSpace(c.General.Theme))
	c.TUI.Theme = strings.ToLower(strings.TrimSpace(c.TUI.Theme))
	c.General.StartupTimeBudget = strings.TrimSpace(c.General.StartupTimeBudget)
	c.TUI.RefreshInterval = strings.TrimSpace(c.TUI.RefreshInterval)
	c.Performance.CacheTTL = strings.TrimSpace(c.Performance.CacheTTL)
	c.Shell.PromptFormat = strings.TrimSpace(c.Shell.PromptFormat)
	c.AI.Provider = strings.ToLower(strings.TrimSpace(c.AI.Provider))
	c.AI.Model = strings.TrimSpace(c.AI.Model)
	c.AI.Endpoint = strings.TrimSpace(c.AI.Endpoint)
	c.AI.APIKey = strings.TrimSpace(c.AI.APIKey)
	c.Context.Favorites = dedupeTrimmed(c.Context.Favorites)
	for name, members := range c.Context.Groups {
		cleanName := strings.TrimSpace(name)
		if cleanName == "" {
			delete(c.Context.Groups, name)
			continue
		}
		if cleanName != name {
			delete(c.Context.Groups, name)
		}
		c.Context.Groups[cleanName] = dedupeTrimmed(members)
	}
}

func parseCSV(v string) []string {
	if strings.TrimSpace(v) == "" {
		return []string{}
	}
	parts := strings.Split(v, ",")
	return dedupeTrimmed(parts)
}

func dedupeTrimmed(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func validateTheme(v, key string) error {
	v = strings.ToLower(strings.TrimSpace(v))
	if _, ok := allowedThemes[v]; !ok {
		return fmt.Errorf("%s must be one of: %s", key, strings.Join(AllowedThemeNames(), ", "))
	}
	return nil
}

func parsePositiveDuration(v, key string) (time.Duration, error) {
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid duration: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be > 0", key)
	}
	return d, nil
}

func validateStringSlice(values []string, key string) error {
	for _, v := range values {
		if strings.TrimSpace(v) == "" {
			return fmt.Errorf("%s contains empty values", key)
		}
	}
	return nil
}
