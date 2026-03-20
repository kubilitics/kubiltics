// SecureHeaders adds security-related HTTP response headers (D1.2).
package middleware

import (
	"net/http"

	"github.com/kubilitics/kubilitics-backend/internal/config"
)

// SecureHeaders sets headers to mitigate common issues (XSS, clickjacking, MIME sniffing).
// When TLS is enabled, also sets HSTS header for enhanced security.
func SecureHeaders(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("X-XSS-Protection", "1; mode=block")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
			w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
			
			// Add HSTS header when TLS is enabled
			if cfg != nil && cfg.TLSEnabled {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			
			next.ServeHTTP(w, r)
		})
	}
}
