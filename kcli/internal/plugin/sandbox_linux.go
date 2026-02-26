//go:build linux

package plugin

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const sandboxPlatform = "linux"

const roWrapperScript = `#!/bin/sh
# P3-8: Remount ~/.kcli read-only so plugins with only fs-read cannot write.
KCLI_HOME="$1"
PLUGIN="$2"
shift 2
if [ -n "$KCLI_HOME" ] && [ -d "$KCLI_HOME" ]; then
  mount --bind "$KCLI_HOME" "$KCLI_HOME" 2>/dev/null && mount -o remount,ro "$KCLI_HOME" 2>/dev/null
fi
exec "$PLUGIN" "$@"
`

// buildOSSandboxProfile generates a Linux namespace-isolation profile using
// unshare(1) and returns a SandboxProfile that wraps the plugin in the
// isolated environment.
//
// P3-8: Plugins declaring only ["k8s-api"] get no network (unshare --net).
// Plugins declaring only ["k8s-api", "fs-read"] cannot write to ~/.kcli:
// a wrapper script remounts ~/.kcli read-only in the mount namespace before
// exec'ing the plugin.
//
// Namespace isolation: user, pid, mount, ipc, uts; net when no network permission.
func buildOSSandboxProfile(name, binPath string, m *Manifest) SandboxProfile {
	unsharePath, err := exec.LookPath("unshare")
	if err != nil {
		return SandboxProfile{
			Platform:   sandboxPlatform,
			Available:  false,
			PolicyText: "unshare(1) not found in PATH — OS sandboxing unavailable.\nInstall util-linux to enable plugin sandboxing.",
		}
	}

	perms := m.Permissions
	allowNetwork := permissionsContain(perms, "network:")
	allowWriteKcli := permissionsAllowWriteKcli(perms)

	flags := []string{
		"--user", "--map-root-user",
		"--pid", "--fork",
		"--mount-proc",
		"--ipc",
		"--uts",
	}
	netIsolated := false
	if !allowNetwork {
		flags = append(flags, "--net")
		netIsolated = true
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Platform:    %s\n", sandboxPlatform))
	sb.WriteString(fmt.Sprintf("Wrapper:     %s\n", unsharePath))
	sb.WriteString(fmt.Sprintf("Flags:       %s\n\n", strings.Join(flags, " ")))
	sb.WriteString("Isolation:\n")
	sb.WriteString("  user        — plugin runs as a mapped unprivileged user\n")
	sb.WriteString("  pid         — plugin has a private PID namespace (cannot see host processes)\n")
	sb.WriteString("  mount       — plugin has a private mount namespace\n")
	sb.WriteString("  ipc         — plugin cannot access host IPC primitives\n")
	sb.WriteString("  uts         — plugin cannot change the system hostname\n")
	if netIsolated {
		sb.WriteString("  net         — plugin has no external network (loopback only)\n")
		sb.WriteString("                Declare `network:<endpoint>` in plugin manifest to grant access.\n")
	} else {
		sb.WriteString("  net         — full network access (declared by plugin manifest)\n")
	}
	if !allowWriteKcli {
		sb.WriteString("  ~/.kcli     — read-only (plugin did not declare fs-write; P3-8)\n")
	}

	wrapArgs := make([]string, 0, len(flags)+5)
	wrapArgs = append(wrapArgs, unsharePath)
	wrapArgs = append(wrapArgs, flags...)
	wrapArgs = append(wrapArgs, "--")

	if !allowWriteKcli {
		kcliHome, _ := kcliHomeDir()
		wrapperPath, err := ensureROWrapperScript()
		if err != nil {
			// Fall back to no wrapper: plugin runs with full unshare but can still write ~/.kcli
			wrapArgs = append(wrapArgs, binPath)
			return SandboxProfile{
				Platform:   sandboxPlatform,
				Available:  true,
				PolicyText: sb.String() + "\nWARNING: could not create read-only wrapper: " + err.Error() + "\n",
				wrapArgs:   wrapArgs,
			}
		}
		wrapArgs = append(wrapArgs, wrapperPath)
		wrapArgs = append(wrapArgs, kcliHome)
		wrapArgs = append(wrapArgs, binPath)
		// Note: sandboxedCommand will append plugin args after wrapArgs; the wrapper expects kcliHome, plugin, args.
	} else {
		wrapArgs = append(wrapArgs, binPath)
	}

	return SandboxProfile{
		Platform:   sandboxPlatform,
		Available:  true,
		PolicyText: sb.String(),
		wrapArgs:   wrapArgs,
	}
}

// ensureROWrapperScript writes the read-only wrapper script to ~/.kcli/plugin-ro-wrapper.sh
// and returns its path. Caller must not mutate the file.
func ensureROWrapperScript() (string, error) {
	home, err := kcliHomeDir()
	if err != nil || home == "" {
		return "", fmt.Errorf("no kcli home")
	}
	dir := home
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	wrapperPath := filepath.Join(dir, "plugin-ro-wrapper.sh")
	if err := os.WriteFile(wrapperPath, []byte(roWrapperScript), 0o755); err != nil {
		return "", err
	}
	return wrapperPath, nil
}
