package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func setupAuditHome(t *testing.T) string {
	t.Helper()
	home := setupPluginHome(t) // sets KCLI_HOME_DIR
	// Route the audit log to a temp file via env var.
	auditPath := filepath.Join(home, "audit.jsonl")
	t.Setenv("KCLI_PLUGIN_AUDIT_LOG", auditPath)
	return auditPath
}

// ---------------------------------------------------------------------------
// appendPluginAuditEntry
// ---------------------------------------------------------------------------

func TestAppendPluginAuditEntry_CreatesFile(t *testing.T) {
	path := setupAuditHome(t)
	entry := PluginAuditEntry{
		TS:         time.Now().UTC().Format(time.RFC3339),
		Type:       "plugin",
		Name:       "myplugin",
		Args:       []string{"status"},
		ExitCode:   0,
		DurationMS: 123,
		Sandbox:    "darwin",
	}
	if err := appendPluginAuditEntry(entry); err != nil {
		t.Fatalf("appendPluginAuditEntry: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected audit log file to be created: %v", err)
	}
}

func TestAppendPluginAuditEntry_AppendsJSONL(t *testing.T) {
	path := setupAuditHome(t)
	entries := []PluginAuditEntry{
		{TS: "2026-01-01T00:00:00Z", Type: "plugin", Name: "alpha", Args: []string{"a"}, ExitCode: 0, DurationMS: 10},
		{TS: "2026-01-01T00:01:00Z", Type: "plugin", Name: "beta", Args: []string{"b"}, ExitCode: 1, DurationMS: 20},
	}
	for _, e := range entries {
		if err := appendPluginAuditEntry(e); err != nil {
			t.Fatalf("append: %v", err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 JSONL lines, got %d:\n%s", len(lines), string(data))
	}
	var e1, e2 PluginAuditEntry
	if err := json.Unmarshal([]byte(lines[0]), &e1); err != nil {
		t.Fatalf("parse line 0: %v", err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &e2); err != nil {
		t.Fatalf("parse line 1: %v", err)
	}
	if e1.Name != "alpha" {
		t.Fatalf("expected first entry name 'alpha', got %q", e1.Name)
	}
	if e2.Name != "beta" {
		t.Fatalf("expected second entry name 'beta', got %q", e2.Name)
	}
}

func TestAppendPluginAuditEntry_IsAppendOnly(t *testing.T) {
	path := setupAuditHome(t)
	e1 := PluginAuditEntry{TS: "2026-01-01T00:00:00Z", Type: "plugin", Name: "first", ExitCode: 0}
	e2 := PluginAuditEntry{TS: "2026-01-01T00:01:00Z", Type: "plugin", Name: "second", ExitCode: 0}

	if err := appendPluginAuditEntry(e1); err != nil {
		t.Fatalf("append e1: %v", err)
	}
	if err := appendPluginAuditEntry(e2); err != nil {
		t.Fatalf("append e2: %v", err)
	}

	data, _ := os.ReadFile(path)
	// Both entries must be present — file must not have been truncated.
	if !strings.Contains(string(data), "first") {
		t.Fatal("expected first entry still present after second append")
	}
	if !strings.Contains(string(data), "second") {
		t.Fatal("expected second entry present")
	}
}

// ---------------------------------------------------------------------------
// ReadPluginAuditLog
// ---------------------------------------------------------------------------

func TestReadPluginAuditLog_EmptyWhenNoFile(t *testing.T) {
	setupAuditHome(t)
	entries, err := ReadPluginAuditLog()
	if err != nil {
		t.Fatalf("expected no error for missing file, got: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected empty slice, got %d entries", len(entries))
	}
}

func TestReadPluginAuditLog_ReadsAllEntries(t *testing.T) {
	setupAuditHome(t)
	for i := 0; i < 5; i++ {
		_ = appendPluginAuditEntry(PluginAuditEntry{
			TS:       "2026-01-01T00:00:00Z",
			Type:     "plugin",
			Name:     "foo",
			ExitCode: 0,
		})
	}
	entries, err := ReadPluginAuditLog()
	if err != nil {
		t.Fatalf("ReadPluginAuditLog: %v", err)
	}
	if len(entries) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(entries))
	}
}

func TestReadPluginAuditLog_SkipsInvalidLines(t *testing.T) {
	path := setupAuditHome(t)
	// Write one valid and one invalid line.
	valid := PluginAuditEntry{TS: "2026-01-01T00:00:00Z", Type: "plugin", Name: "ok", ExitCode: 0}
	b, _ := json.Marshal(valid)
	content := string(b) + "\nnot-valid-json\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	entries, err := ReadPluginAuditLog()
	if err != nil {
		t.Fatalf("ReadPluginAuditLog: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 valid entry (bad line skipped), got %d", len(entries))
	}
	if entries[0].Name != "ok" {
		t.Fatalf("expected entry name 'ok', got %q", entries[0].Name)
	}
}

// ---------------------------------------------------------------------------
// newPluginAuditEntry
// ---------------------------------------------------------------------------

func TestNewPluginAuditEntry_Fields(t *testing.T) {
	m := makeManifest("myplugin", nil)
	profile := BuildSandboxProfile("myplugin", "/bin/kcli-myplugin", m)

	start := time.Now().Add(-500 * time.Millisecond)
	entry := newPluginAuditEntry("myplugin", []string{"status", "--verbose"}, 0, start, profile)

	if entry.Type != "plugin" {
		t.Fatalf("expected type 'plugin', got %q", entry.Type)
	}
	if entry.Name != "myplugin" {
		t.Fatalf("expected name 'myplugin', got %q", entry.Name)
	}
	if len(entry.Args) != 2 {
		t.Fatalf("expected 2 args, got %d", len(entry.Args))
	}
	if entry.ExitCode != 0 {
		t.Fatalf("expected exit 0, got %d", entry.ExitCode)
	}
	if entry.DurationMS < 450 {
		t.Fatalf("expected duration >= 450ms, got %dms", entry.DurationMS)
	}
	if entry.TS == "" {
		t.Fatal("expected non-empty TS")
	}
	// TS must be parseable as RFC3339.
	if _, err := time.Parse(time.RFC3339, entry.TS); err != nil {
		t.Fatalf("TS %q is not valid RFC3339: %v", entry.TS, err)
	}
}

func TestNewPluginAuditEntry_UnavailableSandbox_SandboxIsNone(t *testing.T) {
	profile := SandboxProfile{Available: false, Platform: "darwin"}
	entry := newPluginAuditEntry("myplugin", nil, 0, time.Now(), profile)
	if entry.Sandbox != "none" {
		t.Fatalf("expected sandbox 'none' when Available=false, got %q", entry.Sandbox)
	}
}

// ---------------------------------------------------------------------------
// splitLines
// ---------------------------------------------------------------------------

func TestSplitLines_Basic(t *testing.T) {
	b := []byte("line1\nline2\nline3\n")
	lines := splitLines(b)
	if len(lines) != 3 {
		t.Fatalf("expected 3 lines, got %d: %v", len(lines), lines)
	}
}

func TestSplitLines_NoTrailingNewline(t *testing.T) {
	b := []byte("line1\nline2")
	lines := splitLines(b)
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}
}

func TestSplitLines_Empty(t *testing.T) {
	if got := splitLines(nil); len(got) != 0 {
		t.Fatalf("expected 0 lines for nil input, got %d", len(got))
	}
}
