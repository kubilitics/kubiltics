package k8s

import (
	"context"
	"errors"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

const (
	defaultRetryAttempts = 3
	initialBackoff        = 100 * time.Millisecond
	maxBackoff            = 2 * time.Second
)

// isRetryable returns true for 5xx and 429 (too many requests).
func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	if apierrors.IsTooManyRequests(err) {
		return true
	}
	if apierrors.IsInternalError(err) || apierrors.IsServerTimeout(err) {
		return true
	}
	var se *apierrors.StatusError
	if errors.As(err, &se) && se.ErrStatus.Code >= 500 {
		return true
	}
	return false
}

// backoff returns delay for attempt (0-based); exponential with cap.
func backoff(attempt int) time.Duration {
	d := initialBackoff
	for i := 0; i < attempt && d < maxBackoff; i++ {
		d = d * 3
		if d > maxBackoff {
			d = maxBackoff
		}
	}
	return d
}

// doWithRetry runs fn up to maxAttempts times; retries on 5xx/429 with backoff. Non-retryable errors return immediately.
func doWithRetry(ctx context.Context, maxAttempts int, fn func() error) error {
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		lastErr = fn()
		if lastErr == nil {
			return nil
		}
		if attempt == maxAttempts-1 || !isRetryable(lastErr) {
			return lastErr
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff(attempt)):
			// continue
		}
	}
	return lastErr
}

// doWithRetryValue runs fn up to maxAttempts times and returns its value; retries on 5xx/429.
func doWithRetryValue[T any](ctx context.Context, maxAttempts int, fn func() (T, error)) (T, error) {
	var zero T
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		val, err := fn()
		if err == nil {
			return val, nil
		}
		lastErr = err
		if attempt == maxAttempts-1 || !isRetryable(err) {
			return zero, err
		}
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(backoff(attempt)):
			// continue
		}
	}
	return zero, lastErr
}
