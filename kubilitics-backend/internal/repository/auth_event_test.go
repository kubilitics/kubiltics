package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForAuthEvents(t *testing.T) *SQLiteRepository {
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
		CREATE TABLE IF NOT EXISTS auth_events (
			id TEXT PRIMARY KEY,
			user_id TEXT,
			username TEXT NOT NULL,
			event_type TEXT NOT NULL,
			ip_address TEXT NOT NULL,
			user_agent TEXT,
			timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			details TEXT,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func createTestUserForEvents(t *testing.T, repo *SQLiteRepository) string {
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

func TestCreateAuthEvent(t *testing.T) {
	repo := setupTestRepoForAuthEvents(t)
	defer repo.Close()
	userID := createTestUserForEvents(t, repo)

	event := &models.AuthEvent{
		ID:        uuid.New().String(),
		UserID:    &userID,
		Username:  "testuser",
		EventType: "login_success",
		IPAddress: "192.168.1.100",
		UserAgent: "test-agent",
		Timestamp: time.Now(),
		Details:   "Login successful",
	}

	err := repo.CreateAuthEvent(context.Background(), event)
	if err != nil {
		t.Fatalf("Failed to create auth event: %v", err)
	}
}

func TestCreateAuthEvent_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForAuthEvents(t)
	defer repo.Close()
	userID := createTestUserForEvents(t, repo)

	event := &models.AuthEvent{
		UserID:    &userID,
		Username:  "testuser",
		EventType: "login_success",
		IPAddress: "192.168.1.100",
		Timestamp: time.Now(),
	}

	err := repo.CreateAuthEvent(context.Background(), event)
	if err != nil {
		t.Fatalf("Failed to create auth event: %v", err)
	}
	if event.ID == "" {
		t.Error("Event ID should be auto-generated")
	}
}

func TestListAuthEvents_ByUserID(t *testing.T) {
	repo := setupTestRepoForAuthEvents(t)
	defer repo.Close()
	userID := createTestUserForEvents(t, repo)

	// Create multiple events
	for i := 0; i < 3; i++ {
		event := &models.AuthEvent{
			ID:        uuid.New().String(),
			UserID:    &userID,
			Username:  "testuser",
			EventType: "login_success",
			IPAddress: "192.168.1.100",
			Timestamp: time.Now(),
		}
		repo.CreateAuthEvent(context.Background(), event)
	}

	userIDPtr := &userID
	events, err := repo.ListAuthEvents(context.Background(), userIDPtr, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list auth events: %v", err)
	}
	if len(events) != 3 {
		t.Errorf("Expected 3 events, got %d", len(events))
	}
}

func TestListAuthEvents_ByEventType(t *testing.T) {
	repo := setupTestRepoForAuthEvents(t)
	defer repo.Close()
	userID := createTestUserForEvents(t, repo)

	// Create different event types
	event1 := &models.AuthEvent{
		ID:        uuid.New().String(),
		UserID:    &userID,
		Username:  "testuser",
		EventType: "login_success",
		IPAddress: "192.168.1.100",
		Timestamp: time.Now(),
	}
	repo.CreateAuthEvent(context.Background(), event1)

	event2 := &models.AuthEvent{
		ID:        uuid.New().String(),
		UserID:    &userID,
		Username:  "testuser",
		EventType: "login_failure",
		IPAddress: "192.168.1.100",
		Timestamp: time.Now(),
	}
	repo.CreateAuthEvent(context.Background(), event2)

	eventType := "login_success"
	events, err := repo.ListAuthEvents(context.Background(), nil, &eventType, 10)
	if err != nil {
		t.Fatalf("Failed to list auth events: %v", err)
	}
	if len(events) != 1 {
		t.Errorf("Expected 1 login_success event, got %d", len(events))
	}
	if events[0].EventType != "login_success" {
		t.Errorf("Expected event type 'login_success', got '%s'", events[0].EventType)
	}
}

func TestListAuthEvents_WithLimit(t *testing.T) {
	repo := setupTestRepoForAuthEvents(t)
	defer repo.Close()
	userID := createTestUserForEvents(t, repo)

	// Create 5 events
	for i := 0; i < 5; i++ {
		event := &models.AuthEvent{
			ID:        uuid.New().String(),
			UserID:    &userID,
			Username:  "testuser",
			EventType: "login_success",
			IPAddress: "192.168.1.100",
			Timestamp: time.Now(),
		}
		repo.CreateAuthEvent(context.Background(), event)
	}

	events, err := repo.ListAuthEvents(context.Background(), nil, nil, 3)
	if err != nil {
		t.Fatalf("Failed to list auth events: %v", err)
	}
	if len(events) > 3 {
		t.Errorf("Expected at most 3 events, got %d", len(events))
	}
}

func TestListAuthEvents_NoUserID(t *testing.T) {
	repo := setupTestRepoForAuthEvents(t)
	defer repo.Close()

	event := &models.AuthEvent{
		ID:        uuid.New().String(),
		UserID:    nil,
		Username:  "unknown",
		EventType: "login_failure",
		IPAddress: "192.168.1.100",
		Timestamp: time.Now(),
	}
	repo.CreateAuthEvent(context.Background(), event)

	events, err := repo.ListAuthEvents(context.Background(), nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list auth events: %v", err)
	}
	if len(events) == 0 {
		t.Error("Expected at least 1 event")
	}
}
