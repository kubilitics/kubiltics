package config

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestNewConfigManager_HonorsConfigPath proves that NewConfigManager(path) +
// Load actually reads the YAML at the supplied path (i.e. the cmd/server
// `-config <path>` flag is honored end-to-end). Regression test for the
// suspected "config flag silently ignored" bug.
func TestNewConfigManager_HonorsConfigPath(t *testing.T) {
	// Make sure no stray env vars from the host or previous tests override
	// what we write into the YAML.
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("KUBILITICS_PORT", "")

	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "kubilitics-ai.yaml")
	yaml := []byte(`
server:
  port: 9991
llm:
  provider: openai
  openai:
    api_key: "sk-from-yaml"
    model: "gpt-4o-mini"
`)
	require.NoError(t, os.WriteFile(cfgPath, yaml, 0o600))

	mgr, err := NewConfigManager(cfgPath)
	require.NoError(t, err)
	require.NoError(t, mgr.Load(context.Background()))

	cfg := mgr.Get(context.Background())
	require.NotNil(t, cfg)

	// Provider override from YAML must win over the baked-in "anthropic" default.
	require.Equal(t, "openai", cfg.LLM.Provider,
		"-config flag should be honored: expected provider from YAML, got default")
	require.Equal(t, 9991, cfg.Server.Port,
		"-config flag should be honored: expected port from YAML")
	require.NotNil(t, cfg.LLM.OpenAI)
	require.Equal(t, "sk-from-yaml", cfg.LLM.OpenAI["api_key"])
	require.Equal(t, "gpt-4o-mini", cfg.LLM.OpenAI["model"])
}
