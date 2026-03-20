package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForProjects(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS project_clusters (
			project_id TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (project_id, cluster_id),
			FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS project_namespaces (
			project_id TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			namespace_name TEXT NOT NULL,
			team TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (project_id, cluster_id, namespace_name),
			FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestCreateProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:          uuid.New().String(),
		Name:        "Test Project",
		Description: "Test Description",
	}

	err := repo.CreateProject(context.Background(), project)
	if err != nil {
		t.Fatalf("Failed to create project: %v", err)
	}
}

func TestCreateProject_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		Name:        "Test Project",
		Description: "Test Description",
	}

	err := repo.CreateProject(context.Background(), project)
	if err != nil {
		t.Fatalf("Failed to create project: %v", err)
	}
	if project.ID == "" {
		t.Error("Project ID should be auto-generated")
	}
}

func TestGetProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	projectID := uuid.New().String()
	project := &models.Project{
		ID:          projectID,
		Name:        "Test Project",
		Description: "Test Description",
	}
	repo.CreateProject(context.Background(), project)

	retrieved, err := repo.GetProject(context.Background(), projectID)
	if err != nil {
		t.Fatalf("Failed to get project: %v", err)
	}
	if retrieved.Name != "Test Project" {
		t.Errorf("Expected name 'Test Project', got '%s'", retrieved.Name)
	}
}

func TestGetProject_NotFound(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	_, err := repo.GetProject(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error when project not found")
	}
}

func TestListProjects(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	// Create multiple projects
	for i := 0; i < 3; i++ {
		project := &models.Project{
			ID:   uuid.New().String(),
			Name: "Test Project " + string(rune('0'+i)),
		}
		repo.CreateProject(context.Background(), project)
	}

	projects, err := repo.ListProjects(context.Background())
	if err != nil {
		t.Fatalf("Failed to list projects: %v", err)
	}
	if len(projects) != 3 {
		t.Errorf("Expected 3 projects, got %d", len(projects))
	}
}

func TestUpdateProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:          uuid.New().String(),
		Name:        "Test Project",
		Description: "Original Description",
	}
	repo.CreateProject(context.Background(), project)

	project.Description = "Updated Description"
	err := repo.UpdateProject(context.Background(), project)
	if err != nil {
		t.Fatalf("Failed to update project: %v", err)
	}

	retrieved, _ := repo.GetProject(context.Background(), project.ID)
	if retrieved.Description != "Updated Description" {
		t.Errorf("Expected description 'Updated Description', got '%s'", retrieved.Description)
	}
}

func TestDeleteProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:   uuid.New().String(),
		Name: "Test Project",
	}
	repo.CreateProject(context.Background(), project)

	err := repo.DeleteProject(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("Failed to delete project: %v", err)
	}

	_, err = repo.GetProject(context.Background(), project.ID)
	if err == nil {
		t.Error("Project should be deleted")
	}
}

func TestAddClusterToProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:   uuid.New().String(),
		Name: "Test Project",
	}
	repo.CreateProject(context.Background(), project)

	pc := &models.ProjectCluster{
		ProjectID: project.ID,
		ClusterID: "cluster-123",
	}

	err := repo.AddClusterToProject(context.Background(), pc)
	if err != nil {
		t.Fatalf("Failed to add cluster to project: %v", err)
	}

	clusters, _ := repo.ListProjectClusters(context.Background(), project.ID)
	if len(clusters) != 1 {
		t.Errorf("Expected 1 cluster, got %d", len(clusters))
	}
}

func TestRemoveClusterFromProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:   uuid.New().String(),
		Name: "Test Project",
	}
	repo.CreateProject(context.Background(), project)

	pc := &models.ProjectCluster{
		ProjectID: project.ID,
		ClusterID: "cluster-123",
	}
	repo.AddClusterToProject(context.Background(), pc)

	err := repo.RemoveClusterFromProject(context.Background(), project.ID, "cluster-123")
	if err != nil {
		t.Fatalf("Failed to remove cluster from project: %v", err)
	}

	clusters, _ := repo.ListProjectClusters(context.Background(), project.ID)
	if len(clusters) != 0 {
		t.Errorf("Expected 0 clusters, got %d", len(clusters))
	}
}

func TestAddNamespaceToProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:   uuid.New().String(),
		Name: "Test Project",
	}
	repo.CreateProject(context.Background(), project)

	pn := &models.ProjectNamespace{
		ProjectID:     project.ID,
		ClusterID:     "cluster-123",
		NamespaceName: "default",
		Team:          "team-a",
	}

	err := repo.AddNamespaceToProject(context.Background(), pn)
	if err != nil {
		t.Fatalf("Failed to add namespace to project: %v", err)
	}

	namespaces, _ := repo.ListProjectNamespaces(context.Background(), project.ID)
	if len(namespaces) != 1 {
		t.Errorf("Expected 1 namespace, got %d", len(namespaces))
	}
}

func TestRemoveNamespaceFromProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	project := &models.Project{
		ID:   uuid.New().String(),
		Name: "Test Project",
	}
	repo.CreateProject(context.Background(), project)

	pn := &models.ProjectNamespace{
		ProjectID:     project.ID,
		ClusterID:     "cluster-123",
		NamespaceName: "default",
	}
	repo.AddNamespaceToProject(context.Background(), pn)

	err := repo.RemoveNamespaceFromProject(context.Background(), project.ID, "cluster-123", "default")
	if err != nil {
		t.Fatalf("Failed to remove namespace from project: %v", err)
	}

	namespaces, _ := repo.ListProjectNamespaces(context.Background(), project.ID)
	if len(namespaces) != 0 {
		t.Errorf("Expected 0 namespaces, got %d", len(namespaces))
	}
}
