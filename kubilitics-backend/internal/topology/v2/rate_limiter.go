package v2

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// RateLimiter controls the rate of Kubernetes API calls.
// Implements semaphore-based concurrency limiting, per-cluster rate limiting,
// and circuit breaker pattern.
type RateLimiter struct {
	mu            sync.RWMutex
	semaphore     chan struct{}
	maxConcurrent int
	maxPerMinute  int
	counters      map[string]*clusterCounter
	circuits      map[string]*circuitBreaker
}

type clusterCounter struct {
	count     int64
	resetTime time.Time
}

type circuitBreaker struct {
	failures     int
	lastFailure  time.Time
	open         bool
	cooldownSecs int
}

const (
	DefaultMaxConcurrent = 10
	DefaultMaxPerMinute  = 20
	CircuitBreakerLimit  = 5
	CircuitCooldownSecs  = 60
)

// NewRateLimiter creates a RateLimiter with configurable limits.
func NewRateLimiter(maxConcurrent, maxPerMinute int) *RateLimiter {
	if maxConcurrent <= 0 {
		maxConcurrent = DefaultMaxConcurrent
	}
	if maxPerMinute <= 0 {
		maxPerMinute = DefaultMaxPerMinute
	}
	return &RateLimiter{
		semaphore:     make(chan struct{}, maxConcurrent),
		maxConcurrent: maxConcurrent,
		maxPerMinute:  maxPerMinute,
		counters:      make(map[string]*clusterCounter),
		circuits:      make(map[string]*circuitBreaker),
	}
}

// Acquire obtains a concurrency slot. Blocks until available or context cancelled.
func (r *RateLimiter) Acquire(ctx context.Context) error {
	select {
	case r.semaphore <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Release returns a concurrency slot.
func (r *RateLimiter) Release() {
	<-r.semaphore
}

// AllowCluster checks if a topology build is allowed for the given cluster.
// Enforces per-cluster rate limit of maxPerMinute builds per minute.
func (r *RateLimiter) AllowCluster(clusterID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	counter, ok := r.counters[clusterID]
	if !ok || now.After(counter.resetTime) {
		r.counters[clusterID] = &clusterCounter{
			count:     1,
			resetTime: now.Add(time.Minute),
		}
		return true
	}

	if atomic.LoadInt64(&counter.count) >= int64(r.maxPerMinute) {
		return false
	}

	atomic.AddInt64(&counter.count, 1)
	return true
}

// CheckCircuit returns true if the circuit is closed (API calls allowed)
// for the given resource type.
func (r *RateLimiter) CheckCircuit(resourceType string) bool {
	r.mu.RLock()
	cb, ok := r.circuits[resourceType]
	r.mu.RUnlock()

	if !ok {
		return true
	}

	if cb.open {
		if time.Since(cb.lastFailure) > time.Duration(cb.cooldownSecs)*time.Second {
			// Half-open: allow one request
			r.mu.Lock()
			cb.open = false
			cb.failures = 0
			r.mu.Unlock()
			return true
		}
		return false
	}

	return true
}

// RecordFailure records a failure for the circuit breaker.
// After CircuitBreakerLimit consecutive failures, the circuit opens.
func (r *RateLimiter) RecordFailure(resourceType string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	cb, ok := r.circuits[resourceType]
	if !ok {
		cb = &circuitBreaker{cooldownSecs: CircuitCooldownSecs}
		r.circuits[resourceType] = cb
	}

	cb.failures++
	cb.lastFailure = time.Now()

	if cb.failures >= CircuitBreakerLimit {
		cb.open = true
	}
}

// RecordSuccess resets the circuit breaker for the given resource type.
func (r *RateLimiter) RecordSuccess(resourceType string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if cb, ok := r.circuits[resourceType]; ok {
		cb.failures = 0
		cb.open = false
	}
}

// Stats returns current rate limiter statistics.
type RateLimiterStats struct {
	ActiveSlots   int
	MaxConcurrent int
	MaxPerMinute  int
	OpenCircuits  []string
}

func (r *RateLimiter) Stats() RateLimiterStats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var openCircuits []string
	for name, cb := range r.circuits {
		if cb.open {
			openCircuits = append(openCircuits, name)
		}
	}

	return RateLimiterStats{
		ActiveSlots:   len(r.semaphore),
		MaxConcurrent: r.maxConcurrent,
		MaxPerMinute:  r.maxPerMinute,
		OpenCircuits:  openCircuits,
	}
}
