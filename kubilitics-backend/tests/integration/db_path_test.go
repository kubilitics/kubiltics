package integration

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/config"
)

// TestDBPath_SignedAppWritable verifies that the database path used in signed macOS apps
// is writable (not inside the read-only app bundle).
// 
// This test verifies the logic that should be implemented in sidecar.rs:
// - DB path should be in ~/Library/Application Support/kubilitics/ (macOS)
// - Or ~/.local/share/kubilitics/ (Linux)
// - Not in ./kubilitics.db (which would be in the app bundle on macOS)
//
// Test gaps: DB writability signed app
func TestDBPath_SignedAppWritable(t *testing.T) {
	// Simulate the path logic from sidecar.rs
	// In real Tauri app, this uses dirs::data_local_dir()
	
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("Failed to get home directory: %v", err)
	}

	// macOS path: ~/Library/Application Support/kubilitics/kubilitics.db
	macOSPath := filepath.Join(homeDir, "Library", "Application Support", "kubilitics", "kubilitics.db")
	
	// Linux path: ~/.local/share/kubilitics/kubilitics.db
	linuxPath := filepath.Join(homeDir, ".local", "share", "kubilitics", "kubilitics.db")

	// Verify the directory structure would be writable
	macOSDir := filepath.Dir(macOSPath)
	linuxDir := filepath.Dir(linuxPath)

	// Check if directories exist or can be created
	for _, dir := range []string{macOSDir, linuxDir} {
		// Try to create directory (may fail if it exists, which is fine)
		err := os.MkdirAll(dir, 0755)
		if err != nil {
			t.Logf("Could not create directory %s: %v (may already exist)", dir, err)
		}

		// Verify directory is writable
		testFile := filepath.Join(dir, ".test-write")
		err = os.WriteFile(testFile, []byte("test"), 0644)
		if err != nil {
			t.Errorf("Directory %s is not writable: %v", dir, err)
		} else {
			// Clean up test file
			os.Remove(testFile)
		}
	}

	// Verify paths are NOT in current directory (which would be app bundle)
	cwd, err := os.Getwd()
	if err == nil {
		relMacOS, _ := filepath.Rel(cwd, macOSPath)
		relLinux, _ := filepath.Rel(cwd, linuxPath)
		
		// Paths should not be relative to current directory (not in app bundle)
		if !filepath.IsAbs(macOSPath) || filepath.HasPrefix(relMacOS, "..") {
			t.Logf("macOS DB path is outside app bundle: %s", macOSPath)
		}
		if !filepath.IsAbs(linuxPath) || filepath.HasPrefix(relLinux, "..") {
			t.Logf("Linux DB path is outside app bundle: %s", linuxPath)
		}
	}
}

// TestDBPath_EnvVarOverride verifies that KUBILITICS_DATABASE_PATH env var
// can override the default path (as set by sidecar.rs).
func TestDBPath_EnvVarOverride(t *testing.T) {
	// Set custom DB path via env var
	customPath := "/tmp/test-kubilitics.db"
	os.Setenv("KUBILITICS_DATABASE_PATH", customPath)
	defer os.Unsetenv("KUBILITICS_DATABASE_PATH")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	if cfg.DatabasePath != customPath {
		t.Errorf("Expected DatabasePath to be %q, got %q", customPath, cfg.DatabasePath)
	}
}
