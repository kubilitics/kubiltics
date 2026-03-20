package mfa

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"github.com/pquerna/otp/totp"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
)

const (
	// TOTPIssuer is the issuer name shown in authenticator apps
	TOTPIssuer = "Kubilitics"
	// TOTPSecretSize is the size of the TOTP secret in bytes
	TOTPSecretSize = 20
)

// GenerateTOTPSecret generates a new TOTP secret for a user
func GenerateTOTPSecret(username string) (secret string, qrCodeDataURL string, err error) {
	// Create TOTP key - library generates secret automatically
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      TOTPIssuer,
		AccountName: username,
	})
	if err != nil {
		return "", "", fmt.Errorf("failed to generate TOTP key: %w", err)
	}

	// Get the secret from the key (base32 encoded)
	secret = key.Secret()

	// Generate QR code data URL (otpauth:// URL)
	qrCodeDataURL = key.URL()

	return secret, qrCodeDataURL, nil
}

// VerifyTOTPCode verifies a TOTP code against a secret
func VerifyTOTPCode(secret, code string) bool {
	return totp.Validate(code, secret)
}

// GenerateBackupCodes generates backup codes for account recovery
func GenerateBackupCodes(count int) ([]string, error) {
	if count <= 0 {
		count = 10
	}
	codes := make([]string, count)
	for i := 0; i < count; i++ {
		// Generate 8-character alphanumeric code
		bytes := make([]byte, 6) // 6 bytes = 8 base32 chars
		if _, err := rand.Read(bytes); err != nil {
			return nil, fmt.Errorf("failed to generate backup code: %w", err)
		}
		// Use base64 URL encoding and take first 8 chars
		code := base64.URLEncoding.EncodeToString(bytes)[:8]
		codes[i] = code
	}
	return codes, nil
}

// HashBackupCode hashes a backup code using bcrypt (same as passwords)
func HashBackupCode(code string) (string, error) {
	return auth.HashPassword(code)
}

// VerifyBackupCode verifies a backup code against a hash
func VerifyBackupCode(hash, code string) bool {
	return auth.CheckPassword(hash, code) == nil
}
