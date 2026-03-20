package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForSessions(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			token_id TEXT NOT NULL UNIQUE,
			device_info TEXT,
			ip_address TEXT,
			user_agent TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_activity DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestCreateSession(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	tokenID := "token-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	session := &models.Session{
		ID:          uuid.New().String(),
		UserID:      userID,
		TokenID:     tokenID,
		IPAddress:   "192.168.1.100",
		UserAgent:   "test-agent",
		CreatedAt:   time.Now(),
		LastActivity: time.Now(),
		ExpiresAt:   expiresAt,
	}

	err := repo.CreateSession(context.Background(), session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}
}

func TestCreateSession_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	tokenID := "token-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	session := &models.Session{
		UserID:      userID,
		TokenID:     tokenID,
		CreatedAt:   time.Now(),
		LastActivity: time.Now(),
		ExpiresAt:   expiresAt,
	}

	err := repo.CreateSession(context.Background(), session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}
	if session.ID == "" {
		t.Error("Session ID should be auto-generated")
	}
}

func TestGetSessionByTokenID(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	tokenID := "token-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	session := &models.Session{
		ID:          uuid.New().String(),
		UserID:      userID,
		TokenID:     tokenID,
		CreatedAt:   time.Now(),
		LastActivity: time.Now(),
		ExpiresAt:   expiresAt,
	}
	repo.CreateSession(context.Background(), session)

	retrieved, err := repo.GetSessionByTokenID(context.Background(), tokenID)
	if err != nil {
		t.Fatalf("Failed to get session: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Session should exist")
	}
	if retrieved.TokenID != tokenID {
		t.Errorf("Expected token ID '%s', got '%s'", tokenID, retrieved.TokenID)
	}
}

func TestUpdateSessionActivity(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	sessionID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"
	expiresAt := time.Now().Add(24 * time.Hour)
	originalActivity := time.Now().Add(-1 * time.Hour)

	session := &models.Session{
		ID:          sessionID,
		UserID:      userID,
		TokenID:     tokenID,
		CreatedAt:   time.Now(),
		LastActivity: originalActivity,
		ExpiresAt:   expiresAt,
	}
	repo.CreateSession(context.Background(), session)

	err := repo.UpdateSessionActivity(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("Failed to update session activity: %v", err)
	}

	retrieved, _ := repo.GetSessionByTokenID(context.Background(), tokenID)
	if retrieved.LastActivity.Before(originalActivity) {
		t.Error("Last activity should be updated")
	}
}

func TestListUserSessions(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	// Create multiple sessions
	for i := 0; i < 3; i++ {
		session := &models.Session{
			ID:          uuid.New().String(),
			UserID:      userID,
			TokenID:     "token-" + string(rune('0'+i)),
			CreatedAt:   time.Now(),
			LastActivity: time.Now(),
			ExpiresAt:   expiresAt,
		}
		repo.CreateSession(context.Background(), session)
	}

	sessions, err := repo.ListUserSessions(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to list user sessions: %v", err)
	}
	if len(sessions) != 3 {
		t.Errorf("Expected 3 sessions, got %d", len(sessions))
	}
}

func TestDeleteSession(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	sessionID := uuid.New().String()
	userID := "user-123"
	tokenID := "token-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	session := &models.Session{
		ID:          sessionID,
		UserID:      userID,
		TokenID:     tokenID,
		CreatedAt:   time.Now(),
		LastActivity: time.Now(),
		ExpiresAt:   expiresAt,
	}
	repo.CreateSession(context.Background(), session)

	err := repo.DeleteSession(context.Background(), sessionID)
	if err != nil {
		t.Fatalf("Failed to delete session: %v", err)
	}

	retrieved, _ := repo.GetSessionByTokenID(context.Background(), tokenID)
	if retrieved != nil {
		t.Error("Session should be deleted")
	}
}

func TestDeleteUserSessions(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	// Create multiple sessions
	for i := 0; i < 3; i++ {
		session := &models.Session{
			ID:          uuid.New().String(),
			UserID:      userID,
			TokenID:     "token-" + string(rune('0'+i)),
			CreatedAt:   time.Now(),
			LastActivity: time.Now(),
			ExpiresAt:   expiresAt,
		}
		repo.CreateSession(context.Background(), session)
	}

	err := repo.DeleteUserSessions(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to delete user sessions: %v", err)
	}

	sessions, _ := repo.ListUserSessions(context.Background(), userID)
	if len(sessions) != 0 {
		t.Errorf("Expected 0 sessions, got %d", len(sessions))
	}
}

func TestCountUserSessions(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	// Create multiple sessions
	for i := 0; i < 5; i++ {
		session := &models.Session{
			ID:          uuid.New().String(),
			UserID:      userID,
			TokenID:     "token-" + string(rune('0'+i)),
			CreatedAt:   time.Now(),
			LastActivity: time.Now(),
			ExpiresAt:   expiresAt,
		}
		repo.CreateSession(context.Background(), session)
	}

	count, err := repo.CountUserSessions(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to count user sessions: %v", err)
	}
	if count != 5 {
		t.Errorf("Expected 5 sessions, got %d", count)
	}
}

func TestGetOldestUserSession(t *testing.T) {
	repo := setupTestRepoForSessions(t)
	defer repo.Close()

	userID := "user-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	// Create sessions with different creation times
	for i := 0; i < 3; i++ {
		session := &models.Session{
			ID:          uuid.New().String(),
			UserID:      userID,
			TokenID:     "token-" + string(rune('0'+i)),
			CreatedAt:   time.Now().Add(time.Duration(i) * time.Hour),
			LastActivity: time.Now(),
			ExpiresAt:   expiresAt,
		}
		repo.CreateSession(context.Background(), session)
	}

	oldest, err := repo.GetOldestUserSession(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to get oldest session: %v", err)
	}
	if oldest == nil {
		t.Fatal("Oldest session should exist")
	}
	if oldest.TokenID != "token-0" {
		t.Errorf("Expected oldest session token 'token-0', got '%s'", oldest.TokenID)
	}
}
