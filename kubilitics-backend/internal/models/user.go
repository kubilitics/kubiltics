package models

import "time"

// User represents a dashboard user (BE-AUTH-001). Cluster access is via kubeconfig; this is UI identity.
type User struct {
	ID               string     `json:"id" db:"id"`
	Username         string     `json:"username" db:"username"`
	PasswordHash     string     `json:"-" db:"password_hash"`
	Role             string     `json:"role" db:"role"` // viewer | operator | admin
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	LastLogin        *time.Time `json:"last_login,omitempty" db:"last_login"`
	LockedUntil      *time.Time `json:"-" db:"locked_until"`
	FailedLoginCount int        `json:"-" db:"failed_login_count"` // BE-AUTH-002
	LastFailedLogin  *time.Time `json:"-" db:"last_failed_login"`  // BE-AUTH-002
	DeletedAt        *time.Time `json:"-" db:"deleted_at"`         // BE-FUNC-004: soft delete
}

// IsLocked returns true if the user is currently locked out.
func (u *User) IsLocked() bool {
	if u.LockedUntil == nil {
		return false
	}
	return time.Now().Before(*u.LockedUntil)
}

// IsDeleted returns true if the user is soft-deleted (BE-FUNC-004).
func (u *User) IsDeleted() bool {
	return u.DeletedAt != nil
}
