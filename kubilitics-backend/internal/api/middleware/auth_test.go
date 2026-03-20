package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// setupTestRepo creates an in-memory SQLite repository for testing
func setupTestRepo(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	// Use in-memory database (cache=shared must be before query params)
	repo, err := repository.NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create test repository: %v", err)
	}
	// Run migrations (simplified - just create necessary tables)
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
		CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			key_hash TEXT NOT NULL,
			key_prefix TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_used DATETIME,
			expires_at DATETIME,
			FOREIGN KEY(user_id) REFERENCES users(id)
		);
		CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestAuthMiddleware_DisabledMode(t *testing.T) {
	cfg := &config.Config{AuthMode: "disabled"}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestAuthMiddleware_RequiredMode_NoToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func TestAuthMiddleware_RequiredMode_ValidToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	// Create a valid token using IssueAccessToken
	token, err := auth.IssueAccessToken(cfg.AuthJWTSecret, "user-123", "testuser", auth.RoleViewer)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := auth.ClaimsFromContext(r.Context())
		if claims == nil {
			t.Error("Claims not found in context")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if claims.UserID != "user-123" {
			t.Errorf("Expected user-123, got %s", claims.UserID)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestAuthMiddleware_RequiredMode_InvalidToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_RequiredMode_RefreshToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	// Create a refresh token using IssueRefreshToken
	token, err := auth.IssueRefreshToken(cfg.AuthJWTSecret, "user-123")
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", rec.Code)
	}
	if rec.Body.String() != `{"error":"Use access token for this request"}` {
		t.Errorf("Expected refresh token error, got %s", rec.Body.String())
	}
}

func TestAuthMiddleware_OptionalMode_NoToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:     "optional",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}

func TestAuthMiddleware_HealthEndpoint_Bypass(t *testing.T) {
	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	repo := setupTestRepo(t)
	defer repo.Close()
	
	handler := Auth(cfg, repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}
