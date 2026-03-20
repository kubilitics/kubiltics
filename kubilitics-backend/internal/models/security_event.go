package models

import "time"

// SecurityEvent represents a security-related event (brute force, credential stuffing, etc.)
type SecurityEvent struct {
	ID           string     `json:"id" db:"id"`
	EventType    string     `json:"event_type" db:"event_type"` // brute_force, credential_stuffing, account_enumeration, suspicious_activity
	UserID       *string    `json:"user_id,omitempty" db:"user_id"`
	Username     string     `json:"username,omitempty" db:"username"`
	IPAddress    string     `json:"ip_address" db:"ip_address"`
	UserAgent    string     `json:"user_agent,omitempty" db:"user_agent"`
	ClusterID    string     `json:"cluster_id,omitempty" db:"cluster_id"`
	ResourceType string     `json:"resource_type,omitempty" db:"resource_type"`
	ResourceName string     `json:"resource_name,omitempty" db:"resource_name"`
	Action       string     `json:"action,omitempty" db:"action"`
	RiskScore    int        `json:"risk_score" db:"risk_score"` // 0-100
	Details      string     `json:"details,omitempty" db:"details"` // JSON
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
}

// IPSecurityTracking tracks security events per IP address
type IPSecurityTracking struct {
	IPAddress              string     `json:"ip_address" db:"ip_address"`
	FailedLoginCount       int        `json:"failed_login_count" db:"failed_login_count"`
	LastFailedLogin        *time.Time `json:"last_failed_login,omitempty" db:"last_failed_login"`
	AccountEnumerationCount int       `json:"account_enumeration_count" db:"account_enumeration_count"`
	LastEnumerationAttempt *time.Time `json:"last_enumeration_attempt,omitempty" db:"last_enumeration_attempt"`
	BlockedUntil           *time.Time `json:"blocked_until,omitempty" db:"blocked_until"`
	CreatedAt              time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at" db:"updated_at"`
}

// IsBlocked checks if IP is currently blocked
func (t *IPSecurityTracking) IsBlocked() bool {
	if t.BlockedUntil == nil {
		return false
	}
	return time.Now().Before(*t.BlockedUntil)
}
