package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// BE-FUNC-003: Per-IP rate limiting for frontend API calls.

const (
	// Standard API: 60 requests/minute per IP
	rateLimitStandardPerMin = 60
	rateLimitStandardBurst  = 60
	// GET requests: 120 requests/minute per IP
	rateLimitGetPerMin = 120
	rateLimitGetBurst  = 120
	// Exec/shell: 10 requests/minute per IP
	rateLimitExecPerMin = 10
	rateLimitExecBurst  = 10
)

type rateLimitTier int

const (
	tierExec rateLimitTier = iota
	tierGet
	tierStandard
)

func (t rateLimitTier) limiterConfig() (rate.Limit, int) {
	switch t {
	case tierExec:
		return rate.Limit(float64(rateLimitExecPerMin) / 60.0), rateLimitExecBurst
	case tierGet:
		return rate.Limit(float64(rateLimitGetPerMin) / 60.0), rateLimitGetBurst
	default:
		return rate.Limit(float64(rateLimitStandardPerMin) / 60.0), rateLimitStandardBurst
	}
}

func (t rateLimitTier) limitHeader() int {
	switch t {
	case tierExec:
		return rateLimitExecPerMin
	case tierGet:
		return rateLimitGetPerMin
	default:
		return rateLimitStandardPerMin
	}
}

// apiRateLimiter holds per-IP limiters per tier (BE-FUNC-003).
type apiRateLimiter struct {
	mu      sync.Mutex
	get     map[string]*rate.Limiter
	standard map[string]*rate.Limiter
	exec    map[string]*rate.Limiter
}

var defaultAPIRateLimiter = &apiRateLimiter{
	get:     make(map[string]*rate.Limiter),
	standard: make(map[string]*rate.Limiter),
	exec:    make(map[string]*rate.Limiter),
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if idx := strings.Index(xff, ","); idx > 0 {
			return strings.TrimSpace(xff[:idx])
		}
		return strings.TrimSpace(xff)
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx >= 0 {
		addr = addr[:idx]
	}
	return addr
}

func tierForRequest(r *http.Request) rateLimitTier {
	path := r.URL.Path
	if path == "" {
		path = r.URL.RawPath
	}
	path = strings.ToLower(path)
	// Exec and shell endpoints: strictest limit
	if strings.Contains(path, "/exec") || strings.Contains(path, "/shell") || strings.Contains(path, "/kcli/exec") || strings.Contains(path, "/kcli/stream") {
		return tierExec
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return tierGet
	}
	return tierStandard
}

func (l *apiRateLimiter) getLimiter(ip string, t rateLimitTier) *rate.Limiter {
	limit, burst := t.limiterConfig()
	var m map[string]*rate.Limiter
	switch t {
	case tierExec:
		m = l.exec
	case tierGet:
		m = l.get
	default:
		m = l.standard
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	key := ip
	if lim, ok := m[key]; ok {
		return lim
	}
	lim := rate.NewLimiter(limit, burst)
	m[key] = lim
	return lim
}

// isLoopback returns true for localhost/loopback IPs (127.x.x.x and ::1).
// Kubilitics is a desktop app — all traffic from 127.0.0.1 is the local
// frontend, not untrusted external clients. Loopback traffic is exempt from
// rate limiting so the UI polling loops never hit 429.
func isLoopback(ip string) bool {
	// Strip brackets from IPv6 (e.g. "[::1]" -> "::1")
	ip = strings.Trim(ip, "[]")
	if ip == "::1" || ip == "localhost" {
		return true
	}
	// 127.0.0.0/8
	return strings.HasPrefix(ip, "127.")
}

// RateLimit returns middleware that limits requests per IP (BE-FUNC-003).
// Excludes /health, /metrics, and loopback (127.x/::1 — desktop local traffic).
// Uses token bucket: 60/min standard, 120/min GET, 10/min exec/shell.
// Returns 429 with Retry-After and sets X-RateLimit-* headers.
func RateLimit() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/health" || path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			// Exempt loopback: desktop frontend always connects from 127.0.0.1/::1
			if isLoopback(getClientIP(r)) {
				next.ServeHTTP(w, r)
				return
			}
			ip := getClientIP(r)
			tier := tierForRequest(r)
			limiter := defaultAPIRateLimiter.getLimiter(ip, tier)
			reservation := limiter.Reserve()
			if !reservation.OK() {
				// Burst exhausted and no token available
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(tier.limitHeader()))
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(60*time.Second).Unix(), 10))
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"Too many requests. Please retry after 60 seconds."}`))
				return
			}
			delay := reservation.Delay()
			if delay > 0 {
				reservation.Cancel()
				retryAfter := int(delay.Seconds()) + 1
				if retryAfter > 60 {
					retryAfter = 60
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				w.Header().Set("X-RateLimit-Limit", strconv.Itoa(tier.limitHeader()))
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(delay).Unix(), 10))
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"Too many requests. Please retry later."}`))
				return
			}
			// Request allowed: set rate limit headers (remaining tokens after this request)
			tokens := int(limiter.Tokens())
			if tokens < 0 {
				tokens = 0
			}
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(tier.limitHeader()))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(tokens))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10))
			next.ServeHTTP(w, r)
		})
	}
}
