package proxy

import (
	"sync"

	"golang.org/x/time/rate"
)

// rateLimiter holds one token bucket per user. perMin is the steady-state
// rate; burst equals perMin (allows a 1-minute spike without throttling
// new users).
type rateLimiter struct {
	perMin  int
	mu      sync.Mutex
	buckets map[string]*rate.Limiter
}

func newRateLimiter(perMin int) *rateLimiter {
	return &rateLimiter{perMin: perMin, buckets: make(map[string]*rate.Limiter)}
}

func (r *rateLimiter) allow(userID string) bool {
	r.mu.Lock()
	lim, ok := r.buckets[userID]
	if !ok {
		lim = rate.NewLimiter(rate.Limit(float64(r.perMin)/60.0), r.perMin)
		r.buckets[userID] = lim
	}
	r.mu.Unlock()
	return lim.Allow()
}
