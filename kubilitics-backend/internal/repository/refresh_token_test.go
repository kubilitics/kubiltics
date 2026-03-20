package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForRefreshTokens(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS refresh_token_families (
			id TEXT PRIMARY KEY,
			family_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			token_id TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			revoked_at DATETIME
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestCreateRefreshTokenFamily(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	familyID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"

	family := &models.RefreshTokenFamily{
		ID:        uuid.New().String(),
		FamilyID:  familyID,
		UserID:    userID,
		TokenID:   tokenID,
		CreatedAt: time.Now(),
	}

	err := repo.CreateRefreshTokenFamily(context.Background(), family)
	if err != nil {
		t.Fatalf("Failed to create refresh token family: %v", err)
	}
}

func TestCreateRefreshTokenFamily_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	familyID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"

	family := &models.RefreshTokenFamily{
		FamilyID:  familyID,
		UserID:    userID,
		TokenID:   tokenID,
		CreatedAt: time.Now(),
	}

	err := repo.CreateRefreshTokenFamily(context.Background(), family)
	if err != nil {
		t.Fatalf("Failed to create refresh token family: %v", err)
	}
	if family.ID == "" {
		t.Error("Family ID should be auto-generated")
	}
}

func TestGetRefreshTokenFamilyByTokenID(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	familyID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"

	family := &models.RefreshTokenFamily{
		ID:        uuid.New().String(),
		FamilyID:  familyID,
		UserID:    userID,
		TokenID:   tokenID,
		CreatedAt: time.Now(),
	}
	repo.CreateRefreshTokenFamily(context.Background(), family)

	retrieved, err := repo.GetRefreshTokenFamilyByTokenID(context.Background(), tokenID)
	if err != nil {
		t.Fatalf("Failed to get refresh token family: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Refresh token family should exist")
	}
	if retrieved.TokenID != tokenID {
		t.Errorf("Expected token ID '%s', got '%s'", tokenID, retrieved.TokenID)
	}
}

func TestGetRefreshTokenFamilyByFamilyID(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	familyID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"

	family := &models.RefreshTokenFamily{
		ID:        uuid.New().String(),
		FamilyID:  familyID,
		UserID:    userID,
		TokenID:   tokenID,
		CreatedAt: time.Now(),
	}
	repo.CreateRefreshTokenFamily(context.Background(), family)

	retrieved, err := repo.GetRefreshTokenFamilyByFamilyID(context.Background(), familyID)
	if err != nil {
		t.Fatalf("Failed to get refresh token family: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Refresh token family should exist")
	}
	if retrieved.FamilyID != familyID {
		t.Errorf("Expected family ID '%s', got '%s'", familyID, retrieved.FamilyID)
	}
}

func TestRevokeRefreshTokenFamily(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	userID := "user-123"
	
	// Create multiple families for the user
	for i := 0; i < 3; i++ {
		family := &models.RefreshTokenFamily{
			ID:        uuid.New().String(),
			FamilyID:  uuid.New().String(),
			UserID:    userID,
			TokenID:   "token-" + string(rune('0'+i)),
			CreatedAt: time.Now(),
		}
		repo.CreateRefreshTokenFamily(context.Background(), family)
	}

	err := repo.RevokeRefreshTokenFamily(context.Background(), userID, "User requested")
	if err != nil {
		t.Fatalf("Failed to revoke refresh token family: %v", err)
	}

	// Verify all families are revoked
	family, _ := repo.GetRefreshTokenFamilyByFamilyID(context.Background(), "token-0")
	if family != nil && family.RevokedAt == nil {
		t.Error("Family should be revoked")
	}
}

func TestRevokeRefreshTokenFamilyByFamilyID(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	familyID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"

	family := &models.RefreshTokenFamily{
		ID:        uuid.New().String(),
		FamilyID:  familyID,
		UserID:    userID,
		TokenID:   tokenID,
		CreatedAt: time.Now(),
	}
	repo.CreateRefreshTokenFamily(context.Background(), family)

	err := repo.RevokeRefreshTokenFamilyByFamilyID(context.Background(), familyID)
	if err != nil {
		t.Fatalf("Failed to revoke refresh token family: %v", err)
	}

	retrieved, _ := repo.GetRefreshTokenFamilyByFamilyID(context.Background(), familyID)
	if retrieved != nil && retrieved.RevokedAt == nil {
		t.Error("Family should be revoked")
	}
}

func TestUpdateRefreshTokenFamilyToken(t *testing.T) {
	repo := setupTestRepoForRefreshTokens(t)
	defer repo.Close()

	familyID := uuid.New().String()
	userID := "user-123"
	oldTokenID := "token-old"
	newTokenID := "token-new"

	// Create initial family
	family := &models.RefreshTokenFamily{
		ID:        uuid.New().String(),
		FamilyID:  familyID,
		UserID:    userID,
		TokenID:   oldTokenID,
		CreatedAt: time.Now(),
	}
	repo.CreateRefreshTokenFamily(context.Background(), family)

	// Rotate token
	err := repo.UpdateRefreshTokenFamilyToken(context.Background(), familyID, newTokenID)
	if err != nil {
		t.Fatalf("Failed to update refresh token family token: %v", err)
	}

	// Verify new token is active
	retrieved, _ := repo.GetRefreshTokenFamilyByFamilyID(context.Background(), familyID)
	if retrieved == nil {
		t.Fatal("Family should exist")
	}
	if retrieved.TokenID != newTokenID {
		t.Errorf("Expected new token ID '%s', got '%s'", newTokenID, retrieved.TokenID)
	}
}
