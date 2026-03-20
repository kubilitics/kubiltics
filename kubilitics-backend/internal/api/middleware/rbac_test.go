package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// setupTestRepoForRBAC creates an in-memory SQLite repository for RBAC testing
func setupTestRepoForRBAC(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	repo, err := repository.NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create test repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_login DATETIME,
			locked_until DATETIME,
			failed_login_count INTEGER DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS cluster_permissions (
			user_id TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY(user_id, cluster_id),
			FOREIGN KEY(user_id) REFERENCES users(id)
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}


func TestRequireRole_NoClaims(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireRole(repo, auth.RoleViewer)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", rec.Code)
	}
	if rec.Body.String() != `{"error":"Authentication required"}` {
		t.Errorf("Expected auth error, got %s", rec.Body.String())
	}
}

func TestRequireRole_Viewer_AccessViewer(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireRole(repo, auth.RoleViewer)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "viewer",
		Role:     auth.RoleViewer,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRequireRole_Viewer_AccessOperator(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireRole(repo, auth.RoleOperator)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "viewer",
		Role:     auth.RoleViewer,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusForbidden {
		t.Errorf("Expected status 403, got %d", rec.Code)
	}
	if rec.Body.String() != `{"error":"Insufficient permissions"}` {
		t.Errorf("Expected permission error, got %s", rec.Body.String())
	}
}

func TestRequireRole_Operator_AccessOperator(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireRole(repo, auth.RoleOperator)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "operator",
		Role:     auth.RoleOperator,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRequireRole_Admin_AccessOperator(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireRole(repo, auth.RoleOperator)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "admin",
		Role:     auth.RoleAdmin,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRequireAdmin(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireAdmin(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "admin",
		Role:     auth.RoleAdmin,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRequireOperator(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireOperator(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "operator",
		Role:     auth.RoleOperator,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/cluster-1/apply", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestRequireViewer(t *testing.T) {
	repo := setupTestRepoForRBAC(t)
	defer repo.Close()
	handler := RequireViewer(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	claims := &auth.Claims{
		UserID:   "user-123",
		Username: "viewer",
		Role:     auth.RoleViewer,
	}
	ctx := auth.WithClaims(context.Background(), claims)
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}
