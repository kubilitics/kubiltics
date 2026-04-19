package supervisor

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestIdleTimerFiresAfterTimeout(t *testing.T) {
	fired := int32(0)
	it := newIdleTimer(50*time.Millisecond, func() {
		atomic.StoreInt32(&fired, 1)
	})
	it.start()
	defer it.stop()

	time.Sleep(120 * time.Millisecond)
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("idle timer did not fire")
	}
}

func TestIdleTimerResets(t *testing.T) {
	fired := int32(0)
	it := newIdleTimer(80*time.Millisecond, func() {
		atomic.StoreInt32(&fired, 1)
	})
	it.start()
	defer it.stop()

	for i := 0; i < 5; i++ {
		time.Sleep(40 * time.Millisecond)
		it.reset()
	}
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("idle timer fired despite resets")
	}
	time.Sleep(120 * time.Millisecond)
	if atomic.LoadInt32(&fired) != 1 {
		t.Fatalf("idle timer never fired after resets stopped")
	}
}

func TestIdleTimerSuppressedWhileStreamsActive(t *testing.T) {
	fired := int32(0)
	it := newIdleTimer(50*time.Millisecond, func() {
		atomic.StoreInt32(&fired, 1)
	})
	it.setActiveStreams(func() int { return 1 })
	it.start()
	defer it.stop()

	time.Sleep(120 * time.Millisecond)
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("idle timer fired while streams were active")
	}
}
