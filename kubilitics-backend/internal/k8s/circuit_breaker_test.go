package k8s

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNewCircuitBreaker(t *testing.T) {
	cb := NewCircuitBreaker("")
	if cb == nil {
		t.Fatal("Circuit breaker should not be nil")
	}
	if cb.State() != StateClosed {
		t.Errorf("Expected initial state to be Closed, got %v", cb.State())
	}
	if cb.FailureCount() != 0 {
		t.Errorf("Expected initial failure count to be 0, got %d", cb.FailureCount())
	}
}

func TestCircuitBreaker_Execute_Success(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	err := cb.Execute(ctx, func() error {
		return nil
	})

	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if cb.State() != StateClosed {
		t.Errorf("Expected state to be Closed, got %v", cb.State())
	}
	if cb.FailureCount() != 0 {
		t.Errorf("Expected failure count to be 0, got %d", cb.FailureCount())
	}
}

func TestCircuitBreaker_Execute_RetryableError(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	// Simulate retryable errors
	retryableErr := errors.New("connection refused")
	for i := 0; i < 4; i++ {
		err := cb.Execute(ctx, func() error {
			return retryableErr
		})
		if err != retryableErr {
			t.Errorf("Expected retryable error, got %v", err)
		}
		if cb.State() != StateClosed {
			t.Errorf("Expected state to be Closed after %d failures, got %v", i+1, cb.State())
		}
	}

	// 5th failure should open the circuit
	err := cb.Execute(ctx, func() error {
		return retryableErr
	})
	if err != retryableErr {
		t.Errorf("Expected retryable error, got %v", err)
	}
	if cb.State() != StateOpen {
		t.Errorf("Expected state to be Open after 5 failures, got %v", cb.State())
	}
}

func TestCircuitBreaker_Execute_OpenState(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	// Open the circuit
	retryableErr := errors.New("connection refused")
	for i := 0; i < 5; i++ {
		cb.Execute(ctx, func() error {
			return retryableErr
		})
	}

	// Circuit should be open
	if cb.State() != StateOpen {
		t.Fatalf("Expected circuit to be open, got %v", cb.State())
	}

	// Execute should fail fast
	err := cb.Execute(ctx, func() error {
		return nil
	})
	if err != ErrCircuitOpen {
		t.Errorf("Expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreaker_Execute_NonRetryableError(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	// Non-retryable errors should not count toward failure threshold
	nonRetryableErr := errors.New("not found")
	for i := 0; i < 10; i++ {
		err := cb.Execute(ctx, func() error {
			return nonRetryableErr
		})
		if err != nonRetryableErr {
			t.Errorf("Expected non-retryable error, got %v", err)
		}
		if cb.State() != StateClosed {
			t.Errorf("Expected state to remain Closed, got %v", cb.State())
		}
		if cb.FailureCount() != 0 {
			t.Errorf("Expected failure count to remain 0, got %d", cb.FailureCount())
		}
	}
}

func TestCircuitBreaker_Execute_ContextTimeout(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	time.Sleep(100 * time.Millisecond) // Ensure context is expired

	err := cb.Execute(ctx, func() error {
		return ctx.Err()
	})

	if err == nil {
		t.Error("Expected context timeout error")
	}
	if cb.FailureCount() > 0 {
		t.Logf("Context timeout counted as retryable error (failure count: %d)", cb.FailureCount())
	}
}

func TestCircuitBreaker_Execute_HalfOpenTransition(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	// Open the circuit
	retryableErr := errors.New("connection refused")
	for i := 0; i < 5; i++ {
		cb.Execute(ctx, func() error {
			return retryableErr
		})
	}

	if cb.State() != StateOpen {
		t.Fatalf("Expected circuit to be open, got %v", cb.State())
	}

	// Wait for open duration to pass
	cb.mu.Lock()
	cb.lastFailureTime = time.Now().Add(-31 * time.Second) // Make it past open duration
	cb.mu.Unlock()

	// Next call should transition to half-open
	err := cb.Execute(ctx, func() error {
		return nil
	})

	if err != nil {
		t.Errorf("Expected success in half-open state, got %v", err)
	}
	if cb.State() != StateClosed {
		t.Errorf("Expected state to be Closed after successful half-open call, got %v", cb.State())
	}
}

func TestCircuitBreaker_Execute_HalfOpenFailure(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	// Open the circuit
	retryableErr := errors.New("connection refused")
	for i := 0; i < 5; i++ {
		cb.Execute(ctx, func() error {
			return retryableErr
		})
	}

	// Wait for open duration to pass
	cb.mu.Lock()
	cb.lastFailureTime = time.Now().Add(-31 * time.Second)
	cb.mu.Unlock()

	// Half-open call fails - should go back to open
	err := cb.Execute(ctx, func() error {
		return retryableErr
	})

	if err != retryableErr {
		t.Errorf("Expected retryable error, got %v", err)
	}
	if cb.State() != StateOpen {
		t.Errorf("Expected state to be Open after half-open failure, got %v", cb.State())
	}
}

func TestCircuitBreaker_State(t *testing.T) {
	cb := NewCircuitBreaker("")
	if cb.State() != StateClosed {
		t.Errorf("Expected initial state Closed, got %v", cb.State())
	}
}

func TestCircuitBreaker_FailureCount(t *testing.T) {
	cb := NewCircuitBreaker("")
	ctx := context.Background()

	if cb.FailureCount() != 0 {
		t.Errorf("Expected initial failure count 0, got %d", cb.FailureCount())
	}

	retryableErr := errors.New("connection refused")
	cb.Execute(ctx, func() error {
		return retryableErr
	})

	if cb.FailureCount() != 1 {
		t.Errorf("Expected failure count 1, got %d", cb.FailureCount())
	}
}

func TestIsRetryableError_ContextDeadlineExceeded(t *testing.T) {
	err := context.DeadlineExceeded
	if !isRetryableError(err) {
		t.Error("Context deadline exceeded should be retryable")
	}
}

func TestIsRetryableError_ContextCanceled(t *testing.T) {
	err := context.Canceled
	if !isRetryableError(err) {
		t.Error("Context canceled should be retryable")
	}
}

func TestIsRetryableError_NetworkErrors(t *testing.T) {
	networkErrors := []string{
		"connection refused",
		"connection reset",
		"timeout",
		"network error",
		"unreachable",
		"no such host",
		"dial tcp",
		"i/o timeout",
	}

	for _, errMsg := range networkErrors {
		err := errors.New(errMsg)
		if !isRetryableError(err) {
			t.Errorf("Network error '%s' should be retryable", errMsg)
		}
	}
}

func TestIsRetryableError_NonRetryable(t *testing.T) {
	err := errors.New("not found")
	if isRetryableError(err) {
		t.Error("Non-retryable error should not be retryable")
	}
}

func TestContainsAny(t *testing.T) {
	tests := []struct {
		s          string
		substrings []string
		expected   bool
	}{
		{"connection refused", []string{"connection", "refused"}, true},
		{"timeout error", []string{"timeout"}, true},
		{"success", []string{"error", "fail"}, false},
		{"", []string{"test"}, false},
		{"test", []string{""}, true},
	}

	for _, tt := range tests {
		result := containsAny(tt.s, tt.substrings)
		if result != tt.expected {
			t.Errorf("containsAny(%q, %v) = %v, expected %v", tt.s, tt.substrings, result, tt.expected)
		}
	}
}
