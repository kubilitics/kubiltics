package types

import (
	"os"
	"testing"
)

func TestDefaultAgentConfig_MaxTurnsIs20(t *testing.T) {
	// Regression: 10 was too low for prompts that iterate namespace-by-namespace
	// (e.g. "list all the pods"). The bench hit "agentic loop exceeded max
	// turns (10) without final answer" in 14 of 250 runs on Apr 21.
	if got := DefaultAgentConfig().MaxTurns; got != 20 {
		t.Fatalf("DefaultAgentConfig().MaxTurns = %d, want 20", got)
	}
}

func TestDefaultAgentConfig_MaxTurnsRespectsEnv(t *testing.T) {
	t.Setenv("KOTG_AGENT_MAX_TURNS", "7")
	if got := DefaultAgentConfig().MaxTurns; got != 7 {
		t.Fatalf("env override not honored: got %d", got)
	}
}

func TestDefaultAgentConfig_MaxTurnsBadEnvFallsBackToDefault(t *testing.T) {
	t.Setenv("KOTG_AGENT_MAX_TURNS", "not-a-number")
	if got := DefaultAgentConfig().MaxTurns; got != 20 {
		t.Fatalf("bad env should fall back to 20, got %d", got)
	}
	_ = os.Unsetenv("KOTG_AGENT_MAX_TURNS")
}

func TestAgentStreamEvent_TokenUsageFieldExists(t *testing.T) {
	ev := AgentStreamEvent{
		TokenUsage: &TokenUsage{
			PromptTokens:     100,
			CompletionTokens: 25,
		},
	}
	if ev.TokenUsage == nil {
		t.Fatalf("TokenUsage must be a pointer field so nil means 'not known'")
	}
	if ev.TokenUsage.PromptTokens != 100 || ev.TokenUsage.CompletionTokens != 25 {
		t.Fatalf("fields not stored correctly: %+v", ev.TokenUsage)
	}
}
