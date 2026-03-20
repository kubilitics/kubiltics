package models

import "time"

// MFATOTPSecret represents a user's MFA TOTP secret
type MFATOTPSecret struct {
	ID        string     `json:"id" db:"id"`
	UserID    string     `json:"user_id" db:"user_id"`
	Secret    string     `json:"-" db:"secret"` // Encrypted secret (never return plaintext)
	Enabled   bool       `json:"enabled" db:"enabled"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	VerifiedAt *time.Time `json:"verified_at,omitempty" db:"verified_at"`
}

// MFABackupCode represents a backup code for MFA recovery
type MFABackupCode struct {
	ID        string     `json:"id" db:"id"`
	UserID    string     `json:"user_id" db:"user_id"`
	CodeHash  string     `json:"-" db:"code_hash"` // Hashed code (never return plaintext)
	Used      bool       `json:"used" db:"used"`
	UsedAt    *time.Time `json:"used_at,omitempty" db:"used_at"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
}
