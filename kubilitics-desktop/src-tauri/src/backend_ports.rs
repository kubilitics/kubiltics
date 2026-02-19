// Single source of truth for backend ports (aligns with kubilitics-backend default 819 and kubilitics-ai 8081).
// Used by sidecar (spawn env, health checks) and commands (connectivity, get_desktop_info).
//
// Port 819 is valid: IANA/RFC 6335 allow 0-65535; 3-digit ports (e.g. 80, 443, 819) are valid.
// No requirement for 4-digit ports; Docker/Kubernetes accept any valid port number.

pub const BACKEND_PORT: u16 = 819;
pub const AI_BACKEND_PORT: u16 = 8081;
