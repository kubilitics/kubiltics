package middleware

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// writeJSONError writes a JSON error response with proper encoding to prevent JSON injection.
// Replaces raw string concatenation like `{"error":"` + msg + `"}` (P2-SEC-004).
// Uses json.Marshal instead of json.NewEncoder.Encode to avoid trailing newline.
func writeJSONError(w http.ResponseWriter, statusCode int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	b, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		// Fallback: this should never happen with a simple string map
		w.Write([]byte(`{"error":"internal error"}`))
		return
	}
	w.Write(b)
}

// Auth returns middleware that enforces auth mode (disabled | optional | required) and sets claims in context.
// BE-AUTH-003: Also accepts API keys via X-API-Key header.
func Auth(cfg *config.Config, repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/health" || path == "/metrics" ||
				path == "/api/v1/auth/login" || path == "/api/v1/auth/refresh" || path == "/api/v1/auth/logout" {
				next.ServeHTTP(w, r)
				return
			}
			mode := strings.ToLower(strings.TrimSpace(cfg.AuthMode))
			if mode == "" {
				mode = "disabled"
			}
			if mode == "disabled" {
				next.ServeHTTP(w, r)
				return
			}
			// BE-AUTH-003: Try API key first, then Bearer token
			apiKey := r.Header.Get("X-API-Key")
			if apiKey != "" && repo != nil {
			claims, err := validateAPIKey(r.Context(), repo, apiKey)
			if err == nil && claims != nil {
				metrics.AuthAPIKeyValidationsTotal.WithLabelValues("success").Inc()
				ctx := auth.WithClaims(r.Context(), claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			// Record failed API key validation
			if mode == "required" {
				metrics.AuthAPIKeyValidationsTotal.WithLabelValues("failure").Inc()
				// P2-SEC: Log failed API key attempt with source IP for audit trail
				log.Printf("[auth] FAILED: invalid API key from %s for %s %s", r.RemoteAddr, r.Method, r.URL.Path)
			}
				// If API key validation fails and mode is required, return error
				if mode == "required" {
					writeJSONError(w, http.StatusUnauthorized, "Invalid or expired API key")
					return
				}
			}
			// Try Bearer token (with deprecation notice for ?token= query parameter)
			token := extractBearerWithDeprecation(r, w)
			if token == "" {
				if mode == "required" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					writeJSONError(w, http.StatusUnauthorized, "Authentication required")
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			claims, err := auth.ValidateTokenWithRepo(r.Context(), cfg.AuthJWTSecret, token, repo)
			if err != nil {
				if mode == "required" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					errorMsg := "Invalid or expired token"
					if err == auth.ErrTokenRevoked {
						errorMsg = "Token has been revoked"
					}
					// P2-SEC: Log failed JWT attempt with source IP and reason for audit trail
					log.Printf("[auth] FAILED: %s from %s for %s %s", errorMsg, r.RemoteAddr, r.Method, r.URL.Path)
					writeJSONError(w, http.StatusUnauthorized, errorMsg)
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			if claims.Refresh {
				if mode == "required" {
					w.Header().Set("WWW-Authenticate", "Bearer")
					// P2-SEC: Log refresh token misuse for audit trail
					log.Printf("[auth] FAILED: refresh token used as access token from %s for %s %s (user_id=%s)",
						r.RemoteAddr, r.Method, r.URL.Path, claims.UserID)
					writeJSONError(w, http.StatusUnauthorized, "Use access token for this request")
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			ctx := auth.WithClaims(r.Context(), claims)
			
			// Phase 4: Update session activity
			if repo != nil && claims.ID != "" {
				session, err := repo.GetSessionByTokenID(ctx, claims.ID)
				if err == nil && session != nil && !session.IsExpired() {
					_ = repo.UpdateSessionActivity(ctx, session.ID)
				}
			}
			
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// validateAPIKey validates an API key and returns claims (BE-AUTH-003).
func validateAPIKey(ctx context.Context, repo *repository.SQLiteRepository, plaintextKey string) (*auth.Claims, error) {
	return findAPIKeyByPlaintext(ctx, repo, plaintextKey)
}

// findAPIKeyByPlaintext finds an API key by checking all stored hashes against the plaintext (BE-AUTH-003).
func findAPIKeyByPlaintext(ctx context.Context, repo *repository.SQLiteRepository, plaintextKey string) (*auth.Claims, error) {
	apiKey, err := repo.FindAPIKeyByPlaintext(ctx, plaintextKey)
	if err != nil || apiKey == nil {
		return nil, err
	}
	
	// Check if expired
	if apiKey.IsExpired() {
		return nil, auth.ErrExpiredToken
	}
	
	// Get user to build claims
	user, err := repo.GetUserByID(ctx, apiKey.UserID)
	if err != nil || user == nil {
		return nil, err
	}
	
	// Update last used
	_ = repo.UpdateAPIKeyLastUsed(ctx, apiKey.ID)
	
	// Build claims with RegisteredClaims.ExpiresAt and ID populated from the API key,
	// so downstream code can consistently check expiry (P2-SEC: API key Claims Exp field).
	rc := jwt.RegisteredClaims{
		Subject:  user.ID,
		IssuedAt: jwt.NewNumericDate(apiKey.CreatedAt),
		ID:       apiKey.ID,
	}
	if apiKey.ExpiresAt != nil {
		rc.ExpiresAt = jwt.NewNumericDate(*apiKey.ExpiresAt)
	}
	claims := &auth.Claims{
		RegisteredClaims: rc,
		UserID:           user.ID,
		Username:         user.Username,
		Role:             user.Role,
		Refresh:          false,
	}
	return claims, nil
}

// extractBearerWithDeprecation extracts a Bearer token from the Authorization header.
// Falls back to ?token= query parameter (DEPRECATED — will be removed in a future version).
// When the query parameter is used, sets a Deprecation header and logs a warning.
func extractBearerWithDeprecation(r *http.Request, w http.ResponseWriter) string {
	s := r.Header.Get("Authorization")
	if s == "" {
		token := r.URL.Query().Get("token")
		if token != "" {
			// DEPRECATED: ?token= query parameter exposes JWT in URL (logs, browser history, Referer header).
			// Clients should migrate to: Authorization: Bearer <token>
			w.Header().Set("Deprecation", "true")
			w.Header().Set("Sunset", "2026-12-31")
			w.Header().Set("X-Deprecation-Notice", "Query parameter ?token= is deprecated; use Authorization: Bearer <token> header instead")
			log.Printf("[auth] DEPRECATED: ?token= query parameter used from %s for %s %s — migrate to Authorization header",
				r.RemoteAddr, r.Method, r.URL.Path)
			metrics.AuthDeprecatedTokenQueryTotal.Inc()
		}
		return token
	}
	const prefix = "Bearer "
	if len(s) > len(prefix) && strings.EqualFold(s[:len(prefix)], prefix) {
		return strings.TrimSpace(s[len(prefix):])
	}
	return ""
}
