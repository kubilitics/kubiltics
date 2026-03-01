package middleware

import (
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// MetricsAuth protects the /metrics endpoint with optional authentication.
// When metricsAuthEnabled is true, requires valid JWT token or API key.
// When false, /metrics is publicly accessible (default for Prometheus scraping).
func MetricsAuth(cfg *config.Config, repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only protect /metrics endpoint
			if r.URL.Path != "/metrics" {
				next.ServeHTTP(w, r)
				return
			}

			// If metrics auth is disabled, allow access
			if !cfg.MetricsAuthEnabled {
				next.ServeHTTP(w, r)
				return
			}

			// Try API key first
			apiKey := r.Header.Get("X-API-Key")
			if apiKey != "" && repo != nil {
				claims, err := validateAPIKey(r.Context(), repo, apiKey)
				if err == nil && claims != nil {
					next.ServeHTTP(w, r)
					return
				}
			}

			// Try Bearer token (with deprecation notice for ?token= query parameter)
			token := extractBearerWithDeprecation(r, w)
			if token != "" {
				claims, err := auth.ValidateToken(cfg.AuthJWTSecret, token)
				if err == nil && claims != nil && !claims.Refresh {
					next.ServeHTTP(w, r)
					return
				}
			}

			// No valid auth - return 401
			writeJSONError(w, http.StatusUnauthorized, "Authentication required for metrics endpoint")
		})
	}
}
