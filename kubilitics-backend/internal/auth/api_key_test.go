package auth

import (
	"strings"
	"testing"
)

func TestGenerateAPIKey(t *testing.T) {
	plaintext, hash, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}
	if plaintext == "" {
		t.Error("API key should not be empty")
	}
	if hash == "" {
		t.Error("Hash should not be empty")
	}
	if !strings.HasPrefix(plaintext, "kub_") {
		t.Error("API key should start with 'kub_' prefix")
	}
	if len(plaintext) < 20 {
		t.Error("API key should be reasonably long")
	}
}

func TestGenerateAPIKey_Unique(t *testing.T) {
	plaintext1, _, err1 := GenerateAPIKey()
	if err1 != nil {
		t.Fatalf("Failed to generate API key: %v", err1)
	}

	plaintext2, _, err2 := GenerateAPIKey()
	if err2 != nil {
		t.Fatalf("Failed to generate API key: %v", err2)
	}

	if plaintext1 == plaintext2 {
		t.Error("Generated API keys should be unique")
	}
}

func TestCheckAPIKey(t *testing.T) {
	plaintextKey, hashedKey, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	// Check the key
	if err := CheckAPIKey(hashedKey, plaintextKey); err != nil {
		t.Error("CheckAPIKey should return nil for correct key")
	}

	// Wrong key
	if err := CheckAPIKey(hashedKey, "wrong-key"); err == nil {
		t.Error("CheckAPIKey should return error for wrong key")
	}
}

func TestCheckAPIKey_InvalidHash(t *testing.T) {
	invalidHash := "invalid-hash"
	key := "test-key"

	if err := CheckAPIKey(invalidHash, key); err == nil {
		t.Error("CheckAPIKey should return error for invalid hash")
	}
}

func TestAPIKeyPrefix_Deterministic(t *testing.T) {
	plaintext, _, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}
	prefix1 := APIKeyPrefix(plaintext)
	prefix2 := APIKeyPrefix(plaintext)
	if prefix1 != prefix2 {
		t.Errorf("APIKeyPrefix should be deterministic: got %s and %s", prefix1, prefix2)
	}
}

func TestAPIKeyPrefix_Length(t *testing.T) {
	plaintext, _, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}
	prefix := APIKeyPrefix(plaintext)
	if len(prefix) != apiKeyPrefixLen {
		t.Errorf("Expected prefix length %d, got %d: %s", apiKeyPrefixLen, len(prefix), prefix)
	}
}

func TestAPIKeyPrefix_Unique(t *testing.T) {
	plaintext1, _, _ := GenerateAPIKey()
	plaintext2, _, _ := GenerateAPIKey()
	prefix1 := APIKeyPrefix(plaintext1)
	prefix2 := APIKeyPrefix(plaintext2)
	if prefix1 == prefix2 {
		t.Error("Different API keys should have different prefixes (collision probability is ~1/2^32)")
	}
}

func TestAPIKeyPrefix_HexFormat(t *testing.T) {
	plaintext, _, _ := GenerateAPIKey()
	prefix := APIKeyPrefix(plaintext)
	for _, c := range prefix {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("Prefix should be lowercase hex, got character '%c' in %s", c, prefix)
		}
	}
}
