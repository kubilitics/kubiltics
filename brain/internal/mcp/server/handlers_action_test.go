package server

import (
	"testing"
)

func TestActionTools_NotRegisteredInLLMServer(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	if err := s.registerAllTools(); err != nil {
		t.Fatalf("registerAllTools failed: %v", err)
	}

	actionTools := []string{
		"action_restart_workload",
		"action_apply_manifest",
		"action_rollback_deployment",
		"action_execute_command",
	}
	for _, name := range actionTools {
		if _, found := s.tools[name]; found {
			t.Errorf("tool %q must NOT be registered in the LLM tool list — use restart_pod / scale_deployment / rollback_deployment (execution tools) instead", name)
		}
	}
}

func TestExecutionToolsStillPresent(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	s := newTestServer(t, fb.server.URL)
	if err := s.registerAllTools(); err != nil {
		t.Fatalf("registerAllTools failed: %v", err)
	}

	executionTools := []string{"restart_pod", "scale_deployment", "rollback_deployment"}
	for _, name := range executionTools {
		if _, found := s.tools[name]; !found {
			t.Errorf("execution tool %q must be registered", name)
		}
	}
}
