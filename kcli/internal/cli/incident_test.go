package cli

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
)

func TestParseNamespacedPod(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		ns, pod, err := parseNamespacedPod("team-a/api-7f9d")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ns != "team-a" || pod != "api-7f9d" {
			t.Fatalf("unexpected parse result: ns=%q pod=%q", ns, pod)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		if _, _, err := parseNamespacedPod("api-7f9d"); err == nil {
			t.Fatal("expected error for missing namespace")
		}
	})
}

func TestIncidentIncludesQuickActionSubcommands(t *testing.T) {
	cmd := newIncidentCmd(&app{})
	names := map[string]bool{}
	for _, c := range cmd.Commands() {
		names[c.Name()] = true
	}
	for _, want := range []string{"logs", "describe", "restart", "export"} {
		if !names[want] {
			t.Fatalf("missing incident subcommand %q", want)
		}
	}
}

func TestIncidentExportCmdFlags(t *testing.T) {
	cmd := newIncidentCmd(&app{})
	var exportCmd *cobra.Command
	for _, c := range cmd.Commands() {
		if c.Name() == "export" {
			exportCmd = c
			break
		}
	}
	if exportCmd == nil {
		t.Fatal("incident export subcommand not found")
	}
	for _, flag := range []string{"since", "output", "with-logs"} {
		if exportCmd.Flags().Lookup(flag) == nil {
			t.Errorf("incident export missing flag %q", flag)
		}
	}
}

// ---------------------------------------------------------------------------
// P1-3: --watch, --interval, --no-clear flag tests
// ---------------------------------------------------------------------------

func TestIncidentWatchFlags(t *testing.T) {
	cmd := newIncidentCmd(&app{})

	// --watch flag must exist.
	if cmd.Flags().Lookup("watch") == nil {
		t.Fatal("missing --watch flag on incident command")
	}
	// --interval flag must exist (primary; --refresh is hidden alias).
	if cmd.Flags().Lookup("interval") == nil {
		t.Fatal("missing --interval flag on incident command")
	}
	// --no-clear flag must exist.
	if cmd.Flags().Lookup("no-clear") == nil {
		t.Fatal("missing --no-clear flag on incident command")
	}
}

func TestIncidentWatchDefaultInterval(t *testing.T) {
	cmd := newIncidentCmd(&app{})
	f := cmd.Flags().Lookup("interval")
	if f == nil {
		t.Fatal("missing --interval flag")
	}
	// Default must be 5s.
	if f.DefValue != "5s" {
		t.Errorf("expected default interval=5s, got %q", f.DefValue)
	}
}

func TestIncidentWatchContextCancellation(t *testing.T) {
	// Verify the watch loop exits within a reasonable time when ctx is cancelled.
	// We use a no-op app so buildIncidentReport will fail fast (no kubectl), which
	// exercises the context cancellation path.
	ctx, cancel := context.WithCancel(context.Background())

	a := &app{}
	cmd := newIncidentCmd(a)
	cmd.SetContext(ctx)

	// Cancel after 50ms to exercise the SIGINT exit path.
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	// Run with --watch; expect it to return nil (clean exit) after context cancel.
	done := make(chan error, 1)
	go func() {
		_ = cmd.Flags().Set("watch", "true")
		_ = cmd.Flags().Set("interval", "10ms") // very fast for test speed
		done <- cmd.RunE(cmd, nil)
	}()

	select {
	case err := <-done:
		// buildIncidentReport may fail (no kubectl in CI), but the watch should
		// return the first error from render() and NOT hang.
		// Either nil (SIGINT clean exit) or an error from the render are both
		// acceptable — the important thing is it doesn't block forever.
		_ = err
	case <-time.After(2 * time.Second):
		t.Fatal("incident --watch did not exit within 2s after context cancellation")
	}
}

func TestIncidentNoClearFlagDefaultsFalse(t *testing.T) {
	cmd := newIncidentCmd(&app{})
	f := cmd.Flags().Lookup("no-clear")
	if f == nil {
		t.Fatal("missing --no-clear flag")
	}
	if f.DefValue != "false" {
		t.Errorf("expected default no-clear=false, got %q", f.DefValue)
	}
}

func TestIncidentRefreshAliasHidden(t *testing.T) {
	// --refresh is kept as a hidden alias for backward compat.
	cmd := newIncidentCmd(&app{})
	f := cmd.Flags().Lookup("refresh")
	if f == nil {
		t.Fatal("missing --refresh flag (backward compat alias)")
	}
	// It should be hidden.
	if !f.Hidden {
		t.Error("--refresh flag should be hidden (deprecated alias for --interval)")
	}
}

func TestWriteTarballCreatesValidArchive(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(`{"exportedAt":"2026-01-01T00:00:00Z"}`), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "report.json"), []byte(`{"crashLoopBackOff":[]}`), 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}
	dest := filepath.Join(t.TempDir(), "bundle.tar.gz")
	if err := writeTarball(dest, dir); err != nil {
		t.Fatalf("writeTarball: %v", err)
	}
	f, err := os.Open(dest)
	if err != nil {
		t.Fatalf("open tarball: %v", err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var names []string
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar next: %v", err)
		}
		names = append(names, h.Name)
	}
	want := []string{"incident-bundle/index.json", "incident-bundle/report.json"}
	for _, w := range want {
		found := false
		for _, n := range names {
			if n == w {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("tarball missing %q; got: %s", w, strings.Join(names, ", "))
		}
	}
}
