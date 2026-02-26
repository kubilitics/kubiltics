package config

import (
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
