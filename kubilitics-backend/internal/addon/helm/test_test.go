package helm

import (
	"testing"

	"github.com/stretchr/testify/assert"
	helmrelease "helm.sh/helm/v3/pkg/release"
)

func TestIsTestHook(t *testing.T) {
	hookWithTest := &helmrelease.Hook{
		Events: []helmrelease.HookEvent{helmrelease.HookTest},
	}
	assert.True(t, isTestHook(hookWithTest))

	hookWithoutTest := &helmrelease.Hook{
		Events: []helmrelease.HookEvent{helmrelease.HookPreInstall, helmrelease.HookPostInstall},
	}
	assert.False(t, isTestHook(hookWithoutTest))

	hookEmptyEvents := &helmrelease.Hook{
		Events: []helmrelease.HookEvent{},
	}
	assert.False(t, isTestHook(hookEmptyEvents))
}

func TestExtractHookLogs(t *testing.T) {
	logs := `some noise before
POD LOGS: my-test-pod-1
This is the log for my-test-pod-1
It has multiple lines
POD LOGS: my-test-pod-2
This is the log for my-test-pod-2
`

	extracted1 := extractHookLogs(logs, "my-test-pod-1")
	assert.Contains(t, extracted1, "This is the log for my-test-pod-1")
	assert.Contains(t, extracted1, "It has multiple lines")
	assert.NotContains(t, extracted1, "POD LOGS: my-test-pod-2")

	extracted2 := extractHookLogs(logs, "my-test-pod-2")
	assert.Contains(t, extracted2, "This is the log for my-test-pod-2")
	assert.NotContains(t, extracted2, "POD LOGS: my-test-pod-1")

	extractedMissing := extractHookLogs(logs, "non-existent-pod")
	assert.Equal(t, "", extractedMissing)
}
