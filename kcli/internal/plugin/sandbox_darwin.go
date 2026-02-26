//go:build darwin

package plugin

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const sandboxPlatform = "darwin"

// buildOSSandboxProfile generates a macOS Seatbelt sandbox profile and returns
// a SandboxProfile that wraps the plugin in sandbox-exec(8).
//
// Security model — "reads-open / writes-restricted / network-conditional":
//
//	READ   — all file reads are allowed.  K8s plugins need to read system
//	         binaries (/bin/sh, kubectl), libraries, kubeconfig, manifests, etc.
//	         Restricting reads would break almost every real-world plugin.
//
//	WRITE  — only allowed to designated safe locations:
//	           /tmp, /private/tmp (temporary scratch space)
//	           user temp dir (macOS /var/folders/…)
//	           ~/.kcli/ (plugin state, config, output)
//	         Writes to sensitive dirs (ssh keys, shell profiles, crontabs,
//	         system dirs) are implicitly denied.
//
//	NETWORK — outbound TCP to external hosts is DENIED by default.
//	          Plugins that declare `network:<endpoint>` in their manifest get
//	          outbound access to ports 80/443/6443/8443.
//	          Loopback (localhost) is always allowed.
//
// The generated policy is passed inline to sandbox-exec -p so no temp file is
// written to disk.
func buildOSSandboxProfile(name, binPath string, m *Manifest) SandboxProfile {
	// Verify that sandbox-exec is available (it ships with all macOS versions).
	if _, err := exec.LookPath("sandbox-exec"); err != nil {
		return SandboxProfile{
			Platform:   sandboxPlatform,
			Available:  false,
			PolicyText: "sandbox-exec not found in PATH — OS sandboxing unavailable on this system",
		}
	}

	perms := m.Permissions
	allowNetwork := permissionsContain(perms, "network:")

	var sb strings.Builder

	sb.WriteString("(version 1)\n")
	sb.WriteString("(deny default)\n\n")

	// ── READS — allow all file reads ──────────────────────────────────────────
	// K8s plugins need to read system binaries (/bin/sh, /usr/bin/kubectl),
	// dynamic libraries, kubeconfig, manifests, and more.  Restricting reads
	// would break most plugins while providing little security benefit (reads
	// don't exfiltrate data on their own — the network gate does that).
	sb.WriteString("; File reads — allowed everywhere\n")
	sb.WriteString("(allow file-read*)\n\n")

	// ── WRITES — restricted to safe locations ─────────────────────────────────
	sb.WriteString("; File writes — restricted to safe locations\n")
	sb.WriteString("(allow file-write*\n")
	// Standard temp directories.
	sb.WriteString("  (subpath \"/tmp\")\n")
	sb.WriteString("  (subpath \"/private/tmp\")\n")
	// macOS user temp dir (os.TempDir returns /var/folders/… → /private/var/folders/…).
	sb.WriteString("  (subpath \"/var/folders\")\n")
	sb.WriteString("  (subpath \"/private/var/folders\")\n")
	// Standard I/O devices.
	sb.WriteString("  (literal \"/dev/null\")\n")
	sb.WriteString("  (literal \"/dev/stdin\")\n")
	sb.WriteString("  (literal \"/dev/stdout\")\n")
	sb.WriteString("  (literal \"/dev/stderr\")\n")
	sb.WriteString("  (literal \"/dev/tty\")\n")

	// P3-8: ~/.kcli writable only when plugin declares fs-write or fs-write:kcli.
	// Plugins with only k8s-api + fs-read cannot write to ~/.kcli.
	if permissionsAllowWriteKcli(perms) {
		if kcliHome, herr := kcliHomeDir(); herr == nil && kcliHome != "" {
			sb.WriteString(fmt.Sprintf("  (subpath %q)\n", kcliHome))
			if real, err := filepath.EvalSymlinks(kcliHome); err == nil && real != kcliHome {
				sb.WriteString(fmt.Sprintf("  (subpath %q)\n", real))
			}
		}
	}

	// OS user temp dir if different from /tmp (e.g. test environments).
	if tmp := os.TempDir(); tmp != "" {
		clean := filepath.Clean(tmp)
		if clean != "/tmp" && clean != "/private/tmp" &&
			!strings.HasPrefix(clean, "/var/folders") &&
			!strings.HasPrefix(clean, "/private/var/folders") {
			sb.WriteString(fmt.Sprintf("  (subpath %q)\n", clean))
		}
	}

	sb.WriteString(")\n\n")

	// ── PROCESS & IPC ─────────────────────────────────────────────────────────
	sb.WriteString("; Process management\n")
	sb.WriteString("(allow process-exec (subpath \"/\"))\n")
	sb.WriteString("(allow process-fork)\n")
	sb.WriteString("(allow signal (target self))\n")
	sb.WriteString("(allow sysctl-read)\n")
	sb.WriteString("(allow mach-lookup)\n\n")

	// ── NETWORKING ────────────────────────────────────────────────────────────
	// Loopback (127.0.0.1, ::1) is always allowed — needed for local K8s proxy.
	sb.WriteString("; Loopback networking\n")
	sb.WriteString("(allow network-outbound (local tcp))\n")
	sb.WriteString("(allow network-inbound (local tcp))\n")
	sb.WriteString("(allow network-bind (local tcp))\n\n")

	// Outbound to remote hosts — gated on manifest network: permission.
	if allowNetwork {
		sb.WriteString("; External network outbound (declared by plugin manifest)\n")
		sb.WriteString("(allow network-outbound\n")
		sb.WriteString("  (remote tcp \"*:80\")\n")
		sb.WriteString("  (remote tcp \"*:443\")\n")
		sb.WriteString("  (remote tcp \"*:6443\")\n")
		sb.WriteString("  (remote tcp \"*:8443\"))\n")
	} else {
		sb.WriteString("; External network outbound: DENIED\n")
		sb.WriteString("; (plugin did not declare network:* permission)\n")
	}

	policy := sb.String()
	return SandboxProfile{
		Platform:   sandboxPlatform,
		Available:  true,
		PolicyText: policy,
		wrapArgs:   []string{"sandbox-exec", "-p", policy},
	}
}
