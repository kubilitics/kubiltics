// Package types defines internal data structures shared between the AI
// supervisor, proxy, and handlers. No external imports beyond stdlib.
package types

import "time"

// SidecarState is the supervisor's process state.
type SidecarState int

const (
	StateStopped SidecarState = iota
	StateStarting
	StateReady
	StateStopping
	StateCrashed
)

func (s SidecarState) String() string {
	switch s {
	case StateStopped:
		return "stopped"
	case StateStarting:
		return "starting"
	case StateReady:
		return "ready"
	case StateStopping:
		return "stopping"
	case StateCrashed:
		return "crashed"
	default:
		return "unknown"
	}
}

// DisabledReason values surfaced to the desktop UI when AI is not usable.
const (
	DisabledReasonAIDisabled       = "ai_disabled"
	DisabledReasonNeverStarted     = "never_started"
	DisabledReasonRestartExhausted = "restart_cap_exhausted"
	DisabledReasonSpawnChanged     = "spawn_changed"
)

// SidecarStatus is the snapshot returned by Supervisor.Status() and
// surfaced via /api/v1/ai/status.
type SidecarStatus struct {
	State           SidecarState `json:"state"`
	LastError       string       `json:"last_error,omitempty"`
	RestartAttempts int          `json:"restart_attempts"`
	NextRetryAt     time.Time    `json:"next_retry_at,omitempty"`
	ActiveStreams   int          `json:"active_streams"`
	CurrentSpawnID  string       `json:"current_spawn_id,omitempty"`
	DisabledReason  string       `json:"disabled_reason,omitempty"`
}

// CapabilitiesSnapshot is the cached AICapabilities response from the
// sidecar plus a freshness timestamp.
type CapabilitiesSnapshot struct {
	Capabilities any       `json:"capabilities"`
	FetchedAt    time.Time `json:"fetched_at"`
	SpawnID      string    `json:"spawn_id"`
}
