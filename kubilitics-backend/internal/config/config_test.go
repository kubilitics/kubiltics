package config

import (
	"os"
	"strings"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Clear environment variables
	os.Clearenv()
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	if cfg == nil {
		t.Fatal("Config should not be nil")
	}
	
	// Check defaults
	if cfg.Port != 819 {
		t.Errorf("Expected default port 819, got %d", cfg.Port)
	}
	if cfg.DatabasePath != "./kubilitics.db" {
		t.Errorf("Expected default database path './kubilitics.db', got %s", cfg.DatabasePath)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("Expected default log level 'info', got %s", cfg.LogLevel)
	}
	if cfg.LogFormat != "json" {
		t.Errorf("Expected default log format 'json', got %s", cfg.LogFormat)
	}
	if cfg.AuthMode != "disabled" {
		t.Errorf("Expected default auth mode 'disabled', got %s", cfg.AuthMode)
	}
	if cfg.TLSEnabled {
		t.Error("Expected default TLS to be disabled")
	}
}

func TestLoad_EnvironmentVariables(t *testing.T) {
	// Set environment variables
	os.Setenv("KUBILITICS_PORT", "9000")
	os.Setenv("KUBILITICS_DATABASE_PATH", "/tmp/test.db")
	os.Setenv("KUBILITICS_LOG_LEVEL", "debug")
	os.Setenv("KUBILITICS_AUTH_MODE", "required")
	defer func() {
		os.Unsetenv("KUBILITICS_PORT")
		os.Unsetenv("KUBILITICS_DATABASE_PATH")
		os.Unsetenv("KUBILITICS_LOG_LEVEL")
		os.Unsetenv("KUBILITICS_AUTH_MODE")
	}()
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	
	if cfg.Port != 9000 {
		t.Errorf("Expected port 9000 from env, got %d", cfg.Port)
	}
	if cfg.DatabasePath != "/tmp/test.db" {
		t.Errorf("Expected database path '/tmp/test.db' from env, got %s", cfg.DatabasePath)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("Expected log level 'debug' from env, got %s", cfg.LogLevel)
	}
	if cfg.AuthMode != "required" {
		t.Errorf("Expected auth mode 'required' from env, got %s", cfg.AuthMode)
	}
}

func TestLoad_AllowedOriginsCommaSeparated(t *testing.T) {
	os.Setenv("KUBILITICS_ALLOWED_ORIGINS", "http://localhost:3000,https://example.com,http://localhost:5173")
	defer os.Unsetenv("KUBILITICS_ALLOWED_ORIGINS")
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	
	// Should have 3 user-specified origins plus 2 tauri origins appended (5 total)
	if len(cfg.AllowedOrigins) != 5 {
		t.Errorf("Expected 5 allowed origins (3 user + 2 tauri), got %d: %v", len(cfg.AllowedOrigins), cfg.AllowedOrigins)
	}
	
	// Verify user-specified origins are present
	expectedOrigins := map[string]bool{
		"http://localhost:3000": false,
		"https://example.com":   false,
		"http://localhost:5173": false,
	}
	for _, origin := range cfg.AllowedOrigins {
		if _, exists := expectedOrigins[origin]; exists {
			expectedOrigins[origin] = true
		}
	}
	for origin, found := range expectedOrigins {
		if !found {
			t.Errorf("Expected origin %q not found in allowed origins: %v", origin, cfg.AllowedOrigins)
		}
	}
	
	// Verify tauri origins are appended
	hasTauriLocalhost := false
	hasTauri := false
	for _, origin := range cfg.AllowedOrigins {
		if origin == "tauri://localhost" {
			hasTauriLocalhost = true
		}
		if origin == "tauri://" {
			hasTauri = true
		}
	}
	if !hasTauriLocalhost {
		t.Error("Expected 'tauri://localhost' to be appended to allowed origins")
	}
	if !hasTauri {
		t.Error("Expected 'tauri://' to be appended to allowed origins")
	}
}

func TestLoad_AllowedOriginsCommaSeparatedWithWhitespace(t *testing.T) {
	// BA-5: Verify whitespace handling in KUBILITICS_ALLOWED_ORIGINS
	os.Setenv("KUBILITICS_ALLOWED_ORIGINS", " http://localhost:3000 , https://example.com , http://localhost:5173 ")
	defer os.Unsetenv("KUBILITICS_ALLOWED_ORIGINS")
	
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}
	
	// Should have 3 origins (whitespace trimmed) plus tauri origins appended
	if len(cfg.AllowedOrigins) < 3 {
		t.Errorf("Expected at least 3 allowed origins, got %d", len(cfg.AllowedOrigins))
	}
	
	// Verify whitespace was trimmed
	found := false
	for _, origin := range cfg.AllowedOrigins {
		if origin == "http://localhost:3000" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected 'http://localhost:3000' (whitespace trimmed) in allowed origins, got %v", cfg.AllowedOrigins)
	}
	
	// Verify no origins have leading/trailing whitespace
	for _, origin := range cfg.AllowedOrigins {
		if origin != strings.TrimSpace(origin) {
			t.Errorf("Origin has unexpected whitespace: %q", origin)
		}
	}
}

func TestLoad_MissingConfigFile(t *testing.T) {
	// Clear environment and use non-existent config file
	os.Clearenv()
	
	cfg, err := Load()
	// Should not error even if config file doesn't exist
	if err != nil {
		t.Fatalf("Load should not error when config file is missing: %v", err)
	}
	if cfg == nil {
		t.Fatal("Config should not be nil even without config file")
	}
}
