package auth

import (
	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// HashPassword returns a bcrypt hash of the password (cost 12).
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CheckPassword returns nil if password matches hash.
func CheckPassword(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}
