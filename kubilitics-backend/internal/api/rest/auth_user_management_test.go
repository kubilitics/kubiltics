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

// Test ListUsers endpoint
func TestAuthHandler_ListUsers_AdminOnly(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	// Create test users
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user1 := &models.User{
		ID:           uuid.New().String(),
		Username:     "user1",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	user2 := &models.User{
		ID:           uuid.New().String(),
		Username:     "user2",
		PasswordHash: hashedPassword,
		Role:         auth.RoleOperator,
	}
	repo.CreateUser(context.Background(), user1)
	repo.CreateUser(context.Background(), user2)

	// Test admin access
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var users []models.User
	if err := json.NewDecoder(rec.Body).Decode(&users); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(users) < 2 {
		t.Errorf("Expected at least 2 users, got %d", len(users))
	}
}

func TestAuthHandler_ListUsers_NonAdminForbidden(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "viewer",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("Expected status 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test CreateUser endpoint
func TestAuthHandler_CreateUser_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:       "required",
		AuthJWTSecret:  "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12,
	}
	handler := NewAuthHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	reqBody := CreateUserRequest{
		Username: "newuser",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3",
		Role:     auth.RoleViewer,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var user models.User
	if err := json.NewDecoder(rec.Body).Decode(&user); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if user.Username != "newuser" {
		t.Errorf("Expected username 'newuser', got '%s'", user.Username)
	}
	if user.PasswordHash != "" {
		t.Error("Password hash should not be returned")
	}
}

func TestAuthHandler_CreateUser_ShortPassword(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:       "required",
		AuthJWTSecret:  "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12,
	}
	handler := NewAuthHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	reqBody := CreateUserRequest{
		Username: "newuser",
		Password: "short",
		Role:     auth.RoleViewer,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthHandler_CreateUser_DuplicateUsername(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:       "required",
		AuthJWTSecret:  "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12,
	}
	handler := NewAuthHandler(repo, cfg)

	// Create existing user
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	existingUser := &models.User{
		ID:           uuid.New().String(),
		Username:     "existing",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), existingUser)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	reqBody := CreateUserRequest{
		Username: "existing",
		Password: "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3",
		Role:     auth.RoleViewer,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("Expected status 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test GetUser endpoint
func TestAuthHandler_GetUser_SelfView(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/"+userID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var retrievedUser models.User
	if err := json.NewDecoder(rec.Body).Decode(&retrievedUser); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if retrievedUser.ID != userID {
		t.Errorf("Expected user ID '%s', got '%s'", userID, retrievedUser.ID)
	}
	if retrievedUser.PasswordHash != "" {
		t.Error("Password hash should not be returned")
	}
}

func TestAuthHandler_GetUser_AdminView(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	targetUserID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	targetUser := &models.User{
		ID:           targetUserID,
		Username:     "targetuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), targetUser)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/"+targetUserID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var retrievedUser models.User
	if err := json.NewDecoder(rec.Body).Decode(&retrievedUser); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if retrievedUser.ID != targetUserID {
		t.Errorf("Expected user ID '%s', got '%s'", targetUserID, retrievedUser.ID)
	}
}

func TestAuthHandler_GetUser_NotFound(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test UpdateUser endpoint
func TestAuthHandler_UpdateUser_UpdatePassword(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:       "required",
		AuthJWTSecret:  "test-secret-key-minimum-32-characters-long",
		PasswordMinLength: 12,
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

	newPassword := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3New"
	reqBody := UpdateUserRequest{
		Password: newPassword,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/"+userID, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthHandler_UpdateUser_AdminUpdateRole(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	targetUserID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	targetUser := &models.User{
		ID:           targetUserID,
		Username:     "targetuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), targetUser)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	reqBody := UpdateUserRequest{
		Role: auth.RoleOperator,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/"+targetUserID, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var updatedUser models.User
	if err := json.NewDecoder(rec.Body).Decode(&updatedUser); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if updatedUser.Role != auth.RoleOperator {
		t.Errorf("Expected role 'operator', got '%s'", updatedUser.Role)
	}
}

func TestAuthHandler_UpdateUser_NonAdminCannotUpdateRole(t *testing.T) {
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

	reqBody := UpdateUserRequest{
		Role: auth.RoleAdmin,
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/"+userID, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("Expected status 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test DeleteUser endpoint
func TestAuthHandler_DeleteUser_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	targetUserID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	targetUser := &models.User{
		ID:           targetUserID,
		Username:     "targetuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), targetUser)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/"+targetUserID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("Expected status 204, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthHandler_DeleteUser_CannotDeleteSelf(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	adminUserID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	adminUser := &models.User{
		ID:           adminUserID,
		Username:     "admin",
		PasswordHash: hashedPassword,
		Role:         auth.RoleAdmin,
	}
	repo.CreateUser(context.Background(), adminUser)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   adminUserID,
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/"+adminUserID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test UnlockUser endpoint
func TestAuthHandler_UnlockUser_Success(t *testing.T) {
	repo := setupTestRepoForAuth(t)
	defer repo.Close()

	cfg := &config.Config{
		AuthMode:     "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	handler := NewAuthHandler(repo, cfg)

	targetUserID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	targetUser := &models.User{
		ID:           targetUserID,
		Username:     "targetuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), targetUser)
	// Lock the user
	repo.LockUser(context.Background(), targetUserID, time.Now().Add(30*time.Minute))

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   uuid.New().String(),
				Username: "admin",
				Role:     auth.RoleAdmin,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	handler.RegisterRoutes(api)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/"+targetUserID+"/unlock", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}
}
