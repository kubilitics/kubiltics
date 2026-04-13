package otel

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// embeddedChart is the kubilitics-otel Helm chart compiled into the backend
// binary at build time. This is what makes the desktop sidecar self-contained:
// the chart ships alongside the code and works regardless of where the binary
// is spawned from, or whether the repo is even checked out on the machine.
//
// The source files live at kubilitics-backend/internal/otel/chart/, which is
// a verbatim copy of the top-level charts/kubilitics-otel/ directory. A
// pre-commit/CI check should keep them in sync (see the charts-sync Makefile
// target or the publish workflow).
//
//go:embed all:chart
var embeddedChart embed.FS

var (
	extractedChartPathOnce sync.Once
	extractedChartPath     string
	extractedChartErr      error
)

// ExtractedChartPath returns a filesystem path where the embedded chart has
// been materialized. On first call it extracts the embedded chart to a
// dedicated subdirectory under os.TempDir(), then returns that path on every
// subsequent call (no re-extraction). The extracted directory persists for
// the lifetime of the process — Helm needs a real filesystem path to
// `helm template`, so we can't feed it fs.FS directly.
func ExtractedChartPath() (string, error) {
	extractedChartPathOnce.Do(func() {
		dir, err := os.MkdirTemp("", "kubilitics-otel-chart-")
		if err != nil {
			extractedChartErr = fmt.Errorf("create temp dir for embedded chart: %w", err)
			return
		}
		target := filepath.Join(dir, "kubilitics-otel")
		if err := extractFS(embeddedChart, "chart", target); err != nil {
			extractedChartErr = fmt.Errorf("extract embedded chart: %w", err)
			return
		}
		extractedChartPath = target
	})
	return extractedChartPath, extractedChartErr
}

// extractFS copies every file under srcDir in an embed.FS into dstDir on the
// real filesystem. Directories are created with 0755, files with 0644.
func extractFS(src embed.FS, srcDir, dstDir string) error {
	return fs.WalkDir(src, srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// Compute the path relative to srcDir so Chart.yaml lands at the root
		// of dstDir (not at dstDir/chart/Chart.yaml).
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(dstDir, 0o755)
		}
		out := filepath.Join(dstDir, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		data, err := src.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read embedded %s: %w", path, err)
		}
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return err
		}
		return os.WriteFile(out, data, 0o644)
	})
}
