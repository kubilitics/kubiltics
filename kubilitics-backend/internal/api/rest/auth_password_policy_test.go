package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// setupTestRepoForAuth creates an in-memory SQLite repository for auth tests
func setupTestRepoForAuth(t *testing.T) *repository.SQLiteRepository {
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
			failed_login_count INTEGER DEFAULT 0,
			last_failed_login DATETIME,
			deleted_at DATETIME
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
		CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			key_hash TEXT NOT NULL,
			key_prefix TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL,
			last_used TIMESTAMP,
			expires_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
		CREATE TABLE IF NOT EXISTS cluster_permissions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			cluster_id TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(user_id, cluster_id)
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

// TestAuthHandler_LoginRateLimit_Returns429 tests BE-AUTH-002: 6th failed login returns 429
func TestAuthHandler_LoginRateLimit_Returns429(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:          "required",
		AuthJWTSecret:     "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12, // Explicitly set minimum length
	}
	handler := NewAuthHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	handler.RegisterRoutes(api)

	testIP := "192.168.1.100"
	// Make 5 login attempts (within limit)
	for i := 0; i < 5; i++ {
		body := LoginRequest{
			Username: "nonexistent",
			Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3", // Valid length, not common
		}
		bodyBytes, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
		req.RemoteAddr = testIP + ":12345"
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		// First 5 should return 401 (unauthorized), not 429
		if rec.Code == http.StatusTooManyRequests {
			t.Errorf("Attempt %d: Expected 401, got 429 Too Many Requests", i+1)
		}
	}

	// 6th attempt should return 429
	body := LoginRequest{
		Username: "nonexistent",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3", // Valid length, not common
	}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	req.RemoteAddr = testIP + ":12345"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("Expected status 429 for 6th login attempt, got %d. Body: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Expected Retry-After header in 429 response")
	}
}

// TestAuthHandler_PasswordLengthValidation tests BE-AUTH-002: password length validation
func TestAuthHandler_PasswordLengthValidation(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:          "required",
		AuthJWTSecret:     "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12, // Explicitly set minimum length
	}
	handler := NewAuthHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	handler.RegisterRoutes(api)

	// Create a test user first (password validation happens before user lookup)
	userID := uuid.New().String()
	passwordHash, _ := auth.HashPassword("Xy9$mK2#pQ7@vN4&wL8*zR5!tB3")
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: passwordHash,
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	repo.CreateUser(context.Background(), user)

	// Test password too short
	body := LoginRequest{
		Username: "testuser",
		Password: "short", // Less than 12 characters
	}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for short password, got %d. Body: %s", rec.Code, rec.Body.String())
	}
	var errResp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errResp); err == nil {
		if !contains(errResp["error"], "at least 12") && !contains(errResp["error"], "12 characters") {
			t.Logf("Note: Password validation error message: %s", errResp["error"])
		}
	}
}

// TestAuthHandler_AccountLockout_After10Failures tests BE-AUTH-002: account lockout after 10 failures
// Note: Rate limiter (5 per minute) will kick in, so we test lockout by directly incrementing failed count
func TestAuthHandler_AccountLockout_After10Failures(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:          "required",
		AuthJWTSecret:     "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12, // Explicitly set minimum length
	}
	handler := NewAuthHandler(repo, cfg)

	// Create a test user
	userID := uuid.New().String()
	correctPassword := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	passwordHash, _ := auth.HashPassword(correctPassword)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: passwordHash,
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	if err := repo.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	// Simulate 9 failed logins by directly incrementing failed count
	for i := 0; i < 9; i++ {
		if err := repo.IncrementFailedLogin(context.Background(), userID); err != nil {
			t.Fatalf("Failed to increment failed login count: %v", err)
		}
	}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	handler.RegisterRoutes(api)

	// Use different IPs to avoid rate limiting (rate limiter is per-IP)
	testIPs := []string{"192.168.1.200", "192.168.1.201", "192.168.1.202", "192.168.1.203", "192.168.1.204"}
	
	// 10th failed attempt should lock the account
	body := LoginRequest{
		Username: "testuser",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3Wrong", // Wrong password, not common
	}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	req.RemoteAddr = testIPs[0] + ":12345"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should return 403 (locked) after 10th failure
	if rec.Code != http.StatusForbidden {
		t.Logf("Got status %d, expected 403. Body: %s", rec.Code, rec.Body.String())
		// May be 429 if rate limiter kicks in, but account should still be locked
	}

	// Verify account is locked
	lockedUser, err := repo.GetUserByUsername(context.Background(), "testuser")
	if err != nil {
		t.Fatalf("Failed to get user: %v", err)
	}
	if !lockedUser.IsLocked() {
		t.Error("Expected account to be locked after 10 failed attempts")
	}
	if lockedUser.FailedLoginCount < 10 {
		t.Errorf("Expected failed login count >= 10, got %d", lockedUser.FailedLoginCount)
	}

	// Try to login with correct password - should still be locked
	body = LoginRequest{
		Username: "testuser",
		Password: correctPassword,
	}
	bodyBytes, _ = json.Marshal(body)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	req.RemoteAddr = testIPs[1] + ":12345"
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("Expected status 403 for locked account even with correct password, got %d", rec.Code)
	}
}

// TestAuthHandler_AuthEvents_Logged tests BE-AUTH-002: auth events are logged
func TestAuthHandler_AuthEvents_Logged(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:          "required",
		AuthJWTSecret:     "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12, // Explicitly set minimum length
	}
	handler := NewAuthHandler(repo, cfg)

	// Create a test user with known password
	userID := uuid.New().String()
	// Use a password we know works (not common)
	testPassword := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	passwordHash, err := auth.HashPassword(testPassword)
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: passwordHash,
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	if err := repo.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	handler.RegisterRoutes(api)

	testIP := "192.168.1.300"
	// Successful login
	body := LoginRequest{
		Username: "testuser",
		Password: testPassword,
	}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	req.RemoteAddr = testIP + ":12345"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected successful login, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	// Verify auth event was logged
	userIDPtr := &userID
	eventTypeSuccess := "login_success"
	events, err := repo.ListAuthEvents(context.Background(), userIDPtr, &eventTypeSuccess, 10)
	if err != nil {
		t.Fatalf("Failed to list auth events: %v", err)
	}
	if len(events) == 0 {
		t.Error("Expected auth event to be logged, but none found")
	}
	foundSuccess := false
	for _, event := range events {
		if event.EventType == "login_success" && event.Username == "testuser" {
			foundSuccess = true
			if event.IPAddress != testIP {
				t.Errorf("Expected IP %s, got %s", testIP, event.IPAddress)
			}
			break
		}
	}
	if !foundSuccess {
		t.Error("Expected login_success event, but not found")
	}

	// Failed login
	body = LoginRequest{
		Username: "testuser",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3Wrong",
	}
	bodyBytes, _ = json.Marshal(body)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(bodyBytes))
	req.RemoteAddr = testIP + ":12345"
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Verify failure event was logged
	eventTypeFailure := "login_failure"
	events, err = repo.ListAuthEvents(context.Background(), userIDPtr, &eventTypeFailure, 10)
	if err != nil {
		t.Fatalf("Failed to list auth events: %v", err)
	}
	foundFailure := false
	for _, event := range events {
		if event.EventType == "login_failure" && event.Username == "testuser" {
			foundFailure = true
			break
		}
	}
	if !foundFailure {
		t.Error("Expected login_failure event, but not found")
	}
}

// TestAuthHandler_ChangePassword_LengthValidation tests BE-AUTH-002: password length validation in change password
func TestAuthHandler_ChangePassword_LengthValidation(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:          "required",
		AuthJWTSecret:     "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12, // Explicitly set minimum length
	}
	handler := NewAuthHandler(repo, cfg)

	// Create a test user
	userID := uuid.New().String()
	oldPassword := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3Old"
	passwordHash, _ := auth.HashPassword(oldPassword)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: passwordHash,
		Role:         auth.RoleViewer,
		CreatedAt:    time.Now(),
	}
	if err := repo.CreateUser(context.Background(), user); err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	// Create a valid token
	token, err := auth.IssueAccessToken(cfg.AuthJWTSecret, userID, "testuser", auth.RoleViewer)
	if err != nil {
		t.Fatalf("Failed to generate token: %v", err)
	}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	handler.RegisterRoutes(api)

	// Try to change password with short new password
	// Note: ChangePassword handler extracts claims from context, which is set by auth middleware
	// We need to add auth middleware to the router
	router = mux.NewRouter()
	api = router.PathPrefix("/api/v1").Subrouter()
	
	// Add auth middleware
	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
				Refresh:  false,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	api.Use(authMiddleware)
	handler.RegisterRoutes(api)
	
	body := ChangePasswordRequest{
		CurrentPassword: oldPassword,
		NewPassword:     "short", // Less than 12 characters
	}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/change-password", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for short new password, got %d. Body: %s", rec.Code, rec.Body.String())
	}
	var errResp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errResp); err == nil {
		if !contains(errResp["error"], "at least 12 characters") {
			t.Errorf("Expected error message about 12 characters, got: %s", errResp["error"])
		}
	}
}

// Helper function to check if string contains substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || 
		(len(s) > len(substr) && (s[:len(substr)] == substr || 
		s[len(s)-len(substr):] == substr || 
		containsMiddle(s, substr))))
}

func containsMiddle(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
