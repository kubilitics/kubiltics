package models

import "time"

// APIKey represents an API key for CLI authentication (BE-AUTH-003).
type APIKey struct {
	ID        string     `json:"id" db:"id"`
	UserID    string     `json:"user_id" db:"user_id"`
	KeyHash   string     `json:"-" db:"key_hash"`       // Never expose hash in JSON
	KeyPrefix string     `json:"-" db:"key_prefix"`     // SHA-256 prefix for O(1) lookup (8 hex chars)
	Name      string     `json:"name" db:"name"`
	LastUsed  *time.Time `json:"last_used,omitempty" db:"last_used"`
	ExpiresAt *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}

// IsExpired returns true if the API key has expired.
func (k *APIKey) IsExpired() bool {
	if k.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*k.ExpiresAt)
}
