package supervisor

import (
	"testing"
	"time"
)

func TestBackoffSchedule(t *testing.T) {
	b := newBackoff(5, 300*time.Second)
	delays := []time.Duration{}
	base := time.Now()
	for i := 0; i < 5; i++ {
		d, exhausted := b.next(base.Add(time.Duration(i) * time.Second))
		if exhausted {
			t.Fatalf("exhausted at attempt %d, want 5 attempts", i+1)
		}
		delays = append(delays, d)
	}
	want := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second}
	for i := range want {
		if delays[i] != want[i] {
			t.Errorf("delays[%d] = %v, want %v", i, delays[i], want[i])
		}
	}
	if _, exhausted := b.next(base.Add(5 * time.Second)); !exhausted {
		t.Fatalf("expected exhausted after cap")
	}
}

func TestBackoffMaxDelay(t *testing.T) {
	b := newBackoff(10, 300*time.Second)
	base := time.Now()
	var lastDelay time.Duration
	for i := 0; i < 10; i++ {
		lastDelay, _ = b.next(base.Add(time.Duration(i) * time.Second))
	}
	if lastDelay != 30*time.Second {
		t.Errorf("max delay = %v, want 30s", lastDelay)
	}
}

func TestBackoffWindowReset(t *testing.T) {
	b := newBackoff(3, 60*time.Second)
	base := time.Now()
	b.next(base)
	b.next(base.Add(10 * time.Second))
	d, exhausted := b.next(base.Add(80 * time.Second))
	if exhausted {
		t.Fatalf("expected window reset, got exhausted")
	}
	if d != 1*time.Second {
		t.Errorf("delay after reset = %v, want 1s", d)
	}
}
