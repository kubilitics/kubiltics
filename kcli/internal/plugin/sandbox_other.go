//go:build !darwin && !linux

package plugin

import "runtime"

const sandboxPlatform = runtime.GOOS

// buildOSSandboxProfile returns a no-op SandboxProfile for platforms where
// OS-level plugin sandboxing is not yet implemented (Windows, FreeBSD, etc.).
//
// On these platforms the plugin executes with the full privileges of the
// calling user.  Roadmap:
//   - Windows: Job Objects with restricted token (planned P2-2 follow-up)
//   - FreeBSD:  Capsicum (planned)
func buildOSSandboxProfile(name, binPath string, m *Manifest) SandboxProfile {
	return SandboxProfile{
		Platform:  sandboxPlatform,
		Available: false,
		PolicyText: "OS-level plugin sandboxing is not available on " + sandboxPlatform + ".\n" +
			"Plugin '" + name + "' will run with your full user privileges.\n" +
			"Only install plugins from trusted sources.",
	}
}
