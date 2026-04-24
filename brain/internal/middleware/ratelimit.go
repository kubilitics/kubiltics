package middleware

import (
	"net/http"
	"sync"
	"time"
)

// RateLimiter implements a simple token bucket rate limiter
type RateLimiter struct {
	mu             sync.Mutex
	clients        map[string]*bucket
	requestsPerMin int
	cleanupTicker  *time.Ticker
}

type bucket struct {
	tokens     int
	lastRefill time.Time
}

// NewRateLimiter creates a new rate limiter with the specified requests per minute
func NewRateLimiter(requestsPerMin int) *RateLimiter {
	rl := &RateLimiter{
		clients:        make(map[string]*bucket),
		requestsPerMin: requestsPerMin,
		cleanupTicker:  time.NewTicker(5 * time.Minute),
	}

	// Cleanup stale entries every 5 minutes
	go rl.cleanup()

	return rl
}

// Middleware returns an HTTP middleware that enforces rate limiting
func (rl *RateLimiter) Middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		clientIP := r.RemoteAddr

		if !rl.allow(clientIP) {
			http.Error(w, "Rate limit exceeded. Please try again later.", http.StatusTooManyRequests)
			return
		}

		next(w, r)
	}
}

// allow checks if a request from the given client should be allowed
func (rl *RateLimiter) allow(clientIP string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.clients[clientIP]

	if !exists {
		// New client, create bucket with full tokens
		rl.clients[clientIP] = &bucket{
			tokens:     rl.requestsPerMin - 1,
			lastRefill: now,
		}
		return true
	}

	// Refill tokens based on time elapsed
	elapsed := now.Sub(b.lastRefill)
	tokensToAdd := int(elapsed.Minutes() * float64(rl.requestsPerMin))

	if tokensToAdd > 0 {
		b.tokens = min(rl.requestsPerMin, b.tokens+tokensToAdd)
		b.lastRefill = now
	}

	// Check if we have tokens available
	if b.tokens > 0 {
		b.tokens--
		return true
	}

	return false
}

// cleanup removes stale client entries
func (rl *RateLimiter) cleanup() {
	for range rl.cleanupTicker.C {
		rl.mu.Lock()
		now := time.Now()
		for clientIP, b := range rl.clients {
			// Remove clients that haven't made requests in 10 minutes
			if now.Sub(b.lastRefill) > 10*time.Minute {
				delete(rl.clients, clientIP)
			}
		}
		rl.mu.Unlock()
	}
}

// Stop stops the cleanup ticker
func (rl *RateLimiter) Stop() {
	rl.cleanupTicker.Stop()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
