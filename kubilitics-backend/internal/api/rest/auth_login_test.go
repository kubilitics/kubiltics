package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestAuthHandler_Login_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	// Create test user with unique password (not in common passwords list)
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           "user-123",
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Login request
	reqBody := LoginRequest{
		Username: "testuser",
		Password: password,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/auth/login", bytes.NewReader(body))
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()

	handler.Login(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp LoginResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if resp.AccessToken == "" {
		t.Error("Expected access token in response")
	}
	if resp.RefreshToken == "" {
		t.Error("Expected refresh token in response")
	}
	if resp.TokenType != "Bearer" && resp.TokenType != "" {
		t.Errorf("Expected token type 'Bearer' or empty, got '%s'", resp.TokenType)
	}
}

func TestAuthHandler_Login_InvalidCredentials(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	// Create test user with unique password (not in common passwords list)
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           "user-123",
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Login with wrong password (must not contain common words)
	reqBody := LoginRequest{
		Username: "testuser",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3Wrong",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/auth/login", bytes.NewReader(body))
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()

	handler.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Login_UserNotFound(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	reqBody := LoginRequest{
		Username: "nonexistent",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3", // Not common
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/auth/login", bytes.NewReader(body))
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()

	handler.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Login_MissingFields(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	// Missing password
	reqBody := LoginRequest{
		Username: "testuser",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()

	handler.Login(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Refresh_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	// Create test user
	user := &models.User{
		ID:           "user-123",
		Username:     "testuser",
		PasswordHash: "hashed",
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Generate refresh token
	refreshToken, _ := auth.IssueRefreshToken(cfg.AuthJWTSecret, "user-123")

	// Refresh request
	reqBody := RefreshRequest{
		RefreshToken: refreshToken,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/auth/refresh", bytes.NewReader(body))
	w := httptest.NewRecorder()

	handler.Refresh(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp LoginResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if resp.AccessToken == "" {
		t.Error("Expected access token in response")
	}
}

func TestAuthHandler_Refresh_InvalidToken(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	reqBody := RefreshRequest{
		RefreshToken: "invalid-token",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest("POST", "/auth/refresh", bytes.NewReader(body))
	w := httptest.NewRecorder()

	handler.Refresh(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthHandler_Me_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	// Create test user
	user := &models.User{
		ID:           "user-123",
		Username:     "testuser",
		PasswordHash: "hashed",
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Generate access token
	accessToken, _ := auth.IssueAccessToken(cfg.AuthJWTSecret, "user-123", "testuser", auth.RoleViewer)

	req := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	w := httptest.NewRecorder()

	// Add auth middleware that extracts token from Authorization header
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || len(authHeader) < 7 || authHeader[:7] != "Bearer " {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			token := authHeader[7:]
			claims, err := auth.ValidateToken(cfg.AuthJWTSecret, token)
			if err == nil && claims != nil {
				ctx := auth.WithClaims(r.Context(), claims)
				next.ServeHTTP(w, r.WithContext(ctx))
			} else {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
			}
		})
	}
	api.Use(authMiddleware)
	handler.RegisterRoutes(api)

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp MeResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if resp.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", resp.Username)
	}
	if resp.Role != auth.RoleViewer {
		t.Errorf("Expected role '%s', got '%s'", auth.RoleViewer, resp.Role)
	}
}

func TestAuthHandler_Logout_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "jwt",
		AuthJWTSecret: "test-secret-key-for-jwt-token-generation",
	}

	handler := NewAuthHandler(repo, cfg)

	// Create test user
	user := &models.User{
		ID:           "user-123",
		Username:     "testuser",
		PasswordHash: "hashed",
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Generate access token
	accessToken, _ := auth.IssueAccessToken(cfg.AuthJWTSecret, "user-123", "testuser", auth.RoleViewer)

	req := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	w := httptest.NewRecorder()

	// Add auth middleware that extracts token from Authorization header
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	authMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || len(authHeader) < 7 || authHeader[:7] != "Bearer " {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			token := authHeader[7:]
			claims, err := auth.ValidateToken(cfg.AuthJWTSecret, token)
			if err == nil && claims != nil {
				ctx := auth.WithClaims(r.Context(), claims)
				next.ServeHTTP(w, r.WithContext(ctx))
			} else {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
			}
		})
	}
	api.Use(authMiddleware)
	handler.RegisterRoutes(api)

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", w.Code, w.Body.String())
	}
}
