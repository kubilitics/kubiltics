package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForUsers(t *testing.T) *SQLiteRepository {
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
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_login DATETIME,
			locked_until DATETIME,
			failed_login_count INTEGER DEFAULT 0,
			last_failed_login DATETIME,
			deleted_at DATETIME
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestCreateUser(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}

	err := repo.CreateUser(context.Background(), user)
	if err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	// Verify user was created
	retrieved, err := repo.GetUserByUsername(context.Background(), "testuser")
	if err != nil {
		t.Fatalf("Failed to get user: %v", err)
	}
	if retrieved == nil {
		t.Fatal("User should exist")
	}
	if retrieved.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", retrieved.Username)
	}
	if retrieved.Role != auth.RoleViewer {
		t.Errorf("Expected role 'viewer', got '%s'", retrieved.Role)
	}
}

func TestCreateUser_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		Username:     "testuser2",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}

	err := repo.CreateUser(context.Background(), user)
	if err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}
	if user.ID == "" {
		t.Error("User ID should be auto-generated")
	}
}

func TestGetUserByUsername(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	retrieved, err := repo.GetUserByUsername(context.Background(), "testuser")
	if err != nil {
		t.Fatalf("Failed to get user: %v", err)
	}
	if retrieved == nil {
		t.Fatal("User should exist")
	}
	if retrieved.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", retrieved.Username)
	}
}

func TestGetUserByUsername_NotFound(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	retrieved, err := repo.GetUserByUsername(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if retrieved != nil {
		t.Error("User should not exist")
	}
}

func TestGetUserByID(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	userID := uuid.New().String()
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	retrieved, err := repo.GetUserByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to get user: %v", err)
	}
	if retrieved == nil {
		t.Fatal("User should exist")
	}
	if retrieved.ID != userID {
		t.Errorf("Expected ID '%s', got '%s'", userID, retrieved.ID)
	}
}

func TestUpdateUserLastLogin(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	loginTime := time.Now()
	err := repo.UpdateUserLastLogin(context.Background(), user.ID, loginTime)
	if err != nil {
		t.Fatalf("Failed to update last login: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.LastLogin == nil {
		t.Error("Last login should be set")
	}
}

func TestCountUsers(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	// Create multiple users
	for i := 0; i < 3; i++ {
		user := &models.User{
			ID:           uuid.New().String(),
			Username:     "testuser" + string(rune('0'+i)),
			PasswordHash: "hashedpassword",
			Role:         auth.RoleViewer,
			CreatedAt:    time.Now(),
		}
		repo.CreateUser(context.Background(), user)
	}

	count, err := repo.CountUsers(context.Background())
	if err != nil {
		t.Fatalf("Failed to count users: %v", err)
	}
	if count != 3 {
		t.Errorf("Expected 3 users, got %d", count)
	}
}

func TestListUsers(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	// Create multiple users
	for i := 0; i < 3; i++ {
		user := &models.User{
			ID:           uuid.New().String(),
			Username:     "testuser" + string(rune('0'+i)),
			PasswordHash: "hashedpassword",
			Role:         auth.RoleViewer,
			CreatedAt:    time.Now(),
		}
		repo.CreateUser(context.Background(), user)
	}

	users, err := repo.ListUsers(context.Background())
	if err != nil {
		t.Fatalf("Failed to list users: %v", err)
	}
	if len(users) != 3 {
		t.Errorf("Expected 3 users, got %d", len(users))
	}
}

func TestUpdateUserRole(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	err := repo.UpdateUserRole(context.Background(), user.ID, auth.RoleAdmin)
	if err != nil {
		t.Fatalf("Failed to update role: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.Role != auth.RoleAdmin {
		t.Errorf("Expected role 'admin', got '%s'", retrieved.Role)
	}
}

func TestDeleteUser_SoftDelete(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	err := repo.DeleteUser(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("Failed to delete user: %v", err)
	}

	// User should not be retrievable (soft delete)
	retrieved, err := repo.GetUserByUsername(context.Background(), "testuser")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if retrieved != nil {
		t.Error("User should be soft deleted and not retrievable")
	}

	// Count should not include deleted user
	count, _ := repo.CountUsers(context.Background())
	if count != 0 {
		t.Errorf("Expected 0 users (after soft delete), got %d", count)
	}
}

func TestIncrementFailedLogin(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	err := repo.IncrementFailedLogin(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("Failed to increment failed login: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.FailedLoginCount != 1 {
		t.Errorf("Expected failed login count 1, got %d", retrieved.FailedLoginCount)
	}
}

func TestResetFailedLogin(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)
	repo.IncrementFailedLogin(context.Background(), user.ID)

	err := repo.ResetFailedLogin(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("Failed to reset failed login: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.FailedLoginCount != 0 {
		t.Errorf("Expected failed login count 0, got %d", retrieved.FailedLoginCount)
	}
}

func TestLockUser(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	lockUntil := time.Now().Add(1 * time.Hour)
	err := repo.LockUser(context.Background(), user.ID, lockUntil)
	if err != nil {
		t.Fatalf("Failed to lock user: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.LockedUntil == nil {
		t.Error("User should be locked")
	}
}

func TestUnlockUser(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)
	repo.LockUser(context.Background(), user.ID, time.Now().Add(1*time.Hour))
	repo.IncrementFailedLogin(context.Background(), user.ID)

	err := repo.UnlockUser(context.Background(), user.ID)
	if err != nil {
		t.Fatalf("Failed to unlock user: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.LockedUntil != nil {
		t.Error("User should be unlocked")
	}
	if retrieved.FailedLoginCount != 0 {
		t.Error("Failed login count should be reset")
	}
}

func TestUpdateUserPassword(t *testing.T) {
	repo := setupTestRepoForUsers(t)
	defer repo.Close()

	user := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser",
		PasswordHash: "oldhash",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	newHash := "newhash"
	err := repo.UpdateUserPassword(context.Background(), user.ID, newHash)
	if err != nil {
		t.Fatalf("Failed to update password: %v", err)
	}

	retrieved, _ := repo.GetUserByID(context.Background(), user.ID)
	if retrieved.PasswordHash != newHash {
		t.Errorf("Expected password hash '%s', got '%s'", newHash, retrieved.PasswordHash)
	}
}
