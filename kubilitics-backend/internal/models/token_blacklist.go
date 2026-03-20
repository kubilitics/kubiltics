package models

import "time"

// TokenBlacklistEntry represents a revoked token
type TokenBlacklistEntry struct {
	ID        string    `json:"id" db:"id"`
	TokenID   string    `json:"token_id" db:"token_id"` // JWT ID (JTI)
	UserID    string    `json:"user_id" db:"user_id"`
	RevokedAt time.Time `json:"revoked_at" db:"revoked_at"`
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"`
	Reason    string    `json:"reason,omitempty" db:"reason"` // password_change, account_lock, user_deletion, manual_revoke
}

// RefreshTokenFamily represents a refresh token family for rotation
type RefreshTokenFamily struct {
	ID        string     `json:"id" db:"id"`
	FamilyID  string     `json:"family_id" db:"family_id"`
	UserID    string     `json:"user_id" db:"user_id"`
	TokenID   string     `json:"token_id" db:"token_id"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty" db:"revoked_at"`
}

// IsRevoked returns true if the family is revoked
func (f *RefreshTokenFamily) IsRevoked() bool {
	return f.RevokedAt != nil
}
