package helm

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	helmrelease "helm.sh/helm/v3/pkg/release"
)

// Test runs helm test for the given release using the Helm SDK ReleaseTesting action.
// It collects per-hook pass/fail status and captures pod log output for failed hooks.
// The context is used for the caller's cancellation deadline; the actual test execution
// timeout is controlled by the timeout parameter via action.ReleaseTesting.Timeout.
func (c *helmClientImpl) Test(ctx context.Context, releaseName, namespace string, timeout time.Duration) (*TestResult, error) {
	_ = ctx // ReleaseTesting.Run does not accept context; timeout is set via .Timeout
	cfg, err := c.newActionConfig(namespace)
	if err != nil {
		return nil, fmt.Errorf("helm test action config: %w", err)
	}

	client := action.NewReleaseTesting(cfg)
	client.Timeout = timeout
	client.Namespace = namespace

	// Run executes all hooks with annotation helm.sh/hook: test and waits up to Timeout.
	// On partial failure (some hooks fail) it may return both a non-nil Release and a non-nil error.
	rel, runErr := client.Run(releaseName)
	if runErr != nil && rel == nil {
		return nil, fmt.Errorf("helm test %s: %w", releaseName, runErr)
	}

	result := &TestResult{Passed: runErr == nil}

	if rel != nil {
		// Collect pod logs from all test hooks (best-effort; ignore streaming errors).
		var logBuf bytes.Buffer
		_ = client.GetPodLogs(&logBuf, rel)
		logOutput := logBuf.String()

		for _, hook := range rel.Hooks {
			if !isTestHook(hook) {
				continue
			}
			phase := hook.LastRun.Phase
			suite := TestSuite{
				Name:   hook.Name,
				Status: string(phase),
				Info:   extractHookLogs(logOutput, hook.Name),
			}
			result.Tests = append(result.Tests, suite)
		}
	}

	return result, nil
}

// isTestHook returns true when the hook carries the HookTest event annotation.
func isTestHook(hook *helmrelease.Hook) bool {
	for _, ev := range hook.Events {
		if ev == helmrelease.HookTest {
			return true
		}
	}
	return false
}

// extractHookLogs extracts the log section for a specific test pod from the combined
// log buffer produced by ReleaseTesting.GetPodLogs. Returns an empty string when no
// logs are found for the given pod name.
func extractHookLogs(allLogs, podName string) string {
	marker := fmt.Sprintf("POD LOGS: %s\n", podName)
	idx := strings.Index(allLogs, marker)
	if idx < 0 {
		return ""
	}
	remainder := allLogs[idx+len(marker):]
	// Trim at the next pod section header.
	if nextIdx := strings.Index(remainder, "POD LOGS:"); nextIdx >= 0 {
		return strings.TrimSpace(remainder[:nextIdx])
	}
	return strings.TrimSpace(remainder)
}
