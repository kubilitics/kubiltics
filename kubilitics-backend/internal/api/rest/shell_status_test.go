package rest

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadKCLIAIEnabledFromConfig(t *testing.T) {
	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)
	t.Setenv("KCLI_AI_PROVIDER", "")
	t.Setenv("KCLI_AI_ENDPOINT", "")
	t.Setenv("KCLI_OPENAI_API_KEY", "")
	t.Setenv("KCLI_ANTHROPIC_API_KEY", "")
	t.Setenv("KCLI_AZURE_OPENAI_API_KEY", "")
	t.Setenv("KCLI_OLLAMA_ENDPOINT", "")

	kcliDir := filepath.Join(tempHome, ".kcli")
	if err := os.MkdirAll(kcliDir, 0o755); err != nil {
		t.Fatalf("mkdir .kcli: %v", err)
	}

	t.Run("enabled true", func(t *testing.T) {
		content := "ai:\n  enabled: true\n"
		if err := os.WriteFile(filepath.Join(kcliDir, "config.yaml"), []byte(content), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		if got := isAIEnabled(); !got {
			t.Fatalf("isAIEnabled() = false, want true")
		}
	})

	t.Run("provider only", func(t *testing.T) {
		content := "ai:\n  enabled: false\n  provider: openai\n"
		if err := os.WriteFile(filepath.Join(kcliDir, "config.yaml"), []byte(content), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		if got := isAIEnabled(); !got {
			t.Fatalf("isAIEnabled() = false, want true")
		}
	})

	t.Run("disabled config", func(t *testing.T) {
		content := "ai:\n  enabled: false\n"
		if err := os.WriteFile(filepath.Join(kcliDir, "config.yaml"), []byte(content), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		if got := isAIEnabled(); got {
			t.Fatalf("isAIEnabled() = true, want false")
		}
	})
}
