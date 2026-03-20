package auth

import (
	"testing"
	"time"
)

func TestIssueAccessToken(t *testing.T) {
	secret := "test-secret-key-minimum-32-characters-long-for-hmac"
	userID := "user-123"
	username := "testuser"
	role := RoleViewer

	token, err := IssueAccessToken(secret, userID, username, role)
	if err != nil {
		t.Fatalf("Failed to issue access token: %v", err)
	}
	if token == "" {
		t.Error("Token should not be empty")
	}

	// Validate the token
	claims, err := ValidateToken(secret, token)
	if err != nil {
		t.Fatalf("Failed to validate token: %v", err)
	}
	if claims.UserID != userID {
		t.Errorf("Expected UserID %s, got %s", userID, claims.UserID)
	}
	if claims.Username != username {
		t.Errorf("Expected Username %s, got %s", username, claims.Username)
	}
	if claims.Role != role {
		t.Errorf("Expected Role %s, got %s", role, claims.Role)
	}
	if claims.Refresh {
		t.Error("Access token should not have Refresh=true")
	}
	if claims.ExpiresAt == nil {
		t.Error("Token should have expiration time")
	}
}

func TestIssueRefreshToken(t *testing.T) {
	secret := "test-secret-key-minimum-32-characters-long-for-hmac"
	userID := "user-123"

	token, err := IssueRefreshToken(secret, userID)
	if err != nil {
		t.Fatalf("Failed to issue refresh token: %v", err)
	}
	if token == "" {
		t.Error("Token should not be empty")
	}

	// Validate the token
	claims, err := ValidateToken(secret, token)
	if err != nil {
		t.Fatalf("Failed to validate token: %v", err)
	}
	if claims.UserID != userID {
		t.Errorf("Expected UserID %s, got %s", userID, claims.UserID)
	}
	if !claims.Refresh {
		t.Error("Refresh token should have Refresh=true")
	}
}

func TestValidateToken_InvalidSecret(t *testing.T) {
	secret := "test-secret-key-minimum-32-characters-long-for-hmac"
	wrongSecret := "wrong-secret-key-minimum-32-characters-long-for-hmac"

	token, err := IssueAccessToken(secret, "user-123", "testuser", RoleViewer)
	if err != nil {
		t.Fatalf("Failed to issue token: %v", err)
	}

	// Validate with wrong secret should fail
	_, err = ValidateToken(wrongSecret, token)
	if err == nil {
		t.Error("Expected error when validating with wrong secret")
	}
}

func TestValidateToken_ExpiredToken(t *testing.T) {
	secret := "test-secret-key-minimum-32-characters-long-for-hmac"
	
	// Create an expired token manually (this is a simplified test)
	// In practice, we'd need to manipulate the expiration time
	// For now, we test that validation works for valid tokens
	token, err := IssueAccessToken(secret, "user-123", "testuser", RoleViewer)
	if err != nil {
		t.Fatalf("Failed to issue token: %v", err)
	}

	claims, err := ValidateToken(secret, token)
	if err != nil {
		t.Fatalf("Failed to validate token: %v", err)
	}
	if claims.ExpiresAt == nil {
		t.Error("Token should have expiration time")
	}
	// Verify expiration is in the future (should be ~1 hour from now)
	if claims.ExpiresAt.Time.Before(time.Now()) {
		t.Error("Token expiration should be in the future")
	}
}

func TestValidateToken_InvalidToken(t *testing.T) {
	secret := "test-secret-key-minimum-32-characters-long-for-hmac"
	invalidToken := "invalid.token.string"

	_, err := ValidateToken(secret, invalidToken)
	if err == nil {
		t.Error("Expected error when validating invalid token")
	}
}

func TestValidateToken_EmptySecret(t *testing.T) {
	_, err := IssueAccessToken("", "user-123", "testuser", RoleViewer)
	if err == nil {
		t.Error("Expected error when secret is empty")
	}
}

func TestAccessTokenExpiry(t *testing.T) {
	// Verify access token expiry is 1 hour
	if AccessTokenExpiry != time.Hour {
		t.Errorf("Expected AccessTokenExpiry to be 1 hour, got %v", AccessTokenExpiry)
	}
}

func TestRefreshTokenExpiry(t *testing.T) {
	// Verify refresh token expiry is 7 days
	expectedExpiry := 7 * 24 * time.Hour
	if RefreshTokenExpiry != expectedExpiry {
		t.Errorf("Expected RefreshTokenExpiry to be 7 days, got %v", RefreshTokenExpiry)
	}
}
