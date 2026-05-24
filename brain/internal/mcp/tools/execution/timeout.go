package execution

import "time"

// ExecutionTimeout returns the maximum allowed wall-clock time for a
// destructive execution tool, keyed by RequiredAutonomyLevel.
//
// Level 2 — restart_pod: 30 s  (fast — just a pod delete)
// Level 3 — scale/cordon/rollback/update_limits: 60 s
// Level 4 — drain/hpa_scale: 120 s (drain can take time)
// Level 5 — delete_resource: 45 s  (fastest confirmation expected)
// Default  — 60 s
func ExecutionTimeout(autonomyLevel int) time.Duration {
	switch autonomyLevel {
	case 2:
		return 30 * time.Second
	case 3:
		return 60 * time.Second
	case 4:
		return 120 * time.Second
	case 5:
		return 45 * time.Second
	default:
		return 60 * time.Second
	}
}
