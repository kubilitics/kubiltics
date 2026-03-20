package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForNamespacePermissions(t *testing.T) *SQLiteRepository {
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
		CREATE TABLE IF NOT EXISTS namespace_permissions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			namespace TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, cluster_id, namespace)
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func createTestUserForNSPerms(t *testing.T, repo *SQLiteRepository) string {
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

func TestCreateNamespacePermission(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	perm := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Namespace: "default",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}

	err := repo.CreateNamespacePermission(context.Background(), perm)
	if err != nil {
		t.Fatalf("Failed to create namespace permission: %v", err)
	}
}

func TestCreateNamespacePermission_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	perm := &models.NamespacePermission{
		UserID:    userID,
		ClusterID: "cluster-123",
		Namespace: "default",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}

	err := repo.CreateNamespacePermission(context.Background(), perm)
	if err != nil {
		t.Fatalf("Failed to create namespace permission: %v", err)
	}
	if perm.ID == "" {
		t.Error("Permission ID should be auto-generated")
	}
}

func TestGetNamespacePermission(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	perm := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Namespace: "default",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateNamespacePermission(context.Background(), perm)

	retrieved, err := repo.GetNamespacePermission(context.Background(), userID, "cluster-123", "default")
	if err != nil {
		t.Fatalf("Failed to get namespace permission: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Namespace permission should exist")
	}
	if retrieved.Role != auth.RoleOperator {
		t.Errorf("Expected role 'operator', got '%s'", retrieved.Role)
	}
}

func TestGetNamespacePermission_NotFound(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	retrieved, err := repo.GetNamespacePermission(context.Background(), userID, "cluster-123", "nonexistent")
	// GetNamespacePermission returns error when not found (sql.ErrNoRows)
	if err == nil {
		t.Error("Expected error when namespace permission not found")
	}
	if retrieved != nil {
		t.Error("Namespace permission should not exist")
	}
}

func TestListNamespacePermissionsByUser(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	// Create multiple permissions
	for i := 0; i < 3; i++ {
		perm := &models.NamespacePermission{
			ID:        uuid.New().String(),
			UserID:    userID,
			ClusterID: "cluster-123",
			Namespace: "namespace-" + string(rune('0'+i)),
			Role:      auth.RoleViewer,
			CreatedAt: time.Now(),
		}
		repo.CreateNamespacePermission(context.Background(), perm)
	}

	perms, err := repo.ListNamespacePermissionsByUser(context.Background(), userID)
	if err != nil {
		t.Fatalf("Failed to list namespace permissions: %v", err)
	}
	if len(perms) != 3 {
		t.Errorf("Expected 3 permissions, got %d", len(perms))
	}
}

func TestListNamespacePermissionsByCluster(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID1 := createTestUserForNSPerms(t, repo)
	
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
	perm1 := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID1,
		ClusterID: clusterID,
		Namespace: "default",
		Role:      auth.RoleViewer,
		CreatedAt: time.Now(),
	}
	repo.CreateNamespacePermission(context.Background(), perm1)

	perm2 := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID2,
		ClusterID: clusterID,
		Namespace: "kube-system",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateNamespacePermission(context.Background(), perm2)

	perms, err := repo.ListNamespacePermissionsByCluster(context.Background(), clusterID)
	if err != nil {
		t.Fatalf("Failed to list namespace permissions: %v", err)
	}
	if len(perms) != 2 {
		t.Errorf("Expected 2 permissions, got %d", len(perms))
	}
}

func TestGetNamespacePermissionForResource(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	perm := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Namespace: "default",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateNamespacePermission(context.Background(), perm)

	retrieved, err := repo.GetNamespacePermissionForResource(context.Background(), userID, "cluster-123", "default")
	if err != nil {
		t.Fatalf("Failed to get namespace permission: %v", err)
	}
	if retrieved == nil {
		t.Fatal("Namespace permission should exist")
	}
	if retrieved.Role != auth.RoleOperator {
		t.Errorf("Expected role 'operator', got '%s'", retrieved.Role)
	}
}

func TestDeleteNamespacePermission(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	perm := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Namespace: "default",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateNamespacePermission(context.Background(), perm)

	err := repo.DeleteNamespacePermission(context.Background(), perm.ID)
	if err != nil {
		t.Fatalf("Failed to delete namespace permission: %v", err)
	}

	retrieved, _ := repo.GetNamespacePermission(context.Background(), userID, "cluster-123", "default")
	if retrieved != nil {
		t.Error("Namespace permission should be deleted")
	}
}

func TestDeleteNamespacePermissionByUserClusterNamespace(t *testing.T) {
	repo := setupTestRepoForNamespacePermissions(t)
	defer repo.Close()
	userID := createTestUserForNSPerms(t, repo)

	perm := &models.NamespacePermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: "cluster-123",
		Namespace: "default",
		Role:      auth.RoleOperator,
		CreatedAt: time.Now(),
	}
	repo.CreateNamespacePermission(context.Background(), perm)

	err := repo.DeleteNamespacePermissionByUserClusterNamespace(context.Background(), userID, "cluster-123", "default")
	if err != nil {
		t.Fatalf("Failed to delete namespace permission: %v", err)
	}

	retrieved, _ := repo.GetNamespacePermission(context.Background(), userID, "cluster-123", "default")
	if retrieved != nil {
		t.Error("Namespace permission should be deleted")
	}
}
