package auth

import (
	"context"
	"testing"
)

func TestWithClaims(t *testing.T) {
	ctx := context.Background()
	claims := &Claims{
		UserID:   "user-123",
		Username: "testuser",
		Role:     RoleViewer,
	}

	ctxWithClaims := WithClaims(ctx, claims)
	if ctxWithClaims == nil {
		t.Error("Context should not be nil")
	}
}

func TestClaimsFromContext(t *testing.T) {
	ctx := context.Background()
	claims := &Claims{
		UserID:   "user-123",
		Username: "testuser",
		Role:     RoleViewer,
	}

	ctxWithClaims := WithClaims(ctx, claims)
	retrievedClaims := ClaimsFromContext(ctxWithClaims)

	if retrievedClaims == nil {
		t.Error("Claims should not be nil")
	}
	if retrievedClaims.UserID != claims.UserID {
		t.Errorf("Expected UserID %s, got %s", claims.UserID, retrievedClaims.UserID)
	}
	if retrievedClaims.Username != claims.Username {
		t.Errorf("Expected Username %s, got %s", claims.Username, retrievedClaims.Username)
	}
	if retrievedClaims.Role != claims.Role {
		t.Errorf("Expected Role %s, got %s", claims.Role, retrievedClaims.Role)
	}
}

func TestClaimsFromContext_NoClaims(t *testing.T) {
	ctx := context.Background()
	claims := ClaimsFromContext(ctx)
	if claims != nil {
		t.Error("Claims should be nil when not set in context")
	}
}
