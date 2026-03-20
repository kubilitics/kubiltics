package models

import "time"

// PasswordResetToken represents a password reset token
type PasswordResetToken struct {
	ID        string     `json:"id" db:"id"`
	UserID    string     `json:"user_id" db:"user_id"`
	TokenHash string     `json:"-" db:"token_hash"` // Hashed token (never return plaintext)
	ExpiresAt time.Time  `json:"expires_at" db:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty" db:"used_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}

// IsExpired returns true if the token has expired
func (t *PasswordResetToken) IsExpired() bool {
	return time.Now().After(t.ExpiresAt)
}

// IsUsed returns true if the token has been used
func (t *PasswordResetToken) IsUsed() bool {
	return t.UsedAt != nil
}

// IsValid returns true if token is not expired and not used
func (t *PasswordResetToken) IsValid() bool {
	return !t.IsExpired() && !t.IsUsed()
}
