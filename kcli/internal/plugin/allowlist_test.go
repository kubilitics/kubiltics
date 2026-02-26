package plugin

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// setupAllowlistHome wires the KCLI_PLUGIN_ALLOWLIST env var to a temp file
// inside the plugin home and returns the full file path.
func setupAllowlistHome(t *testing.T) string {
	t.Helper()
	home := setupPluginHome(t) // sets KCLI_HOME_DIR
	path := filepath.Join(home, "plugin-allowlist.json")
	t.Setenv("KCLI_PLUGIN_ALLOWLIST", path)
	return path
}

// ---------------------------------------------------------------------------
// LoadAllowlist
// ---------------------------------------------------------------------------

func TestLoadAllowlist_EmptyWhenNoFile(t *testing.T) {
	setupAllowlistHome(t)
	store, err := LoadAllowlist()
	if err != nil {
		t.Fatalf("expected no error for missing file, got: %v", err)
	}
	if store.Locked {
		t.Fatal("expected Locked=false for missing file")
	}
	if len(store.Plugins) != 0 {
		t.Fatalf("expected empty Plugins for missing file, got %v", store.Plugins)
	}
}

func TestLoadAllowlist_ParsesFile(t *testing.T) {
	path := setupAllowlistHome(t)
	content := `{"plugins":["argocd","cert-manager"],"locked":true}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	store, err := LoadAllowlist()
	if err != nil {
		t.Fatalf("LoadAllowlist: %v", err)
	}
	if !store.Locked {
		t.Fatal("expected Locked=true")
	}
	if len(store.Plugins) != 2 {
		t.Fatalf("expected 2 plugins, got %d: %v", len(store.Plugins), store.Plugins)
	}
}

func TestLoadAllowlist_DeduplicatesAndSorts(t *testing.T) {
	path := setupAllowlistHome(t)
	content := `{"plugins":["zzz","alpha","alpha","beta"]}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	store, err := LoadAllowlist()
	if err != nil {
		t.Fatalf("LoadAllowlist: %v", err)
	}
	want := []string{"alpha", "beta", "zzz"}
	if len(store.Plugins) != len(want) {
		t.Fatalf("expected %v, got %v", want, store.Plugins)
	}
	for i, p := range want {
		if store.Plugins[i] != p {
			t.Fatalf("index %d: expected %q, got %q", i, p, store.Plugins[i])
		}
	}
}

func TestLoadAllowlist_EmptyBytesReturnsEmpty(t *testing.T) {
	path := setupAllowlistHome(t)
	if err := os.WriteFile(path, []byte{}, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	store, err := LoadAllowlist()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if store.Locked || len(store.Plugins) != 0 {
		t.Fatalf("expected empty unlocked store, got %+v", store)
	}
}

// ---------------------------------------------------------------------------
// SaveAllowlist
// ---------------------------------------------------------------------------

func TestSaveAllowlist_CreatesFile(t *testing.T) {
	path := setupAllowlistHome(t)
	store := &AllowlistStore{Plugins: []string{"argocd"}, Locked: true}
	if err := SaveAllowlist(store); err != nil {
		t.Fatalf("SaveAllowlist: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected file to be created: %v", err)
	}
}

func TestSaveAllowlist_RoundTrip(t *testing.T) {
	setupAllowlistHome(t)
	original := &AllowlistStore{Plugins: []string{"backup", "argocd"}, Locked: false}
	if err := SaveAllowlist(original); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := LoadAllowlist()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Locked != original.Locked {
		t.Fatalf("Locked mismatch: want %v, got %v", original.Locked, loaded.Locked)
	}
	// SaveAllowlist sorts, so expect ["argocd","backup"]
	if len(loaded.Plugins) != 2 || loaded.Plugins[0] != "argocd" || loaded.Plugins[1] != "backup" {
		t.Fatalf("unexpected Plugins: %v", loaded.Plugins)
	}
}

func TestSaveAllowlist_NilReturnsError(t *testing.T) {
	setupAllowlistHome(t)
	if err := SaveAllowlist(nil); err == nil {
		t.Fatal("expected error for nil store")
	}
}

// ---------------------------------------------------------------------------
// IsPluginAllowed
// ---------------------------------------------------------------------------

func TestIsPluginAllowed_UnlockedAlwaysOK(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd"}, Locked: false})
	if err := IsPluginAllowed("anything"); err != nil {
		t.Fatalf("expected nil when unlocked, got: %v", err)
	}
}

func TestIsPluginAllowed_LockedAndPresent(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd", "cert-manager"}, Locked: true})
	if err := IsPluginAllowed("argocd"); err != nil {
		t.Fatalf("expected nil for allowed plugin, got: %v", err)
	}
	if err := IsPluginAllowed("cert-manager"); err != nil {
		t.Fatalf("expected nil for allowed plugin, got: %v", err)
	}
}

func TestIsPluginAllowed_LockedAndAbsent(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd"}, Locked: true})
	err := IsPluginAllowed("unknown-plugin")
	if err == nil {
		t.Fatal("expected error for unlisted plugin when locked")
	}
	if !errors.Is(err, ErrPluginNotAllowed) {
		t.Fatalf("expected ErrPluginNotAllowed, got: %v", err)
	}
}

func TestIsPluginAllowed_NoFileIsOpen(t *testing.T) {
	setupAllowlistHome(t)
	// No file written — should behave as unlocked (fail open).
	if err := IsPluginAllowed("anyplugin"); err != nil {
		t.Fatalf("expected nil when no allowlist file exists, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// AllowlistAdd / AllowlistRemove / AllowlistSetLocked
// ---------------------------------------------------------------------------

func TestAllowlistAdd_AddsEntries(t *testing.T) {
	setupAllowlistHome(t)
	if err := AllowlistAdd([]string{"argocd", "backup"}); err != nil {
		t.Fatalf("AllowlistAdd: %v", err)
	}
	store, _ := LoadAllowlist()
	if len(store.Plugins) != 2 {
		t.Fatalf("expected 2 plugins, got %d: %v", len(store.Plugins), store.Plugins)
	}
}

func TestAllowlistAdd_Idempotent(t *testing.T) {
	setupAllowlistHome(t)
	_ = AllowlistAdd([]string{"argocd"})
	_ = AllowlistAdd([]string{"argocd", "argocd"})
	store, _ := LoadAllowlist()
	if len(store.Plugins) != 1 || store.Plugins[0] != "argocd" {
		t.Fatalf("expected exactly 1 deduped entry, got %v", store.Plugins)
	}
}

func TestAllowlistRemove_RemovesEntry(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd", "backup", "cert-manager"}})
	if err := AllowlistRemove([]string{"backup"}); err != nil {
		t.Fatalf("AllowlistRemove: %v", err)
	}
	store, _ := LoadAllowlist()
	for _, p := range store.Plugins {
		if p == "backup" {
			t.Fatal("expected 'backup' to be removed")
		}
	}
	if len(store.Plugins) != 2 {
		t.Fatalf("expected 2 remaining plugins, got %d: %v", len(store.Plugins), store.Plugins)
	}
}

func TestAllowlistRemove_NoopForMissingEntry(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd"}})
	if err := AllowlistRemove([]string{"nonexistent"}); err != nil {
		t.Fatalf("AllowlistRemove for missing entry: %v", err)
	}
	store, _ := LoadAllowlist()
	if len(store.Plugins) != 1 || store.Plugins[0] != "argocd" {
		t.Fatalf("expected unchanged list, got %v", store.Plugins)
	}
}

func TestAllowlistSetLocked_TogglesFlag(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd"}, Locked: false})

	if err := AllowlistSetLocked(true); err != nil {
		t.Fatalf("AllowlistSetLocked(true): %v", err)
	}
	store, _ := LoadAllowlist()
	if !store.Locked {
		t.Fatal("expected Locked=true after lock")
	}

	if err := AllowlistSetLocked(false); err != nil {
		t.Fatalf("AllowlistSetLocked(false): %v", err)
	}
	store, _ = LoadAllowlist()
	if store.Locked {
		t.Fatal("expected Locked=false after unlock")
	}
}

func TestAllowlistSetLocked_PreservesPlugins(t *testing.T) {
	setupAllowlistHome(t)
	_ = SaveAllowlist(&AllowlistStore{Plugins: []string{"argocd", "cert-manager"}})
	_ = AllowlistSetLocked(true)
	store, _ := LoadAllowlist()
	if len(store.Plugins) != 2 {
		t.Fatalf("expected plugins preserved after lock, got %v", store.Plugins)
	}
}
