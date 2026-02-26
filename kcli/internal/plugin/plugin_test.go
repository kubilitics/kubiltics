package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatalf("write failed: %v", err)
	}
}

func setupPluginHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("KCLI_HOME_DIR", home)
	return home
}

func createPlugin(t *testing.T, home, name, manifest string) string {
	t.Helper()
	bin := filepath.Join(home, "plugins", "kcli-"+name)
	writeFile(t, bin, "#!/bin/sh\necho plugin-ok\n", 0o755)
	writeFile(t, filepath.Join(home, "plugins", "plugin.yaml"), manifest, 0o644)
	return bin
}

func TestResolveRejectsInvalidName(t *testing.T) {
	setupPluginHome(t)
	_, err := Resolve("../../etc/passwd")
	if err == nil {
		t.Fatalf("expected invalid name error")
	}
}

func TestInspectLoadsValidatedManifest(t *testing.T) {
	home := setupPluginHome(t)
	manifest := `name: foo
version: 1.2.3
author: team
permissions:
  - read:pods
  - write:deployments
`
	createPlugin(t, home, "foo", manifest)

	info, err := Inspect("foo")
	if err != nil {
		t.Fatalf("inspect error: %v", err)
	}
	if info.ValidationError != nil {
		t.Fatalf("unexpected validation error: %v", info.ValidationError)
	}
	if info.Manifest == nil || info.Manifest.Name != "foo" {
		t.Fatalf("unexpected manifest: %+v", info.Manifest)
	}
	if len(info.Manifest.Permissions) != 2 {
		t.Fatalf("expected 2 permissions, got %v", info.Manifest.Permissions)
	}
}

func TestRunDeniedWhenPermissionsNotApprovedInNonInteractive(t *testing.T) {
	home := setupPluginHome(t)
	manifest := `name: foo
version: 1.2.3
permissions:
  - read:pods
`
	createPlugin(t, home, "foo", manifest)

	f, err := os.CreateTemp(t.TempDir(), "stdin")
	if err != nil {
		t.Fatalf("create temp stdin failed: %v", err)
	}
	oldStdin := os.Stdin
	os.Stdin = f
	t.Cleanup(func() {
		os.Stdin = oldStdin
		_ = f.Close()
	})

	err = Run("foo", nil)
	if err == nil {
		t.Fatalf("expected permission approval error")
	}
	if !strings.Contains(err.Error(), "requires unapproved permissions") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPolicyAllowMissingAndRevoke(t *testing.T) {
	setupPluginHome(t)
	if err := AllowPermissions("foo", []string{"read:pods", "write:deployments"}); err != nil {
		t.Fatalf("allow failed: %v", err)
	}
	missing, err := MissingPermissions("foo", []string{"read:pods", "write:deployments", "read:nodes"})
	if err != nil {
		t.Fatalf("missing failed: %v", err)
	}
	if len(missing) != 1 || missing[0] != "read:nodes" {
		t.Fatalf("unexpected missing permissions: %v", missing)
	}

	if err := RevokePermissions("foo", []string{"read:pods"}); err != nil {
		t.Fatalf("revoke failed: %v", err)
	}
	missing, err = MissingPermissions("foo", []string{"read:pods", "write:deployments"})
	if err != nil {
		t.Fatalf("missing failed: %v", err)
	}
	if len(missing) != 1 || missing[0] != "read:pods" {
		t.Fatalf("unexpected missing permissions after revoke: %v", missing)
	}

	if err := RevokePermissions("foo", nil); err != nil {
		t.Fatalf("revoke all failed: %v", err)
	}
	missing, err = MissingPermissions("foo", []string{"write:deployments"})
	if err != nil {
		t.Fatalf("missing failed: %v", err)
	}
	if len(missing) != 1 || missing[0] != "write:deployments" {
		t.Fatalf("expected all permissions revoked, got %v", missing)
	}
}

func TestDiscoverInfoFlagsInvalidManifest(t *testing.T) {
	home := setupPluginHome(t)
	manifest := `name: foo
version: ""
permissions:
  - malformed
`
	createPlugin(t, home, "foo", manifest)

	infos, err := DiscoverInfo()
	if err != nil {
		t.Fatalf("discover failed: %v", err)
	}
	if len(infos) != 1 {
		t.Fatalf("expected 1 plugin, got %d", len(infos))
	}
	if infos[0].ValidationError == nil {
		t.Fatalf("expected validation error")
	}
}

func TestTryRunForArgsUsesManifestCommandAlias(t *testing.T) {
	home := setupPluginHome(t)
	bin := filepath.Join(home, "plugins", "kcli-foo")
	writeFile(t, bin, "#!/bin/sh\necho \"$@\" > \"$KCLI_HOME_DIR/ran.txt\"\n", 0o755)
	manifest := `name: foo
version: 1.0.0
commands:
  - aliascmd
permissions: []
`
	writeFile(t, filepath.Join(home, "plugins", "plugin.yaml"), manifest, 0o644)

	handled, err := TryRunForArgs([]string{"aliascmd", "a1", "a2"}, func(string) bool { return false })
	if err != nil {
		t.Fatalf("TryRunForArgs error: %v", err)
	}
	if !handled {
		t.Fatal("expected alias command to be handled by plugin")
	}
	out, rerr := os.ReadFile(filepath.Join(home, "ran.txt"))
	if rerr != nil {
		t.Fatalf("expected ran marker file: %v", rerr)
	}
	if strings.TrimSpace(string(out)) != "a1 a2" {
		t.Fatalf("unexpected plugin args output: %q", string(out))
	}
}

func TestRunRefusesWhenMinKcliVersionTooNew(t *testing.T) {
	home := setupPluginHome(t)
	manifest := `name: foo
version: 1.0.0
minKcliVersion: "99.0.0"
permissions: []
`
	createPlugin(t, home, "foo", manifest)

	err := Run("foo", nil)
	if err == nil {
		t.Fatalf("expected error when plugin requires newer kcli")
	}
	if !strings.Contains(err.Error(), "99.0.0") || !strings.Contains(err.Error(), "current") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestResolveBlocksPathPluginsByDefault(t *testing.T) {
	home := setupPluginHome(t)
	ext := t.TempDir()
	bin := filepath.Join(ext, "kcli-ext")
	writeFile(t, bin, "#!/bin/sh\necho ext\n", 0o755)
	manifest := `name: ext
version: 1.0.0
permissions: []
`
	writeFile(t, filepath.Join(ext, "plugin.yaml"), manifest, 0o644)

	oldPath := os.Getenv("PATH")
	t.Setenv("PATH", ext+string(os.PathListSeparator)+oldPath)
	if _, err := Resolve("ext"); err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("expected sandbox outside error, got: %v", err)
	}

	t.Setenv("KCLI_PLUGIN_ALLOW_PATH", "1")
	resolved, err := Resolve("ext")
	if err != nil {
		t.Fatalf("expected resolve success with allow path, got: %v", err)
	}
	if resolved != bin {
		t.Fatalf("unexpected resolved path: got %q want %q (home %q)", resolved, bin, home)
	}
}

func TestInstallUpdateRemoveLocalPlugin(t *testing.T) {
	home := setupPluginHome(t)
	src := t.TempDir()
	execPath := filepath.Join(src, "kcli-demo")
	manifestPath := filepath.Join(src, "plugin.yaml")
	writeFile(t, execPath, "#!/bin/sh\necho v1\n", 0o755)
	writeFile(t, manifestPath, "name: demo\nversion: 1.0.0\ndescription: demo plugin\npermissions: []\ncommands:\n  - dmo\n", 0o644)

	entry, err := InstallFromSource(src)
	if err != nil {
		t.Fatalf("install failed: %v", err)
	}
	if entry.Name != "demo" || entry.SourceType != "local" {
		t.Fatalf("unexpected entry: %+v", entry)
	}
	installedBin := filepath.Join(home, "plugins", "kcli-demo")
	installedManifest := filepath.Join(home, "plugins", "kcli-demo.yaml")
	if _, err := os.Stat(installedBin); err != nil {
		t.Fatalf("installed bin missing: %v", err)
	}
	if _, err := os.Stat(installedManifest); err != nil {
		t.Fatalf("installed manifest missing: %v", err)
	}
	discovered, err := DiscoverInfo()
	if err != nil {
		t.Fatalf("discover failed: %v", err)
	}
	if len(discovered) != 1 || discovered[0].Name != "demo" {
		t.Fatalf("expected only demo executable discovered, got %+v", discovered)
	}

	results, err := SearchInstalled("demo plugin")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) != 1 || results[0].Name != "demo" {
		t.Fatalf("unexpected search results: %+v", results)
	}

	writeFile(t, execPath, "#!/bin/sh\necho v2\n", 0o755)
	if _, err := UpdateInstalled("demo"); err != nil {
		t.Fatalf("update failed: %v", err)
	}
	b, err := os.ReadFile(installedBin)
	if err != nil {
		t.Fatalf("read installed bin failed: %v", err)
	}
	if !strings.Contains(string(b), "v2") {
		t.Fatalf("expected updated binary content, got: %s", string(b))
	}

	if err := RemoveInstalled("demo"); err != nil {
		t.Fatalf("remove failed: %v", err)
	}
	if _, err := os.Stat(installedBin); !os.IsNotExist(err) {
		t.Fatalf("expected installed bin removed, stat err=%v", err)
	}
	reg, err := LoadRegistry()
	if err != nil {
		t.Fatalf("load registry failed: %v", err)
	}
	if _, ok := reg.Plugins["demo"]; ok {
		t.Fatalf("expected registry entry removed: %+v", reg.Plugins["demo"])
	}
}

func TestManifestCommandValidation(t *testing.T) {
	home := setupPluginHome(t)
	manifest := `name: foo
version: 1.2.3
commands:
  - invalid command
permissions: []
`
	createPlugin(t, home, "foo", manifest)

	infos, err := DiscoverInfo()
	if err != nil {
		t.Fatalf("discover failed: %v", err)
	}
	if len(infos) != 1 {
		t.Fatalf("expected one plugin, got %d", len(infos))
	}
	if infos[0].ValidationError == nil || !strings.Contains(infos[0].ValidationError.Error(), "manifest.commands") {
		t.Fatalf("expected manifest command validation error, got: %v", infos[0].ValidationError)
	}
}

func TestMarketplaceLookupAndSearch(t *testing.T) {
	catalog, err := MarketplaceCatalog()
	if err != nil {
		t.Fatalf("catalog error: %v", err)
	}
	if len(catalog) == 0 {
		t.Fatal("expected non-empty default marketplace catalog")
	}
	if _, err := LookupMarketplace("cert-manager"); err != nil {
		t.Fatalf("lookup cert-manager failed: %v", err)
	}
	results, err := SearchMarketplace("mesh")
	if err != nil {
		t.Fatalf("search marketplace failed: %v", err)
	}
	found := false
	for _, p := range results {
		if p.Name == "istio" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected istio in mesh search results: %+v", results)
	}
}

func TestInstallFromMarketplaceName(t *testing.T) {
	home := setupPluginHome(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "kcli-marketdemo"), "#!/bin/sh\necho market\n", 0o755)
	writeFile(t, filepath.Join(src, "plugin.yaml"), "name: marketdemo\nversion: 1.0.0\npermissions: []\n", 0o644)

	reg := []MarketplacePlugin{{
		Name:        "marketdemo",
		Source:      src,
		Version:     "1.0.0",
		Description: "market demo",
		Official:    true,
		Downloads:   10,
		Rating:      4.9,
		Tags:        []string{"official"},
	}}
	mpPath := filepath.Join(t.TempDir(), "market.json")
	b, _ := json.Marshal(reg)
	writeFile(t, mpPath, string(b), 0o644)
	t.Setenv("KCLI_PLUGIN_MARKETPLACE_FILE", mpPath)

	entry, err := InstallFromSource("marketdemo")
	if err != nil {
		t.Fatalf("install from marketplace name failed: %v", err)
	}
	if entry.Name != "marketdemo" {
		t.Fatalf("unexpected installed entry: %+v", entry)
	}
	if _, err := os.Stat(filepath.Join(home, "plugins", "kcli-marketdemo")); err != nil {
		t.Fatalf("expected installed binary: %v", err)
	}
}

// ---------------------------------------------------------------------------
// P2-1: Plugin binary integrity tests
// ---------------------------------------------------------------------------

func TestBinaryChecksum_MatchesFileSHA256(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "plugin-bin")
	content := []byte("#!/bin/sh\necho hello\n")
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	a, err := BinaryChecksum(path)
	if err != nil {
		t.Fatalf("BinaryChecksum: %v", err)
	}
	b, err := FileSHA256(path)
	if err != nil {
		t.Fatalf("FileSHA256: %v", err)
	}
	if a != b {
		t.Fatalf("BinaryChecksum %q != FileSHA256 %q", a, b)
	}
	if len(a) != 64 {
		t.Fatalf("expected 64-char hex SHA-256, got %d chars: %s", len(a), a)
	}
}

func TestBinaryChecksum_Deterministic(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "plugin-bin")
	if err := os.WriteFile(path, []byte("consistent content"), 0o755); err != nil {
		t.Fatalf("write: %v", err)
	}
	a, _ := BinaryChecksum(path)
	b, _ := BinaryChecksum(path)
	if a != b {
		t.Fatal("BinaryChecksum is not deterministic")
	}
}

func TestVerifyPlugin_NoRegistryEntry_PassesThrough(t *testing.T) {
	// A plugin not in the registry must be allowed through (manual install).
	setupPluginHome(t)
	if err := VerifyPlugin("no-such-plugin"); err != nil {
		t.Fatalf("expected VerifyPlugin to pass for unregistered plugin, got: %v", err)
	}
}

func TestVerifyPlugin_EmptyChecksum_PassesThrough(t *testing.T) {
	// A registry entry with no recorded checksum must pass (legacy install).
	home := setupPluginHome(t)
	reg := &Registry{Plugins: map[string]RegistryEntry{
		"myplugin": {Name: "myplugin", SHA256: ""},
	}}
	if err := SaveRegistry(reg); err != nil {
		t.Fatalf("SaveRegistry: %v", err)
	}
	// Create the binary so Resolve can find it.
	createPlugin(t, home, "myplugin", `{"name":"myplugin","version":"1.0.0"}`)
	if err := VerifyPlugin("myplugin"); err != nil {
		t.Fatalf("expected VerifyPlugin to pass for entry with no checksum, got: %v", err)
	}
}

func TestVerifyPlugin_CorrectChecksum_Passes(t *testing.T) {
	home := setupPluginHome(t)
	binPath := createPlugin(t, home, "myplugin", `{"name":"myplugin","version":"1.0.0"}`)
	sum, err := BinaryChecksum(binPath)
	if err != nil {
		t.Fatalf("BinaryChecksum: %v", err)
	}
	reg := &Registry{Plugins: map[string]RegistryEntry{
		"myplugin": {Name: "myplugin", SHA256: sum},
	}}
	if err := SaveRegistry(reg); err != nil {
		t.Fatalf("SaveRegistry: %v", err)
	}
	if err := VerifyPlugin("myplugin"); err != nil {
		t.Fatalf("expected VerifyPlugin to pass for correct checksum, got: %v", err)
	}
}

func TestVerifyPlugin_TamperedBinary_Fails(t *testing.T) {
	home := setupPluginHome(t)
	binPath := createPlugin(t, home, "myplugin", `{"name":"myplugin","version":"1.0.0"}`)

	// Record the original checksum.
	sum, _ := BinaryChecksum(binPath)
	reg := &Registry{Plugins: map[string]RegistryEntry{
		"myplugin": {Name: "myplugin", SHA256: sum},
	}}
	if err := SaveRegistry(reg); err != nil {
		t.Fatalf("SaveRegistry: %v", err)
	}

	// Tamper with the binary after recording the checksum.
	if err := os.WriteFile(binPath, []byte("#!/bin/sh\necho tampered\n"), 0o755); err != nil {
		t.Fatalf("tamper write: %v", err)
	}

	err := VerifyPlugin("myplugin")
	if err == nil {
		t.Fatal("expected VerifyPlugin to fail for tampered binary")
	}
	if !strings.Contains(err.Error(), "checksum mismatch") && !strings.Contains(err.Error(), "tampered") {
		t.Fatalf("expected checksum mismatch error, got: %v", err)
	}
}

func TestInstallFromSource_RecordsChecksum(t *testing.T) {
	home := setupPluginHome(t)
	// Build a minimal installable local plugin directory.
	srcDir := filepath.Join(t.TempDir(), "myplugin")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	// Write a fake binary (must start with "kcli-").
	binPath := filepath.Join(srcDir, "kcli-myplugin")
	if err := os.WriteFile(binPath, []byte("#!/bin/sh\necho hello\n"), 0o755); err != nil {
		t.Fatalf("write binary: %v", err)
	}
	// Write a YAML manifest named plugin.yaml (what findManifestPath looks for).
	manifestContent := "name: myplugin\nversion: 0.1.0\n"
	manifestPath := filepath.Join(srcDir, "plugin.yaml")
	if err := os.WriteFile(manifestPath, []byte(manifestContent), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	entry, err := InstallFromSource(srcDir)
	if err != nil {
		t.Fatalf("InstallFromSource: %v", err)
	}
	if strings.TrimSpace(entry.SHA256) == "" {
		t.Fatal("expected InstallFromSource to record SHA256 in registry entry")
	}
	if len(entry.SHA256) != 64 {
		t.Fatalf("expected 64-char hex SHA-256, got %q", entry.SHA256)
	}

	// Also verify the stored checksum matches the installed binary.
	installedBin := filepath.Join(home, "plugins", "kcli-myplugin")
	expected, err := BinaryChecksum(installedBin)
	if err != nil {
		t.Fatalf("BinaryChecksum of installed binary: %v", err)
	}
	if entry.SHA256 != expected {
		t.Fatalf("registry SHA256 %q != installed binary SHA256 %q", entry.SHA256, expected)
	}
}
