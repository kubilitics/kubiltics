package models

import "time"

// AuthEvent represents an authentication event for audit logging (BE-AUTH-002).
type AuthEvent struct {
	ID        string     `json:"id" db:"id"`
	UserID    *string    `json:"user_id,omitempty" db:"user_id"`
	Username  string     `json:"username" db:"username"`
	EventType string     `json:"event_type" db:"event_type"` // login_success, login_failure, logout, password_change, account_locked, account_unlocked
	IPAddress string     `json:"ip_address" db:"ip_address"`
	UserAgent string     `json:"user_agent,omitempty" db:"user_agent"`
	Timestamp time.Time  `json:"timestamp" db:"timestamp"`
	Details   string     `json:"details,omitempty" db:"details"` // JSON for additional context
}
