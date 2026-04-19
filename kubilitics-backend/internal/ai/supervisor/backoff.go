package supervisor

import "time"

// backoff implements exponential backoff (1, 2, 4, 8, 16, 30, 30, ...) with
// a hard restart cap inside a sliding window. After the window elapses
// without attempts, the counter resets.
type backoff struct {
	maxAttempts int
	window      time.Duration
	attempts    int
	lastAttempt time.Time
}

func newBackoff(maxAttempts int, window time.Duration) *backoff {
	return &backoff{maxAttempts: maxAttempts, window: window}
}

// next returns (delay, exhausted). Caller passes the current time.
func (b *backoff) next(now time.Time) (time.Duration, bool) {
	if !b.lastAttempt.IsZero() && now.Sub(b.lastAttempt) > b.window {
		b.attempts = 0
	}
	if b.attempts >= b.maxAttempts {
		return 0, true
	}
	delay := time.Duration(1<<uint(b.attempts)) * time.Second
	if delay > 30*time.Second {
		delay = 30 * time.Second
	}
	b.attempts++
	b.lastAttempt = now
	return delay, false
}

func (b *backoff) reset() {
	b.attempts = 0
	b.lastAttempt = time.Time{}
}
