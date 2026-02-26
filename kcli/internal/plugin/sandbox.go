package plugin

// ---------------------------------------------------------------------------
// P2-2: OS-level plugin sandboxing
//
// kcli wraps every plugin execution inside an OS-level isolation boundary.
// The boundary is generated from the plugin's manifest `permissions:`
// declarations and applied transparently — plugins are unaware they are
// sandboxed.
//
// Platform support:
//   darwin  — sandbox-exec(1) with a generated Seatbelt (.sb) profile.
//             This is the strongest sandbox available without root.
//   linux   — unshare(1) for namespace isolation (user, pid, mount, ipc,
//             uts; optionally net when the plugin has no network permission).
//             seccomp-bpf syscall filtering is a planned follow-up.
//   other   — No OS sandbox; the plugin runs with full user privileges.
//             A warning is emitted to stderr.
//
// All sandbox types expose the same public interface:
//   BuildSandboxProfile  — generate the profile (fast, no I/O)
//   InspectSandboxProfile — resolve + generate (for `kcli plugin inspect-sandbox`)
//   sandboxedCommand      — wrap exec.Cmd inside the sandbox
// ---------------------------------------------------------------------------

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// SandboxProfile describes the OS-level isolation policy applied when running
// a plugin binary.  The profile is derived from the plugin manifest's
// `permissions:` field.
type SandboxProfile struct {
	// Platform is the GOOS value for which this profile was generated.
	Platform string

	// Available reports whether OS-level sandboxing can be applied on this
	// platform/system.  When false the plugin runs without isolation.
	Available bool

	// PolicyText is the human-readable isolation policy (a Seatbelt profile on
	// Darwin, a summary table on Linux).  Shown by `kcli plugin inspect-sandbox`.
	PolicyText string

	// wrapArgs are the arguments prepended to the plugin invocation.
	// e.g. ["sandbox-exec", "-p", "<policy>"] on macOS, or
	//      ["unshare", "--user", "--net", "--pid", ...] on Linux.
	// Empty when Available == false.
	wrapArgs []string
}

// BuildSandboxProfile generates the isolation profile for the named plugin.
// It is called once per Run() invocation; profile construction is O(1) and
// involves no I/O.
func BuildSandboxProfile(name, binPath string, m *Manifest) SandboxProfile {
	return buildOSSandboxProfile(name, binPath, m)
}

// InspectSandboxProfile resolves a plugin binary, loads its manifest and
// returns the sandbox profile that would be applied on execution.
// Used by `kcli plugin inspect-sandbox <name>`.
func InspectSandboxProfile(name string) (SandboxProfile, error) {
	bin, err := Resolve(name)
	if err != nil {
		return SandboxProfile{}, err
	}
	m, err := loadManifestForResolved(name, bin)
	if err != nil {
		return SandboxProfile{}, err
	}
	return BuildSandboxProfile(name, bin, m), nil
}

// sandboxedCommand returns an exec.Cmd that wraps bin+args inside the
// sandbox described by profile.  When the profile is unavailable it returns
// a plain exec.Command(bin, args...) so callers do not need to branch.
func sandboxedCommand(bin string, args []string, profile SandboxProfile) *exec.Cmd {
	if !profile.Available || len(profile.wrapArgs) == 0 {
		return exec.Command(bin, args...)
	}
	// Full argv: wrapArgs + [bin if not already last] + args.
	// Linux ro-wrapper case: wrapArgs already ends with bin (wrapperPath, kcliHome, bin).
	all := make([]string, 0, len(profile.wrapArgs)+1+len(args))
	all = append(all, profile.wrapArgs...)
	if len(all) == 0 || all[len(all)-1] != bin {
		all = append(all, bin)
	}
	all = append(all, args...)
	return exec.Command(all[0], all[1:]...)
}

// ---------------------------------------------------------------------------
// Helpers shared across platform implementations
// ---------------------------------------------------------------------------

// permissionsContain reports whether the manifest permissions list contains
// at least one entry whose resource part has the given prefix.
// Example: permissionsContain(perms, "network:") returns true for "network:api-server".
func permissionsContain(perms []string, prefix string) bool {
	prefix = strings.ToLower(prefix)
	for _, p := range perms {
		parts := strings.SplitN(p, ":", 2)
		if len(parts) == 2 && strings.HasPrefix(strings.ToLower(parts[1]), strings.TrimSuffix(prefix, ":")) {
			return true
		}
		// Also match if the whole permission starts with the prefix (e.g. "network:api")
		if strings.HasPrefix(strings.ToLower(p), prefix) {
			return true
		}
	}
	return false
}

// permissionsAllowWriteKcli reports whether the plugin may write to ~/.kcli.
// P3-8: Plugins declaring only ["k8s-api", "fs-read"] cannot write to ~/.kcli.
// They must declare "fs-write" or "fs-write:kcli" (or "fs:write") to get write access.
func permissionsAllowWriteKcli(perms []string) bool {
	return permissionsContain(perms, "fs-write") || permissionsContain(perms, "fs:write")
}

// kubeConfigPath returns the active kubeconfig file path.  It honours the
// KUBECONFIG environment variable, falling back to ~/.kube/config.
func kubeConfigPath() string {
	if p := strings.TrimSpace(os.Getenv("KUBECONFIG")); p != "" {
		// KUBECONFIG can be a colon-separated list; use the first entry.
		if parts := strings.SplitN(p, string(os.PathListSeparator), 2); len(parts) > 0 && parts[0] != "" {
			return parts[0]
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s/.kube/config", home)
}
