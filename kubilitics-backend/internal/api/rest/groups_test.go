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
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

func setupTestRepoForGroups(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	repo, err := repository.NewSQLiteRepository(":memory:")
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
		CREATE TABLE IF NOT EXISTS groups (
			id TEXT PRIMARY KEY,
			name TEXT UNIQUE NOT NULL,
			description TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS group_members (
			id TEXT PRIMARY KEY,
			group_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'member',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(group_id, user_id),
			FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestListGroups_Empty(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/groups", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var groups []interface{}
	if err := json.NewDecoder(rec.Body).Decode(&groups); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(groups) != 0 {
		t.Errorf("Expected empty groups list, got %d", len(groups))
	}
}

func TestCreateGroup(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	groupData := map[string]string{
		"name":        "Test Group",
		"description": "Test Description",
	}
	body, _ := json.Marshal(groupData)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/groups", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("Expected status 201 or 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestGetGroup_NotFound(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/groups/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d", rec.Code)
	}
}

func TestGetGroup_Found(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	// Create a group first
	groupID := uuid.New().String()
	group := &models.Group{
		ID:          groupID,
		Name:        "Test Group",
		Description: "Test Description",
	}
	repo.CreateGroup(context.Background(), group)

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/groups/"+groupID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var groupResp models.Group
	if err := json.NewDecoder(rec.Body).Decode(&groupResp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if groupResp.Name != "Test Group" {
		t.Errorf("Expected name 'Test Group', got '%s'", groupResp.Name)
	}
}

func TestUpdateGroup(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	// Create a group first
	groupID := uuid.New().String()
	group := &models.Group{
		ID:          groupID,
		Name:        "Original Name",
		Description: "Original Description",
	}
	repo.CreateGroup(context.Background(), group)

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	updateData := map[string]string{
		"name":        "Updated Name",
		"description": "Updated Description",
	}
	body, _ := json.Marshal(updateData)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/groups/"+groupID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteGroup(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	// Create a group first
	groupID := uuid.New().String()
	group := &models.Group{
		ID:   groupID,
		Name: "Test Group",
	}
	repo.CreateGroup(context.Background(), group)

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/groups/"+groupID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent && rec.Code != http.StatusOK {
		t.Errorf("Expected status 204 or 200, got %d", rec.Code)
	}
}

func TestListGroupMembers_Empty(t *testing.T) {
	repo := setupTestRepoForGroups(t)
	defer repo.Close()

	// Create a group first
	groupID := uuid.New().String()
	group := &models.Group{
		ID:   groupID,
		Name: "Test Group",
	}
	repo.CreateGroup(context.Background(), group)

	cfg := &config.Config{AuthMode: "disabled"}
	handler := NewGroupsHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	// Add auth middleware that sets admin claims
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   "admin-user",
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/groups/"+groupID+"/members", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var members []interface{}
	if err := json.NewDecoder(rec.Body).Decode(&members); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(members) != 0 {
		t.Errorf("Expected empty members list, got %d", len(members))
	}
}
