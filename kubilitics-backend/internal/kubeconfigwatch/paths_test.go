package kubeconfigwatch

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDefaultPaths_FallsBackToKubeDir(t *testing.T) {
	t.Setenv("KUBECONFIG", "")
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Create a fake ~/.kube/config so the existence filter lets it through
	kubeDir := filepath.Join(home, ".kube")
	if err := os.MkdirAll(kubeDir, 0o700); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	kubeConfig := filepath.Join(kubeDir, "config")
	if err := os.WriteFile(kubeConfig, []byte("apiVersion: v1\nkind: Config\n"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	paths := DefaultPaths()
	if len(paths) != 1 {
		t.Fatalf("expected 1 path, got %d: %v", len(paths), paths)
	}
	if paths[0] != kubeConfig {
		t.Errorf("paths[0]: got %q, want %q", paths[0], kubeConfig)
	}
}

func TestDefaultPaths_SplitsKubeconfigEnvVar(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	a := filepath.Join(home, "a.yaml")
	b := filepath.Join(home, "b.yaml")
	for _, p := range []string{a, b} {
		if err := os.WriteFile(p, []byte("apiVersion: v1\nkind: Config\n"), 0o600); err != nil {
			t.Fatalf("WriteFile %s: %v", p, err)
		}
	}

	sep := ":"
	if runtime.GOOS == "windows" {
		sep = ";"
	}
	t.Setenv("KUBECONFIG", a+sep+b)

	paths := DefaultPaths()
	if len(paths) != 2 {
		t.Fatalf("expected 2 paths, got %d: %v", len(paths), paths)
	}
	if paths[0] != a {
		t.Errorf("paths[0]: got %q, want %q", paths[0], a)
	}
	if paths[1] != b {
		t.Errorf("paths[1]: got %q, want %q", paths[1], b)
	}
}

func TestDefaultPaths_FiltersMissingFiles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	real := filepath.Join(home, "real.yaml")
	if err := os.WriteFile(real, []byte("apiVersion: v1\nkind: Config\n"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	missing := filepath.Join(home, "missing.yaml")

	sep := ":"
	if runtime.GOOS == "windows" {
		sep = ";"
	}
	t.Setenv("KUBECONFIG", real+sep+missing)

	paths := DefaultPaths()
	if len(paths) != 1 {
		t.Fatalf("expected 1 path (missing filtered), got %d: %v", len(paths), paths)
	}
	if paths[0] != real {
		t.Errorf("paths[0]: got %q, want %q", paths[0], real)
	}
}

func TestDefaultPaths_NothingExists(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("KUBECONFIG", "")

	paths := DefaultPaths()
	if len(paths) != 0 {
		t.Errorf("expected 0 paths, got %d: %v", len(paths), paths)
	}
}

func TestDefaultPaths_FiltersEmptyEntries(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	real := filepath.Join(home, "real.yaml")
	if err := os.WriteFile(real, []byte("apiVersion: v1\nkind: Config\n"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	sep := ":"
	if runtime.GOOS == "windows" {
		sep = ";"
	}
	t.Setenv("KUBECONFIG", real+sep+sep+real)

	paths := DefaultPaths()
	// Deduplication is a bonus; the minimum contract is "no empty strings".
	for _, p := range paths {
		if p == "" {
			t.Errorf("paths contained empty string: %v", paths)
		}
	}
}
