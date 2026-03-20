// Package k8s provides circuit breaker for Kubernetes API calls (BE-SCALE-001).
package k8s

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

var (
	// ErrCircuitOpen is returned when the circuit breaker is open.
	ErrCircuitOpen = errors.New("circuit breaker is open: cluster API unavailable")
)

// CircuitBreakerState represents the state of a circuit breaker.
type CircuitBreakerState int

const (
	StateClosed CircuitBreakerState = iota // Normal operation
	StateOpen                               // Circuit is open, failing fast
	StateHalfOpen                           // Testing if service recovered
)

// CircuitBreaker implements a circuit breaker pattern for Kubernetes API calls.
// After 5 consecutive failures, the circuit opens for 30 seconds.
// BE-SCALE-001: Prevents cascading failures and provides fast-fail behavior.
type CircuitBreaker struct {
	mu sync.RWMutex

	// Configuration
	failureThreshold int           // Number of consecutive failures before opening (default: 5)
	openDuration     time.Duration // Duration to keep circuit open (default: 30s)
	halfOpenMaxCalls int           // Max calls allowed in half-open state (default: 1)
	clusterID        string        // Cluster ID for metrics labeling

	// State
	state            CircuitBreakerState
	failureCount     int
	lastFailureTime  time.Time
	halfOpenCallCount int
	lastStateChange  time.Time
}

// NewCircuitBreaker creates a new circuit breaker with default settings.
func NewCircuitBreaker(clusterID string) *CircuitBreaker {
	cb := &CircuitBreaker{
		failureThreshold: 5,
		openDuration:     30 * time.Second,
		halfOpenMaxCalls: 1,
		state:            StateClosed,
		clusterID:        clusterID,
		lastStateChange:  time.Now(),
	}
	// Initialize metrics
	metrics.CircuitBreakerState.WithLabelValues(clusterID).Set(float64(StateClosed))
	return cb
}

// setState updates the circuit breaker state and records metrics
func (cb *CircuitBreaker) setState(newState CircuitBreakerState) {
	if cb.state != newState {
		fromState := stateToString(cb.state)
		toState := stateToString(newState)
		
		metrics.CircuitBreakerTransitionsTotal.WithLabelValues(cb.clusterID, fromState, toState).Inc()
		metrics.CircuitBreakerState.WithLabelValues(cb.clusterID).Set(float64(newState))
		
		cb.state = newState
		cb.lastStateChange = time.Now()
	}
}

// stateToString converts CircuitBreakerState to string for metrics
func stateToString(state CircuitBreakerState) string {
	switch state {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// Reset forcibly closes the circuit breaker and clears all failure state.
// Call this when external evidence shows the backend is healthy (e.g. reconnect request).
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failureCount = 0
	cb.halfOpenCallCount = 0
	cb.setState(StateClosed)
}

// Execute executes a function with circuit breaker protection.
func (cb *CircuitBreaker) Execute(ctx context.Context, fn func() error) error {
	cb.mu.Lock()
	state := cb.state
	if state == StateOpen {
		// Check if we should transition to half-open
		if time.Since(cb.lastFailureTime) >= cb.openDuration {
			cb.setState(StateHalfOpen)
			cb.halfOpenCallCount = 0
			state = StateHalfOpen
		}
	}
	if state == StateHalfOpen {
		if cb.halfOpenCallCount >= cb.halfOpenMaxCalls {
			cb.mu.Unlock()
			return ErrCircuitOpen
		}
		cb.halfOpenCallCount++
	}
	cb.mu.Unlock()

	if state == StateOpen {
		return ErrCircuitOpen
	}

	// Execute the function
	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		// Check if error is retryable (network errors, timeouts, 5xx, 429)
		if isRetryableError(err) {
			cb.failureCount++
			cb.lastFailureTime = time.Now()
			metrics.CircuitBreakerFailuresTotal.WithLabelValues(cb.clusterID).Inc()

			if cb.state == StateHalfOpen {
				// Half-open call failed, go back to open
				cb.setState(StateOpen)
				cb.halfOpenCallCount = 0
			} else if cb.failureCount >= cb.failureThreshold {
				// Too many failures, open the circuit
				cb.setState(StateOpen)
				cb.lastFailureTime = time.Now()
			}
		} else {
			// Non-retryable error (e.g., 404, 403), reset failure count
			cb.failureCount = 0
		}
		return err
	}

	// Success: reset failure count and close circuit if it was open/half-open
	cb.failureCount = 0
	if cb.state != StateClosed {
		cb.setState(StateClosed)
		cb.halfOpenCallCount = 0
	}

	return nil
}

// ExecuteValue executes a function that returns a value with circuit breaker protection.
// This is a helper that wraps Execute for functions returning values.
func (cb *CircuitBreaker) ExecuteValue(ctx context.Context, fn func() error) error {
	return cb.Execute(ctx, fn)
}

// State returns the current state of the circuit breaker.
func (cb *CircuitBreaker) State() CircuitBreakerState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// FailureCount returns the current failure count.
func (cb *CircuitBreaker) FailureCount() int {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.failureCount
}

// isRetryableError checks if an error is retryable (network errors, timeouts, 5xx, 429).
// Uses the existing isRetryable function from retry.go for consistency.
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	// Check for context timeout/cancel
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}

	// Use existing isRetryable function for Kubernetes API errors
	if isRetryable(err) {
		return true
	}

	// Network errors are typically retryable
	errStr := err.Error()
	return containsAny(errStr, []string{
		"connection refused",
		"connection reset",
		"timeout",
		"network",
		"unreachable",
		"no such host",
		"dial tcp",
		"i/o timeout",
	})
}

// containsAny checks if a string contains any of the substrings.
func containsAny(s string, substrings []string) bool {
	for _, sub := range substrings {
		if len(s) >= len(sub) {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}
