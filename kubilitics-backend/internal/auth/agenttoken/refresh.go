package agenttoken

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const refreshPrefix = "rk_live_"

// argon2id parameters (interactive profile; refresh check is rare).
const (
	argonTime    = 2
	argonMemory  = 64 * 1024 // 64 MiB
	argonThreads = 2
	argonKeyLen  = 32
	saltLen      = 16
)

func NewRefreshToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return refreshPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashRefreshToken returns "argon2id$<salt-hex>$<hash-hex>".
func HashRefreshToken(tok string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	h := argon2.IDKey([]byte(tok), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("argon2id$%s$%s", hex.EncodeToString(salt), hex.EncodeToString(h)), nil
}

func VerifyRefreshToken(tok, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != "argon2id" { return false }
	salt, err := hex.DecodeString(parts[1])
	if err != nil || len(salt) != saltLen { return false }
	want, err := hex.DecodeString(parts[2])
	if err != nil || len(want) != argonKeyLen { return false }
	got := argon2.IDKey([]byte(tok), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return subtle.ConstantTimeCompare(got, want) == 1
}
