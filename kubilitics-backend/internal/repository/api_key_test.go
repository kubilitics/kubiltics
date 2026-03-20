package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForAPIKeys(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			key_hash TEXT NOT NULL,
			key_prefix TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			last_used DATETIME,
			expires_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func createTestUser(t *testing.T, repo *SQLiteRepository) string {
	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	if err := repo.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}
	return user.ID
}

func TestCreateAPIKey(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	_, hash, err := auth.GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test API Key",
		CreatedAt: time.Now(),
	}

	err = repo.CreateAPIKey(context.Background(), apiKey)
	if err != nil {
		t.Fatalf("Failed to create API key: %v", err)
	}
}

func TestCreateAPIKey_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	_, hash, err := auth.GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	apiKey := &models.APIKey{
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test API Key",
		CreatedAt: time.Now(),
	}

	err = repo.CreateAPIKey(context.Background(), apiKey)
	if err != nil {
		t.Fatalf("Failed to create API key: %v", err)
	}
	if apiKey.ID == "" {
		t.Error("API key ID should be auto-generated")
	}
}

func TestGetAPIKeyByHash(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	_, hash, err := auth.GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test API Key",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)

	retrieved, err := repo.GetAPIKeyByHash(context.Background(), hash)
	if err != nil {
		t.Fatalf("Failed to get API key: %v", err)
	}
	if retrieved == nil {
		t.Fatal("API key should exist")
	}
	if retrieved.KeyHash != hash {
		t.Errorf("Expected hash '%s', got '%s'", hash, retrieved.KeyHash)
	}
}

func TestGetAPIKeyByHash_NotFound(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()

	retrieved, err := repo.GetAPIKeyByHash(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if retrieved != nil {
		t.Error("API key should not exist")
	}
}

func TestListAPIKeysByUser(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	// Create multiple API keys
	for i := 0; i < 3; i++ {
		_, hash, _ := auth.GenerateAPIKey()
		apiKey := &models.APIKey{
			ID:        uuid.New().String(),
			UserID:    userID,
			KeyHash:   hash,
			Name:      "Test API Key " + string(rune('0'+i)),
			CreatedAt: time.Now(),
		}
		repo.CreateAPIKey(context.Background(), apiKey)
	}

	keys, err := repo.ListAPIKeysByUser(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to list API keys: %v", err)
	}
	if len(keys) != 3 {
		t.Errorf("Expected 3 API keys, got %d", len(keys))
	}
}

func TestUpdateAPIKeyLastUsed(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	_, hash, _ := auth.GenerateAPIKey()
	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test API Key",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)

	err := repo.UpdateAPIKeyLastUsed(context.Background(), apiKey.ID)
	if err != nil {
		t.Fatalf("Failed to update last used: %v", err)
	}

	retrieved, _ := repo.GetAPIKeyByHash(context.Background(), hash)
	if retrieved.LastUsed == nil {
		t.Error("Last used should be set")
	}
}

func TestDeleteAPIKey(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	_, hash, _ := auth.GenerateAPIKey()
	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test API Key",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)

	err := repo.DeleteAPIKey(context.Background(), apiKey.ID)
	if err != nil {
		t.Fatalf("Failed to delete API key: %v", err)
	}

	retrieved, _ := repo.GetAPIKeyByHash(context.Background(), hash)
	if retrieved != nil {
		t.Error("API key should be deleted")
	}
}

func TestFindAPIKeyByPlaintext(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	plaintext, hash, err := auth.GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		KeyPrefix: auth.APIKeyPrefix(plaintext),
		Name:      "Test API Key",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)

	retrieved, err := repo.FindAPIKeyByPlaintext(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("Failed to find API key: %v", err)
	}
	if retrieved == nil {
		t.Fatal("API key should be found")
	}
	if retrieved.KeyHash != hash {
		t.Errorf("Expected hash '%s', got '%s'", hash, retrieved.KeyHash)
	}
}

func TestFindAPIKeyByPlaintext_LegacyBackfill(t *testing.T) {
	// Tests that legacy keys (without prefix) are found via fallback scan
	// and automatically backfilled with the prefix for future lookups.
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	plaintext, hash, err := auth.GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	// Create key without prefix (simulates pre-migration key)
	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		KeyPrefix: "", // Legacy: no prefix
		Name:      "Legacy Key",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)

	// Should still find via slow-path legacy scan
	retrieved, err := repo.FindAPIKeyByPlaintext(context.Background(), plaintext)
	if err != nil {
		t.Fatalf("Failed to find legacy API key: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Legacy API key should be found")
	}
	// Verify backfill: prefix should now be set
	if retrieved.KeyPrefix == "" {
		t.Error("KeyPrefix should be backfilled after legacy lookup")
	}
	expectedPrefix := auth.APIKeyPrefix(plaintext)
	if retrieved.KeyPrefix != expectedPrefix {
		t.Errorf("Expected backfilled prefix '%s', got '%s'", expectedPrefix, retrieved.KeyPrefix)
	}
}

func TestFindAPIKeyByPlaintext_NotFound(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()

	_, wrongPlaintext, _ := auth.GenerateAPIKey()
	retrieved, err := repo.FindAPIKeyByPlaintext(context.Background(), wrongPlaintext)
	if err == nil {
		t.Error("Expected error when key not found")
	}
	if retrieved != nil {
		t.Error("API key should not be found")
	}
}

func TestAPIKey_ExpiresAt(t *testing.T) {
	repo := setupTestRepoForAPIKeys(t)
	defer repo.Close()
	userID := createTestUser(t, repo)

	_, hash, _ := auth.GenerateAPIKey()
	expiresAt := time.Now().Add(24 * time.Hour)
	apiKey := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test API Key",
		ExpiresAt: &expiresAt,
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)

	retrieved, _ := repo.GetAPIKeyByHash(context.Background(), hash)
	if retrieved.ExpiresAt == nil {
		t.Error("ExpiresAt should be set")
	}
}
