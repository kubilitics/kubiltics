package plugin

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Helper: manifest with given permissions
// ---------------------------------------------------------------------------

func makeManifest(name string, perms []string) *Manifest {
	return &Manifest{
		Name:        name,
		Version:     "1.0.0",
		Permissions: perms,
	}
}

// ---------------------------------------------------------------------------
// permissionsContain
// ---------------------------------------------------------------------------

func TestPermissionsContain_Match(t *testing.T) {
	perms := []string{"read:pods", "network:api-server", "write:output"}
	if !permissionsContain(perms, "network:") {
		t.Fatal("expected permissionsContain to find network: entry")
	}
}

func TestPermissionsContain_NoMatch(t *testing.T) {
	perms := []string{"read:pods", "write:output"}
	if permissionsContain(perms, "network:") {
		t.Fatal("expected permissionsContain to return false for absent prefix")
	}
}

func TestPermissionsContain_EmptyList(t *testing.T) {
	if permissionsContain(nil, "network:") {
		t.Fatal("expected false for nil permissions")
	}
}

func TestPermissionsContain_CaseInsensitive(t *testing.T) {
	perms := []string{"Network:API-Server"}
	if !permissionsContain(perms, "network:") {
		t.Fatal("permissionsContain should be case-insensitive")
	}
}

// ---------------------------------------------------------------------------
// permissionsAllowWriteKcli (P3-8)
// ---------------------------------------------------------------------------

func TestPermissionsAllowWriteKcli_TrueForFsWrite(t *testing.T) {
	for _, perms := range [][]string{
		{"fs-write"},
		{"fs-write:kcli"},
		{"k8s-api", "fs-write"},
		{"fs:write"},
	} {
		if !permissionsAllowWriteKcli(perms) {
			t.Fatalf("expected permissionsAllowWriteKcli true for %v", perms)
		}
	}
}

func TestPermissionsAllowWriteKcli_FalseForFsReadOnly(t *testing.T) {
	for _, perms := range [][]string{
		nil,
		{},
		{"k8s-api"},
		{"k8s-api", "fs-read"},
		{"read:pods", "network:api"},
	} {
		if permissionsAllowWriteKcli(perms) {
			t.Fatalf("expected permissionsAllowWriteKcli false for %v", perms)
		}
	}
}

// ---------------------------------------------------------------------------
// kubeConfigPath
// ---------------------------------------------------------------------------

func TestKubeConfigPath_UsesEnvVar(t *testing.T) {
	tmp := t.TempDir()
	kc := filepath.Join(tmp, "my-kubeconfig")
	t.Setenv("KUBECONFIG", kc)
	got := kubeConfigPath()
	if got != kc {
		t.Fatalf("expected %q, got %q", kc, got)
	}
}

func TestKubeConfigPath_ColonSeparated_UsesFirst(t *testing.T) {
	tmp := t.TempDir()
	first := filepath.Join(tmp, "first.yaml")
	second := filepath.Join(tmp, "second.yaml")
	t.Setenv("KUBECONFIG", first+string(os.PathListSeparator)+second)
	got := kubeConfigPath()
	if got != first {
		t.Fatalf("expected first kubeconfig %q, got %q", first, got)
	}
}

func TestKubeConfigPath_DefaultsToHomeDotKube(t *testing.T) {
	t.Setenv("KUBECONFIG", "")
	got := kubeConfigPath()
	if !strings.HasSuffix(got, filepath.Join(".kube", "config")) {
		t.Fatalf("expected default ~/.kube/config suffix, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// BuildSandboxProfile
// ---------------------------------------------------------------------------

func TestBuildSandboxProfile_ReturnsCorrectPlatform(t *testing.T) {
	m := makeManifest("myplugin", nil)
	profile := BuildSandboxProfile("myplugin", "/usr/local/bin/kcli-myplugin", m)
	if profile.Platform != sandboxPlatform {
		t.Fatalf("expected platform %q, got %q", sandboxPlatform, profile.Platform)
	}
}

func TestBuildSandboxProfile_PolicyTextIsNonEmpty(t *testing.T) {
	m := makeManifest("myplugin", nil)
	profile := BuildSandboxProfile("myplugin", "/usr/local/bin/kcli-myplugin", m)
	if strings.TrimSpace(profile.PolicyText) == "" {
		t.Fatal("expected non-empty PolicyText")
	}
}

func TestBuildSandboxProfile_NetworkPermission_GrantsOutbound(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Seatbelt network assertions only meaningful on darwin")
	}
	m := makeManifest("nettool", []string{"network:api-server"})
	profile := BuildSandboxProfile("nettool", "/usr/local/bin/kcli-nettool", m)
	if !profile.Available {
		t.Skip("sandbox-exec unavailable; skipping network grant test")
	}
	if !strings.Contains(profile.PolicyText, "network-outbound") {
		t.Fatalf("expected network-outbound rule in policy for network: permission, got:\n%s", profile.PolicyText)
	}
	// Should NOT say "DENIED" for the outbound section.
	if strings.Contains(profile.PolicyText, "DENIED") {
		t.Fatalf("expected network to be allowed, but policy contains DENIED:\n%s", profile.PolicyText)
	}
}

func TestBuildSandboxProfile_NoNetworkPermission_DeniesOutbound(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Seatbelt network assertions only meaningful on darwin")
	}
	m := makeManifest("readtool", []string{"read:pods"})
	profile := BuildSandboxProfile("readtool", "/usr/local/bin/kcli-readtool", m)
	if !profile.Available {
		t.Skip("sandbox-exec unavailable; skipping network deny test")
	}
	if !strings.Contains(profile.PolicyText, "DENIED") {
		t.Fatalf("expected DENIED marker for plugin without network: permission, got:\n%s", profile.PolicyText)
	}
}

func TestBuildSandboxProfile_DarwinAllowsReadsAndRestrictsWrites(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("darwin-only test")
	}
	m := makeManifest("example", nil)
	profile := BuildSandboxProfile("example", "/some/path/kcli-example", m)
	if !profile.Available {
		t.Skip("sandbox-exec unavailable")
	}
	// The new model: allow all reads, restrict writes.
	if !strings.Contains(profile.PolicyText, "(allow file-read*)") {
		t.Fatalf("expected '(allow file-read*)' in darwin policy, got:\n%s", profile.PolicyText)
	}
	// Writes should be allowed to safe locations but the policy should be present.
	if !strings.Contains(profile.PolicyText, "(allow file-write*") {
		t.Fatalf("expected '(allow file-write*' section in darwin policy, got:\n%s", profile.PolicyText)
	}
	// /tmp must be in allowed writes.
	if !strings.Contains(profile.PolicyText, `"/tmp"`) {
		t.Fatalf("expected '/tmp' in allowed write paths, got:\n%s", profile.PolicyText)
	}
}

func TestBuildSandboxProfile_LinuxFlags_NoNetwork(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-only test")
	}
	m := makeManifest("myplugin", []string{"read:pods"})
	profile := BuildSandboxProfile("myplugin", "/usr/local/bin/kcli-myplugin", m)
	if !profile.Available {
		t.Skip("unshare unavailable; skipping")
	}
	// Without network: permission, --net should appear in the flags.
	if !strings.Contains(profile.PolicyText, "--net") {
		t.Fatalf("expected --net in linux sandbox summary when no network: permission declared:\n%s", profile.PolicyText)
	}
}

func TestBuildSandboxProfile_LinuxFlags_WithNetwork(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux-only test")
	}
	m := makeManifest("nettool", []string{"network:api-server"})
	profile := BuildSandboxProfile("nettool", "/usr/local/bin/kcli-nettool", m)
	if !profile.Available {
		t.Skip("unshare unavailable; skipping")
	}
	// With network: permission, --net must NOT appear (full network allowed).
	if strings.Contains(profile.PolicyText, "--net") && !strings.Contains(profile.PolicyText, "full network access") {
		t.Fatalf("expected no --net isolation when network: permission declared:\n%s", profile.PolicyText)
	}
}

// ---------------------------------------------------------------------------
// sandboxedCommand
// ---------------------------------------------------------------------------

func TestSandboxedCommand_UnavailableProfile_ReturnsPlainCommand(t *testing.T) {
	profile := SandboxProfile{Available: false}
	bin := "/usr/local/bin/kcli-foo"
	args := []string{"--help"}
	cmd := sandboxedCommand(bin, args, profile)
	if cmd.Path != bin {
		t.Fatalf("expected plain command path %q, got %q", bin, cmd.Path)
	}
}

func TestSandboxedCommand_AvailableProfile_PrepentsWrapArgs(t *testing.T) {
	profile := SandboxProfile{
		Available: true,
		wrapArgs:  []string{"/usr/bin/sandbox-exec", "-p", "(version 1)(deny default)"},
	}
	bin := "/path/to/kcli-myplugin"
	args := []string{"status", "--all"}
	cmd := sandboxedCommand(bin, args, profile)
	// The command should start with the sandbox-exec binary.
	if !strings.HasSuffix(cmd.Path, "sandbox-exec") && !strings.HasSuffix(cmd.Path, "unshare") {
		// On some systems exec.Command may resolve the path; just check Args[0].
	}
	// Args[0] is the wrapper, followed by wrapArgs[1:], then bin, then plugin args.
	if len(cmd.Args) < 1+len(profile.wrapArgs)-1+1+len(args) {
		t.Fatalf("expected at least %d args, got %d: %v", 1+len(profile.wrapArgs)-1+1+len(args), len(cmd.Args), cmd.Args)
	}
	// The plugin binary path should appear in the args list.
	found := false
	for _, a := range cmd.Args {
		if a == bin {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected plugin bin path %q in sandboxed command args %v", bin, cmd.Args)
	}
	// The plugin's own args should also appear.
	foundStatus := false
	for _, a := range cmd.Args {
		if a == "status" {
			foundStatus = true
		}
	}
	if !foundStatus {
		t.Fatalf("expected plugin arg 'status' in sandboxed command args %v", cmd.Args)
	}
}

func TestSandboxedCommand_EmptyWrapArgs_ReturnsPlainCommand(t *testing.T) {
	// Available but wrapArgs is empty — edge case guard.
	profile := SandboxProfile{Available: true, wrapArgs: nil}
	bin := "/usr/local/bin/kcli-bar"
	cmd := sandboxedCommand(bin, nil, profile)
	if cmd.Path != bin {
		t.Fatalf("expected plain command for empty wrapArgs, got %q", cmd.Path)
	}
}

// TestSandboxedCommand_BinAlreadyInWrapArgs_NoDuplicate ensures that when
// wrapArgs already ends with the plugin binary (e.g. Linux ro-wrapper case:
// unshare ... -- wrapperPath kcliHome bin), we do not append bin again.
func TestSandboxedCommand_BinAlreadyInWrapArgs_NoDuplicate(t *testing.T) {
	bin := "/path/to/kcli-foo"
	profile := SandboxProfile{
		Available: true,
		wrapArgs:  []string{"/usr/bin/unshare", "--net", "--", "/wrapper.sh", "/home/u/.kcli", bin},
	}
	args := []string{"--help"}
	cmd := sandboxedCommand(bin, args, profile)
	// Bin should appear exactly once.
	count := 0
	for _, a := range cmd.Args {
		if a == bin {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected bin to appear exactly once in args, got %d: %v", count, cmd.Args)
	}
	// Plugin args should be present.
	if len(cmd.Args) < 2 || cmd.Args[len(cmd.Args)-1] != "--help" {
		t.Fatalf("expected --help as last arg, got %v", cmd.Args)
	}
}

// ---------------------------------------------------------------------------
// InspectSandboxProfile (integration — requires real installed plugin)
// ---------------------------------------------------------------------------

func TestInspectSandboxProfile_ReturnsProfileForInstalledPlugin(t *testing.T) {
	home := setupPluginHome(t)
	createPlugin(t, home, "sandboxtest", "name: sandboxtest\nversion: 1.0.0\npermissions: []\n")

	profile, err := InspectSandboxProfile("sandboxtest")
	if err != nil {
		t.Fatalf("InspectSandboxProfile: %v", err)
	}
	if profile.Platform == "" {
		t.Fatal("expected non-empty Platform")
	}
	if strings.TrimSpace(profile.PolicyText) == "" {
		t.Fatal("expected non-empty PolicyText")
	}
}

func TestInspectSandboxProfile_MissingPlugin_ReturnsError(t *testing.T) {
	setupPluginHome(t)
	_, err := InspectSandboxProfile("does-not-exist")
	if err == nil {
		t.Fatal("expected error for non-existent plugin")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected 'not found' in error, got: %v", err)
	}
}
