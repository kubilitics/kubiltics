package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestBuildStubSidecar compiles the stub binary into testdata/stubsidecar/stub
// so other tests in the supervisor package can exec it.
func TestBuildStubSidecar(t *testing.T) {
	dir, _ := os.Getwd()
	out := filepath.Join(dir, "stub")
	cmd := exec.Command("go", "build", "-o", out, ".")
	cmd.Dir = dir
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build stub: %v\n%s", err, outBytes)
	}
	if _, err := os.Stat(out); err != nil {
		t.Fatalf("stub binary missing: %v", err)
	}
}
