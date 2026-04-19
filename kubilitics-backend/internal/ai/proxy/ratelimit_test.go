package proxy

import "testing"

func TestRateLimiterAllowsUnderBudget(t *testing.T) {
	rl := newRateLimiter(60) // 60/min = 1/sec, burst 60
	for i := 0; i < 60; i++ {
		if !rl.allow("user-a") {
			t.Fatalf("rejected request %d, expected all to pass under budget", i+1)
		}
	}
}

func TestRateLimiterBlocksOverBudget(t *testing.T) {
	rl := newRateLimiter(2)
	rl.allow("user-a")
	rl.allow("user-a")
	if rl.allow("user-a") {
		t.Fatalf("expected 3rd rapid request to be blocked")
	}
}

func TestRateLimiterPerUser(t *testing.T) {
	rl := newRateLimiter(2)
	rl.allow("user-a")
	rl.allow("user-a")
	if !rl.allow("user-b") {
		t.Fatalf("user-b should not be impacted by user-a's bucket")
	}
}
