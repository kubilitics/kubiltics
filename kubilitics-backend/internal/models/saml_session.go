package models

import "time"

// SAMLSession represents a SAML SSO session
type SAMLSession struct {
	ID              string    `json:"id" db:"id"`
	UserID          string    `json:"user_id" db:"user_id"`
	SAMLSessionIndex string   `json:"saml_session_index" db:"saml_session_index"` // SAML SessionIndex from assertion
	IdpEntityID     string    `json:"idp_entity_id" db:"idp_entity_id"`           // IdP entity ID
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	ExpiresAt       time.Time `json:"expires_at" db:"expires_at"`
}

// IsExpired returns true if the session has expired
func (s *SAMLSession) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}
