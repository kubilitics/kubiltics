package plugin

// ---------------------------------------------------------------------------
// P2-3: Plugin execution audit log
//
// Every plugin execution appends one JSON object to ~/.kcli/audit.jsonl.
// The log is append-only (O_APPEND | O_CREATE) and human-readable — one
// JSON line per invocation, making it easy to process with jq, grep, etc.
//
// Log entry format (one compact JSON line per execution):
//
//	{"ts":"2026-02-22T14:30:00Z","type":"plugin","name":"argocd",
//	 "args":["app","sync"],"exit":0,"duration_ms":1200,"sandbox":"darwin"}
//
// The log is queried by `kcli audit plugins` (see cli/audit.go).
// ---------------------------------------------------------------------------

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// PluginAuditEntry is the JSON record written to ~/.kcli/audit.jsonl for
// every plugin execution.
type PluginAuditEntry struct {
	// TS is the RFC3339 UTC timestamp when the plugin execution completed.
	TS string `json:"ts"`
	// Type is always "plugin" — allows mixing entry types in the same file
	// in future (e.g. "install", "verify").
	Type string `json:"type"`
	// Name is the plugin name (without the kcli- prefix).
	Name string `json:"name"`
	// Args are the arguments passed to the plugin binary.  May be empty.
	Args []string `json:"args"`
	// ExitCode is the process exit code.  0 = success.
	ExitCode int `json:"exit"`
	// DurationMS is the wall-clock execution time in milliseconds.
	DurationMS int64 `json:"duration_ms"`
	// Sandbox is the OS sandbox platform applied ("darwin", "linux", "other",
	// or "none" when sandboxing was unavailable).
	Sandbox string `json:"sandbox,omitempty"`
}

// pluginAuditLogPath returns the path to the plugin audit JSONL file.
// Overridden by KCLI_PLUGIN_AUDIT_LOG for testing.
func pluginAuditLogPath() (string, error) {
	if p := os.Getenv("KCLI_PLUGIN_AUDIT_LOG"); p != "" {
		return p, nil
	}
	home, err := kcliHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "audit.jsonl"), nil
}

// AppendPluginAuditEntry appends a single JSON line to the plugin audit log.
// It is safe to call concurrently — writes use O_APPEND which is atomic on
// POSIX for writes smaller than PIPE_BUF (~4 KB; a JSON audit line is <1 KB).
//
// Logging failures are silently swallowed so that a broken or full disk does
// not prevent plugin execution.
func AppendPluginAuditEntry(entry PluginAuditEntry) {
	_ = appendPluginAuditEntry(entry)
}

func appendPluginAuditEntry(entry PluginAuditEntry) error {
	path, err := pluginAuditLogPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(line)
	return err
}

// ReadPluginAuditLog reads and parses all entries from the plugin audit JSONL
// file.  Invalid lines are skipped so that a corrupted log does not cause an
// error.  Returns an empty slice when the file does not exist.
func ReadPluginAuditLog() ([]PluginAuditEntry, error) {
	path, err := pluginAuditLogPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []PluginAuditEntry{}, nil
		}
		return nil, err
	}
	var entries []PluginAuditEntry
	for _, line := range splitLines(data) {
		if len(line) == 0 {
			continue
		}
		var e PluginAuditEntry
		if err := json.Unmarshal(line, &e); err == nil {
			entries = append(entries, e)
		}
	}
	return entries, nil
}

// splitLines splits b at newline boundaries, returning non-empty byte slices.
func splitLines(b []byte) [][]byte {
	var out [][]byte
	start := 0
	for i, c := range b {
		if c == '\n' {
			if i > start {
				out = append(out, b[start:i])
			}
			start = i + 1
		}
	}
	if start < len(b) {
		out = append(out, b[start:])
	}
	return out
}

// newPluginAuditEntry creates an audit entry for a completed plugin invocation.
func newPluginAuditEntry(name string, args []string, exitCode int, start time.Time, profile SandboxProfile) PluginAuditEntry {
	sandbox := profile.Platform
	if !profile.Available {
		sandbox = "none"
	}
	return PluginAuditEntry{
		TS:         time.Now().UTC().Format(time.RFC3339),
		Type:       "plugin",
		Name:       name,
		Args:       args,
		ExitCode:   exitCode,
		DurationMS: time.Since(start).Milliseconds(),
		Sandbox:    sandbox,
	}
}
