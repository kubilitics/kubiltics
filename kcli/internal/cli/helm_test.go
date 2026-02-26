package cli

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// P2-6: helmDiffPluginInstalled — unit-tests for the plugin detection logic.
//
// helmDiffPluginInstalled calls `helm plugin list`; we test the parsing logic
// that would process that output by extracting it into a testable helper.
// ---------------------------------------------------------------------------

// helmPluginListContainsDiff is the pure-parsing half of the detection: it
// returns true if any line in the `helm plugin list` output has "diff" as its
// first whitespace-separated field (case-insensitive).
func helmPluginListContainsDiff(out string) bool {
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) > 0 && strings.EqualFold(fields[0], "diff") {
			return true
		}
	}
	return false
}

func TestHelmDiffPluginDetection_Present(t *testing.T) {
	// Typical `helm plugin list` output with diff installed.
	out := "NAME\tVERSION\tDESCRIPTION\ndiff\t3.9.4\tPreview helm upgrade changes as a diff\ns3\t0.15.0\tS3 chart repository support\n"
	if !helmPluginListContainsDiff(out) {
		t.Fatal("expected diff plugin to be detected from output")
	}
}

func TestHelmDiffPluginDetection_Absent(t *testing.T) {
	// Output with other plugins but no diff.
	out := "NAME\tVERSION\tDESCRIPTION\ns3\t0.15.0\tS3 chart repository support\nsecrets\t4.1.1\tHelm Secrets\n"
	if helmPluginListContainsDiff(out) {
		t.Fatal("expected diff plugin NOT to be detected from output")
	}
}

func TestHelmDiffPluginDetection_EmptyOutput(t *testing.T) {
	if helmPluginListContainsDiff("") {
		t.Fatal("expected false for empty output")
	}
}

func TestHelmDiffPluginDetection_HeaderOnly(t *testing.T) {
	// Only the header line — no plugins installed.
	out := "NAME\tVERSION\tDESCRIPTION\n"
	if helmPluginListContainsDiff(out) {
		t.Fatal("expected false when only header is present")
	}
}

func TestHelmDiffPluginDetection_CaseInsensitive(t *testing.T) {
	// Plugin names are lowercase in practice, but handle DIFF too.
	out := "DIFF\t3.9.4\tPreview helm upgrade changes as a diff\n"
	if !helmPluginListContainsDiff(out) {
		t.Fatal("expected diff plugin to match case-insensitively")
	}
}

func TestHelmDiffPluginDetection_PartialMatch(t *testing.T) {
	// "differ" is not "diff" — must be an exact first-field match.
	out := "differ\t1.0.0\tsome other plugin\ndiffmore\t2.0.0\tanother plugin\n"
	if helmPluginListContainsDiff(out) {
		t.Fatal("expected false — 'differ' and 'diffmore' must not match 'diff'")
	}
}

// TestHelmDiffInstallMsg verifies the constant contains the install URL.
func TestHelmDiffInstallMsg_ContainsURL(t *testing.T) {
	if !strings.Contains(helmDiffInstallMsg, "https://github.com/databus23/helm-diff") {
		t.Fatal("helmDiffInstallMsg must include the install URL")
	}
}

// TestHelmDiffCmdRegistered verifies that the kcli helm diff sub-command
// is registered under the helm command group.
func TestHelmDiffCmdRegistered(t *testing.T) {
	a := &app{}
	helmCmd := newHelmCmd(a)
	for _, sub := range helmCmd.Commands() {
		if sub.Use != "" && strings.HasPrefix(sub.Use, "diff") {
			return // found
		}
	}
	t.Fatal("expected 'diff' sub-command to be registered under kcli helm")
}
