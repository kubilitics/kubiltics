package models

import "time"

// Session represents an active user session
type Session struct {
	ID          string    `json:"id" db:"id"`
	UserID      string    `json:"user_id" db:"user_id"`
	TokenID     string    `json:"token_id" db:"token_id"` // JWT ID (JTI)
	DeviceInfo  string    `json:"device_info,omitempty" db:"device_info"`
	IPAddress   string    `json:"ip_address,omitempty" db:"ip_address"`
	UserAgent   string    `json:"user_agent,omitempty" db:"user_agent"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
	LastActivity time.Time `json:"last_activity" db:"last_activity"`
	ExpiresAt   time.Time `json:"expires_at" db:"expires_at"`
}

// IsExpired returns true if the session has expired
func (s *Session) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

// IsInactive returns true if session hasn't been active recently (configurable threshold)
func (s *Session) IsInactive(threshold time.Duration) bool {
	return time.Since(s.LastActivity) > threshold
}
