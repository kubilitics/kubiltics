package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForTokenBlacklist(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS token_blacklist (
			id TEXT PRIMARY KEY,
			token_id TEXT NOT NULL UNIQUE,
			user_id TEXT NOT NULL,
			revoked_at DATETIME NOT NULL,
			expires_at DATETIME NOT NULL,
			reason TEXT
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestCreateTokenBlacklistEntry(t *testing.T) {
	repo := setupTestRepoForTokenBlacklist(t)
	defer repo.Close()

	tokenID := "token-123"
	userID := "user-123"
	revokedAt := time.Now()
	expiresAt := time.Now().Add(24 * time.Hour)
	reason := "User logout"

	entry := &models.TokenBlacklistEntry{
		ID:        uuid.New().String(),
		TokenID:   tokenID,
		UserID:    userID,
		RevokedAt: revokedAt,
		ExpiresAt: expiresAt,
		Reason:    reason,
	}

	err := repo.CreateTokenBlacklistEntry(context.Background(), entry)
	if err != nil {
		t.Fatalf("Failed to create token blacklist entry: %v", err)
	}
}

func TestCreateTokenBlacklistEntry_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForTokenBlacklist(t)
	defer repo.Close()

	tokenID := "token-123"
	userID := "user-123"
	revokedAt := time.Now()
	expiresAt := time.Now().Add(24 * time.Hour)

	entry := &models.TokenBlacklistEntry{
		TokenID:   tokenID,
		UserID:    userID,
		RevokedAt: revokedAt,
		ExpiresAt: expiresAt,
	}

	err := repo.CreateTokenBlacklistEntry(context.Background(), entry)
	if err != nil {
		t.Fatalf("Failed to create token blacklist entry: %v", err)
	}
	if entry.ID == "" {
		t.Error("Token blacklist entry ID should be auto-generated")
	}
}

func TestIsTokenBlacklisted_True(t *testing.T) {
	repo := setupTestRepoForTokenBlacklist(t)
	defer repo.Close()

	tokenID := "token-123"
	userID := "user-123"
	revokedAt := time.Now()
	expiresAt := time.Now().Add(24 * time.Hour)

	entry := &models.TokenBlacklistEntry{
		ID:        uuid.New().String(),
		TokenID:   tokenID,
		UserID:    userID,
		RevokedAt: revokedAt,
		ExpiresAt: expiresAt,
	}
	repo.CreateTokenBlacklistEntry(context.Background(), entry)

	isBlacklisted, err := repo.IsTokenBlacklisted(context.Background(), tokenID)
	if err != nil {
		t.Fatalf("Failed to check token blacklist: %v", err)
	}
	if !isBlacklisted {
		t.Error("Token should be blacklisted")
	}
}

func TestIsTokenBlacklisted_False(t *testing.T) {
	repo := setupTestRepoForTokenBlacklist(t)
	defer repo.Close()

	isBlacklisted, err := repo.IsTokenBlacklisted(context.Background(), "nonexistent-token")
	if err != nil {
		t.Fatalf("Failed to check token blacklist: %v", err)
	}
	if isBlacklisted {
		t.Error("Token should not be blacklisted")
	}
}

func TestIsTokenBlacklisted_Expired(t *testing.T) {
	repo := setupTestRepoForTokenBlacklist(t)
	defer repo.Close()

	tokenID := "token-123"
	userID := "user-123"
	revokedAt := time.Now().Add(-48 * time.Hour)
	expiresAt := time.Now().Add(-24 * time.Hour) // Expired

	entry := &models.TokenBlacklistEntry{
		ID:        uuid.New().String(),
		TokenID:   tokenID,
		UserID:    userID,
		RevokedAt: revokedAt,
		ExpiresAt: expiresAt,
	}
	repo.CreateTokenBlacklistEntry(context.Background(), entry)

	isBlacklisted, err := repo.IsTokenBlacklisted(context.Background(), tokenID)
	if err != nil {
		t.Fatalf("Failed to check token blacklist: %v", err)
	}
	if isBlacklisted {
		t.Error("Expired token should not be considered blacklisted")
	}
}
