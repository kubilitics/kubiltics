// Single source of truth for backend ports (aligns with kubilitics-backend default 8190).
// Used by sidecar (spawn env, health checks) and commands (connectivity, get_desktop_info).
//
// Port 8190 is unprivileged (>1024), allowing the backend to run as non-root in containers.

pub const BACKEND_PORT: u16 = 8190;
