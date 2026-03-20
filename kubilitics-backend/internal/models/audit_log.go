package models

import "time"

// AuditLogEntry represents a single audit log record (BE-SEC-002).
// Append-only: no UPDATE or DELETE on audit records.
// Phase 6: Enhanced with session_id, device_info, geolocation, risk_score, correlation_id
type AuditLogEntry struct {
	ID               string     `json:"id" db:"id"`
	Timestamp        time.Time  `json:"timestamp" db:"timestamp"`
	UserID           *string    `json:"user_id,omitempty" db:"user_id"`
	Username         string     `json:"username" db:"username"`
	ClusterID        *string    `json:"cluster_id,omitempty" db:"cluster_id"`
	Action           string     `json:"action" db:"action"`
	ResourceKind     *string    `json:"resource_kind,omitempty" db:"resource_kind"`
	ResourceNamespace *string   `json:"resource_namespace,omitempty" db:"resource_namespace"`
	ResourceName     *string    `json:"resource_name,omitempty" db:"resource_name"`
	StatusCode       *int       `json:"status_code,omitempty" db:"status_code"`
	RequestIP        string     `json:"request_ip" db:"request_ip"`
	Details          string     `json:"details,omitempty" db:"details"`
	// Phase 6: Enhanced fields
	SessionID        *string    `json:"session_id,omitempty" db:"session_id"`
	DeviceInfo       *string    `json:"device_info,omitempty" db:"device_info"`
	Geolocation      *string    `json:"geolocation,omitempty" db:"geolocation"` // Country/City from IP
	RiskScore        *int       `json:"risk_score,omitempty" db:"risk_score"` // 0-100
	CorrelationID    *string    `json:"correlation_id,omitempty" db:"correlation_id"` // Links related events
}
