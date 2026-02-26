package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

func setupTestRepoForProjects(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	repo, err := repository.NewSQLiteRepository(":memory:")
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

func TestListProjects_Empty(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	cfg := &config.Config{AuthMode: "disabled"}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	ps := service.NewProjectService(repo, &mockClusterRepo{list: []*models.Cluster{}})
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, ps, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var projects []interface{}
	if err := json.NewDecoder(rec.Body).Decode(&projects); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(projects) != 0 {
		t.Errorf("Expected empty projects list, got %d", len(projects))
	}
}

func TestCreateProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	cfg := &config.Config{AuthMode: "disabled"}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	ps := service.NewProjectService(repo, &mockClusterRepo{list: []*models.Cluster{}})
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, ps, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	projectData := map[string]string{
		"name":        "Test Project",
		"description": "Test Description",
	}
	body, _ := json.Marshal(projectData)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("Expected status 201 or 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProject_NotFound(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	cfg := &config.Config{AuthMode: "disabled"}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	ps := service.NewProjectService(repo, &mockClusterRepo{list: []*models.Cluster{}})
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, ps, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", rec.Code)
	}
}

func TestGetProject_Found(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	// Create a project first
	projectID := uuid.New().String()
	project := &models.Project{
		ID:          projectID,
		Name:        "Test Project",
		Description: "Test Description",
	}
	repo.CreateProject(context.Background(), project)

	cfg := &config.Config{AuthMode: "disabled"}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	ps := service.NewProjectService(repo, &mockClusterRepo{list: []*models.Cluster{}})
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, ps, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var projectResp models.Project
	if err := json.NewDecoder(rec.Body).Decode(&projectResp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if projectResp.Name != "Test Project" {
		t.Errorf("Expected name 'Test Project', got '%s'", projectResp.Name)
	}
}

func TestUpdateProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	// Create a project first
	projectID := uuid.New().String()
	project := &models.Project{
		ID:          projectID,
		Name:        "Original Name",
		Description: "Original Description",
	}
	repo.CreateProject(context.Background(), project)

	cfg := &config.Config{AuthMode: "disabled"}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	ps := service.NewProjectService(repo, &mockClusterRepo{list: []*models.Cluster{}})
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, ps, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	updateData := map[string]string{
		"name":        "Updated Name",
		"description": "Updated Description",
	}
	body, _ := json.Marshal(updateData)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/projects/"+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteProject(t *testing.T) {
	repo := setupTestRepoForProjects(t)
	defer repo.Close()

	// Create a project first
	projectID := uuid.New().String()
	project := &models.Project{
		ID:   projectID,
		Name: "Test Project",
	}
	repo.CreateProject(context.Background(), project)

	cfg := &config.Config{AuthMode: "disabled"}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	ps := service.NewProjectService(repo, &mockClusterRepo{list: []*models.Cluster{}})
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, ps, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/"+projectID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent && rec.Code != http.StatusOK {
		t.Errorf("Expected status 204 or 200, got %d", rec.Code)
	}
}
