package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

// apiKeyPrefixLen is the number of hex characters stored as a lookup prefix.
// 8 hex chars = 4 bytes = 2^32 possible values — effectively unique per key,
// but not enough to reconstruct the key.
const apiKeyPrefixLen = 8

// GenerateAPIKey generates a secure random API key (BE-AUTH-003).
// Returns the plaintext key (to be shown once) and its bcrypt hash.
func GenerateAPIKey() (plaintext string, hash string, err error) {
	// Generate 32 random bytes (256 bits)
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	// Encode as base64 URL-safe string (no padding)
	plaintext = base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(bytes)
	// Prefix with "kub_" for identification
	plaintext = "kub_" + plaintext
	
	// Hash using bcrypt (same as passwords)
	hash, err = HashPassword(plaintext)
	if err != nil {
		return "", "", fmt.Errorf("failed to hash API key: %w", err)
	}
	return plaintext, hash, nil
}

// CheckAPIKey verifies if a plaintext API key matches the hash.
func CheckAPIKey(hash, plaintext string) error {
	return CheckPassword(hash, plaintext)
}

// APIKeyPrefix computes a deterministic, non-secret lookup prefix for a plaintext API key.
// Uses the first 8 hex characters of SHA-256(plaintext). This enables O(1) DB lookup instead of
// O(n) bcrypt scan, while leaking only 4 bytes of the key's SHA-256 hash (insufficient to recover the key).
func APIKeyPrefix(plaintext string) string {
	h := sha256.Sum256([]byte(plaintext))
	return fmt.Sprintf("%x", h[:apiKeyPrefixLen/2]) // 4 bytes = 8 hex chars
}
