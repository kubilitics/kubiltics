package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

func setupTestRepoForAudit(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	repo, err := repository.NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS audit_log (
			id TEXT PRIMARY KEY,
			timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			user_id TEXT,
			username TEXT NOT NULL,
			cluster_id TEXT,
			action TEXT NOT NULL,
			resource_kind TEXT,
			resource_namespace TEXT,
			resource_name TEXT,
			status_code INTEGER,
			request_ip TEXT NOT NULL,
			details TEXT,
			session_id TEXT,
			device_info TEXT,
			geolocation TEXT,
			risk_score INTEGER,
			correlation_id TEXT
		);
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestAuditLog_LogsPOST(t *testing.T) {
	repo := setupTestRepoForAudit(t)
	defer repo.Close()

	handler := AuditLog(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/test-cluster/resources/pods/default/test-pod", nil)
	req = req.WithContext(auth.WithClaims(req.Context(), &auth.Claims{
		UserID:   "user-123",
		Username: "testuser",
		Role:     auth.RoleOperator,
	}))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Verify audit log entry was created
	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) == 0 {
		t.Error("Expected audit log entry to be created")
	}
}

func TestAuditLog_LogsPATCH(t *testing.T) {
	repo := setupTestRepoForAudit(t)
	defer repo.Close()

	handler := AuditLog(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/clusters/test-cluster/resources/deployments/default/test-deploy", nil)
	req = req.WithContext(auth.WithClaims(req.Context(), &auth.Claims{
		UserID:   "user-123",
		Username: "testuser",
		Role:     auth.RoleOperator,
	}))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) == 0 {
		t.Error("Expected audit log entry to be created")
	}
}

func TestAuditLog_LogsDELETE(t *testing.T) {
	repo := setupTestRepoForAudit(t)
	defer repo.Close()

	handler := AuditLog(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/clusters/test-cluster/resources/pods/default/test-pod", nil)
	req = req.WithContext(auth.WithClaims(req.Context(), &auth.Claims{
		UserID:   "user-123",
		Username: "testuser",
		Role:     auth.RoleOperator,
	}))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) == 0 {
		t.Error("Expected audit log entry to be created")
	}
}

func TestAuditLog_SkipsGET(t *testing.T) {
	repo := setupTestRepoForAudit(t)
	defer repo.Close()

	handler := AuditLog(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) > 0 {
		t.Error("GET requests should not be logged")
	}
}

func TestAuditLog_SkipsAuthRoutes(t *testing.T) {
	repo := setupTestRepoForAudit(t)
	defer repo.Close()

	handler := AuditLog(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) > 0 {
		t.Error("Auth routes should not be logged")
	}
}

func TestAuditLog_CapturesStatusCode(t *testing.T) {
	repo := setupTestRepoForAudit(t)
	defer repo.Close()

	handler := AuditLog(repo)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/clusters/test-cluster/resources/pods/default/test-pod", nil)
	req = req.WithContext(auth.WithClaims(req.Context(), &auth.Claims{
		UserID:   "user-123",
		Username: "testuser",
		Role:     auth.RoleOperator,
	}))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("Expected audit log entry")
	}
	if entries[0].StatusCode == nil || *entries[0].StatusCode != http.StatusNotFound {
		t.Errorf("Expected status code 404, got %v", entries[0].StatusCode)
	}
}

func TestAuditLog_NilRepo(t *testing.T) {
	handler := AuditLog(nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/test-cluster/resources/pods", nil)
	rec := httptest.NewRecorder()

	// Should not panic
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
}
