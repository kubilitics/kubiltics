package plugin

// ---------------------------------------------------------------------------
// P2-5: Plugin allowlist mode for enterprise
//
// Enterprise platform admins can maintain a list of pre-approved plugins and
// lock it so that developers cannot install or run plugins outside the list.
//
// Allowlist file: ~/.kcli/plugin-allowlist.json  (KCLI_PLUGIN_ALLOWLIST for tests)
//
// File format:
//
//	{
//	  "plugins": ["argocd", "cert-manager", "backup"],
//	  "locked": true
//	}
//
// When "locked" is false (default) the allowlist is advisory — any plugin
// can run regardless of whether it appears in the list.
//
// When "locked" is true IsPluginAllowed returns an error for any plugin whose
// name is not in the "plugins" array.  InstallFromSource and Run both call
// IsPluginAllowed so enforcement is automatic.
//
// Admin workflow:
//
//	kcli plugin allowlist add argocd cert-manager
//	kcli plugin allowlist lock
//	# developers can now only install/run argocd and cert-manager
//	kcli plugin allowlist show
//	kcli plugin allowlist rm cert-manager
//	kcli plugin allowlist unlock   # disable enforcement
// ---------------------------------------------------------------------------

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// AllowlistStore is the JSON document persisted to plugin-allowlist.json.
type AllowlistStore struct {
	// Plugins is the sorted, deduplicated list of permitted plugin names.
	Plugins []string `json:"plugins"`
	// Locked controls enforcement.
	//   false (default) — allowlist has no effect; any plugin can run.
	//   true            — only plugins in Plugins may be installed or executed.
	Locked bool `json:"locked,omitempty"`
}

// ErrPluginNotAllowed is returned when the allowlist is locked and the
// requested plugin name is not present in the allowlist.
var ErrPluginNotAllowed = errors.New("plugin not in organization allowlist")

// allowlistFilePath returns the path to the allowlist JSON file.
// Overridden by KCLI_PLUGIN_ALLOWLIST for testing.
func allowlistFilePath() (string, error) {
	if p := os.Getenv("KCLI_PLUGIN_ALLOWLIST"); p != "" {
		return p, nil
	}
	home, err := kcliHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "plugin-allowlist.json"), nil
}

// LoadAllowlist reads and parses the allowlist file.
// Returns an empty (unlocked) store when the file does not exist.
func LoadAllowlist() (*AllowlistStore, error) {
	path, err := allowlistFilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &AllowlistStore{}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return &AllowlistStore{}, nil
	}
	var s AllowlistStore
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("plugin-allowlist.json: %w", err)
	}
	s.Plugins = dedupeStrings(s.Plugins)
	sort.Strings(s.Plugins)
	return &s, nil
}

// SaveAllowlist writes the allowlist to disk.
// The Plugins slice is deduplicated and sorted before writing.
func SaveAllowlist(store *AllowlistStore) error {
	if store == nil {
		return fmt.Errorf("nil allowlist store")
	}
	store.Plugins = dedupeStrings(store.Plugins)
	sort.Strings(store.Plugins)
	path, err := allowlistFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// IsPluginAllowed returns nil when the plugin is permitted to run.
//
// When the allowlist is not locked the function always returns nil (open).
// When the allowlist is locked and name is not in the list the function
// returns a descriptive error wrapping ErrPluginNotAllowed.
//
// If the allowlist file cannot be loaded the function fails open (returns nil)
// so that a corrupt or missing file never silently blocks plugin execution;
// the operator should monitor for allowlist load errors through other means.
func IsPluginAllowed(name string) error {
	store, err := LoadAllowlist()
	if err != nil {
		// Fail open — a broken allowlist file should not silently block all
		// plugin execution.  Operators must ensure the file is valid.
		return nil
	}
	if !store.Locked {
		return nil
	}
	for _, p := range store.Plugins {
		if p == name {
			return nil
		}
	}
	return fmt.Errorf("plugin %q: %w\n  add it with: kcli plugin allowlist add %s", name, ErrPluginNotAllowed, name)
}

// AllowlistAdd appends names to the allowlist (no-op for duplicates).
func AllowlistAdd(names []string) error {
	store, err := LoadAllowlist()
	if err != nil {
		return err
	}
	store.Plugins = dedupeStrings(append(store.Plugins, names...))
	sort.Strings(store.Plugins)
	return SaveAllowlist(store)
}

// AllowlistRemove removes names from the allowlist (no-op for missing names).
func AllowlistRemove(names []string) error {
	store, err := LoadAllowlist()
	if err != nil {
		return err
	}
	rm := make(map[string]struct{}, len(names))
	for _, n := range names {
		rm[n] = struct{}{}
	}
	out := store.Plugins[:0]
	for _, p := range store.Plugins {
		if _, found := rm[p]; !found {
			out = append(out, p)
		}
	}
	store.Plugins = out
	return SaveAllowlist(store)
}

// AllowlistSetLocked sets the Locked flag and saves.
func AllowlistSetLocked(locked bool) error {
	store, err := LoadAllowlist()
	if err != nil {
		return err
	}
	store.Locked = locked
	return SaveAllowlist(store)
}
