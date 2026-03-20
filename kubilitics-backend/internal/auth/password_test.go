package auth

import (
	"testing"
)

func TestHashPassword(t *testing.T) {
	password := "testpassword123"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	if hash == "" {
		t.Error("Hash should not be empty")
	}
	if hash == password {
		t.Error("Hash should not equal original password")
	}
}

func TestCheckPassword(t *testing.T) {
	password := "testpassword123"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}

	// Correct password
	if err := CheckPassword(hash, password); err != nil {
		t.Error("CheckPassword should return nil for correct password")
	}

	// Wrong password
	if err := CheckPassword(hash, "wrongpassword"); err == nil {
		t.Error("CheckPassword should return error for wrong password")
	}
}

func TestHashPassword_DifferentHashes(t *testing.T) {
	password := "testpassword123"
	hash1, err1 := HashPassword(password)
	if err1 != nil {
		t.Fatalf("Failed to hash password: %v", err1)
	}

	hash2, err2 := HashPassword(password)
	if err2 != nil {
		t.Fatalf("Failed to hash password: %v", err2)
	}

	// Hashes should be different (due to salt)
	if hash1 == hash2 {
		t.Error("Same password should produce different hashes (due to salt)")
	}

	// But both should verify correctly
	if err := CheckPassword(hash1, password); err != nil {
		t.Error("First hash should verify correctly")
	}
	if err := CheckPassword(hash2, password); err != nil {
		t.Error("Second hash should verify correctly")
	}
}

func TestCheckPassword_InvalidHash(t *testing.T) {
	invalidHash := "invalid-hash-format"
	password := "testpassword123"

	// Should handle invalid hash gracefully
	if err := CheckPassword(invalidHash, password); err == nil {
		t.Error("CheckPassword should return error for invalid hash")
	}
}
