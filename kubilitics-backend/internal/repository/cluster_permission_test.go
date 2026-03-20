package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForClusterPermissions(t *testing.T) *SQLiteRepository {
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
		CREATE TABLE IF NOT EXISTS cluster_permissions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, cluster_id)
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func createTestUserForPerms(t *testing.T, repo *SQLiteRepository) string {
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

func TestCreateClusterPermission(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID := createTestUserForPerms(t, repo)

	cp := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}

	err := repo.CreateClusterPermission(context.Background(), cp)
	if err != nil {
		t.Fatalf("Failed to create cluster permission: %v", err)
	}
}

func TestGetClusterPermission(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID := createTestUserForPerms(t, repo)

	cp := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateClusterPermission(context.Background(), cp)

	retrieved, err := repo.GetClusterPermission(context.Background(), userID, "cluster-123")
	if err != nil {
		t.Fatalf("Failed to get cluster permission: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Cluster permission should exist")
	}
	if retrieved.Role != auth.RoleOperator {
		t.Errorf("Expected role 'operator', got '%s'", retrieved.Role)
	}
}

func TestGetClusterPermission_NotFound(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID := createTestUserForPerms(t, repo)

	retrieved, err := repo.GetClusterPermission(context.Background(), userID, "nonexistent")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if retrieved != nil {
		t.Error("Cluster permission should not exist")
	}
}

func TestUpdateClusterPermission(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID := createTestUserForPerms(t, repo)

	cp := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Role:      auth.RoleViewer,
		CreatedAt: time.Now(),
	}
	repo.CreateClusterPermission(context.Background(), cp)

	cp.Role = auth.RoleAdmin
	err := repo.UpdateClusterPermission(context.Background(), cp)
	if err != nil {
		t.Fatalf("Failed to update cluster permission: %v", err)
	}

	retrieved, _ := repo.GetClusterPermission(context.Background(), userID, "cluster-123")
	if retrieved.Role != auth.RoleAdmin {
		t.Errorf("Expected role 'admin', got '%s'", retrieved.Role)
	}
}

func TestDeleteClusterPermission(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID := createTestUserForPerms(t, repo)

	cp := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateClusterPermission(context.Background(), cp)

	err := repo.DeleteClusterPermission(context.Background(), userID, "cluster-123")
	if err != nil {
		t.Fatalf("Failed to delete cluster permission: %v", err)
	}

	retrieved, _ := repo.GetClusterPermission(context.Background(), userID, "cluster-123")
	if retrieved != nil {
		t.Error("Cluster permission should be deleted")
	}
}

func TestListClusterPermissionsByUser(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID := createTestUserForPerms(t, repo)

	// Create multiple permissions
	for i := 0; i < 3; i++ {
		cp := &models.ClusterPermission{
			ID:        uuid.New().String(),
			UserID:    userID,
			ClusterID: "cluster-" + string(rune('0'+i)),
			Role:      auth.RoleViewer,
			CreatedAt: time.Now(),
		}
		repo.CreateClusterPermission(context.Background(), cp)
	}

	perms, err := repo.ListClusterPermissionsByUser(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to list cluster permissions: %v", err)
	}
	if len(perms) != 3 {
		t.Errorf("Expected 3 permissions, got %d", len(perms))
	}
}

func TestListClusterPermissionsByCluster(t *testing.T) {
	repo := setupTestRepoForClusterPermissions(t)
	defer repo.Close()
	userID1 := createTestUser(t, repo)
	
	// Create second user
	user2 := &models.User{
		ID:           uuid.New().String(),
		Username:     "testuser2",
		PasswordHash: "hashedpassword",
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user2)
	userID2 := user2.ID

	clusterID := "cluster-123"
	
	// Create permissions for same cluster
	cp1 := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID1,
		ClusterID: clusterID,
		Role:      auth.RoleViewer,
		CreatedAt: time.Now(),
	}
	repo.CreateClusterPermission(context.Background(), cp1)

	cp2 := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID2,
		ClusterID: clusterID,
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateClusterPermission(context.Background(), cp2)

	perms, err := repo.ListClusterPermissionsByCluster(context.Background(), clusterID)
	if err != nil {
		t.Fatalf("Failed to list cluster permissions: %v", err)
	}
	if len(perms) != 2 {
		t.Errorf("Expected 2 permissions, got %d", len(perms))
	}
}
