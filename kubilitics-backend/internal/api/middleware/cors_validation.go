package middleware

import (
	"log/slog"
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/config"
)

// CORSValidation validates CORS configuration and logs warnings for security risks.
func CORSValidation(cfg *config.Config, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Check for wildcard CORS on startup (only log once)
			if cfg != nil && len(cfg.AllowedOrigins) > 0 {
				for _, origin := range cfg.AllowedOrigins {
					if origin == "*" || origin == ".*" {
						if !cfg.TLSEnabled {
							log.Warn("CORS wildcard detected without TLS",
								"origin", origin,
								"risk", "Allows any origin to access API",
								"recommendation", "Use specific origins or enable TLS",
							)
						} else {
							log.Warn("CORS wildcard detected",
								"origin", origin,
								"risk", "Allows any origin to access API",
								"recommendation", "Use specific origins for production",
							)
						}
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
