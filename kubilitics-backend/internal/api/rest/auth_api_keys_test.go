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
)

// Test CreateAPIKey endpoint
func TestAuthHandler_CreateAPIKey_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	reqBody := CreateAPIKeyRequest{
		Name: "Test API Key",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/api-keys", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var response CreateAPIKeyResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if response.Name != "Test API Key" {
		t.Errorf("Expected name 'Test API Key', got '%s'", response.Name)
	}
	if response.Key == "" {
		t.Error("Expected API key to be returned")
	}
}

func TestAuthHandler_CreateAPIKey_WithExpiration(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	expiresIn := 30
	reqBody := CreateAPIKeyRequest{
		Name:      "Expiring API Key",
		ExpiresIn: &expiresIn,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/api-keys", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var response CreateAPIKeyResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if response.ExpiresAt == nil {
		t.Error("Expected expiration date to be set")
	}
}

func TestAuthHandler_CreateAPIKey_MissingName(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	reqBody := CreateAPIKeyRequest{
		Name: "",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/api-keys", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test ListAPIKeys endpoint
func TestAuthHandler_ListAPIKeys_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Create API keys
	plaintext1, hash1, _ := auth.GenerateAPIKey()
	plaintext2, hash2, _ := auth.GenerateAPIKey()
	apiKey1 := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash1,
		Name:      "Key 1",
		CreatedAt: time.Now(),
	}
	apiKey2 := &models.APIKey{
		ID:        uuid.New().String(),
		UserID:    userID,
		KeyHash:   hash2,
		Name:      "Key 2",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey1)
	repo.CreateAPIKey(context.Background(), apiKey2)
	_ = plaintext1
	_ = plaintext2

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/api-keys", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var keys []APIKeyResponse
	if err := json.NewDecoder(rec.Body).Decode(&keys); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(keys) != 2 {
		t.Errorf("Expected 2 API keys, got %d", len(keys))
	}
}

// Test DeleteAPIKey endpoint
func TestAuthHandler_DeleteAPIKey_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	// Create API key
	plaintext, hash, _ := auth.GenerateAPIKey()
	apiKeyID := uuid.New().String()
	apiKey := &models.APIKey{
		ID:        apiKeyID,
		UserID:    userID,
		KeyHash:   hash,
		Name:      "Test Key",
		CreatedAt: time.Now(),
	}
	repo.CreateAPIKey(context.Background(), apiKey)
	_ = plaintext

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/api-keys/"+apiKeyID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("Expected status 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthHandler_DeleteAPIKey_NotFound(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/api-keys/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d: %s", rec.Code, rec.Body.String())
	}
}
