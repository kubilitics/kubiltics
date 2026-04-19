package supervisor

import (
	"sync"
	"time"
)

// idleTimer fires onFire after `idle` elapses with no reset() calls AND
// no active streams. Reset cancels and reschedules the deadline.
type idleTimer struct {
	idle    time.Duration
	onFire  func()
	streams func() int

	mu      sync.Mutex
	timer   *time.Timer
	started bool
	stopped bool
}

func newIdleTimer(idle time.Duration, onFire func()) *idleTimer {
	return &idleTimer{idle: idle, onFire: onFire, streams: func() int { return 0 }}
}

func (i *idleTimer) setActiveStreams(fn func() int) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.streams = fn
}

func (i *idleTimer) start() {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.started {
		return
	}
	i.started = true
	i.scheduleLocked()
}

func (i *idleTimer) reset() {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !i.started || i.stopped {
		return
	}
	if i.timer != nil {
		i.timer.Stop()
	}
	i.scheduleLocked()
}

func (i *idleTimer) stop() {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.stopped = true
	if i.timer != nil {
		i.timer.Stop()
	}
}

func (i *idleTimer) scheduleLocked() {
	i.timer = time.AfterFunc(i.idle, func() {
		i.mu.Lock()
		if i.stopped {
			i.mu.Unlock()
			return
		}
		if i.streams() > 0 {
			i.scheduleLocked()
			i.mu.Unlock()
			return
		}
		i.mu.Unlock()
		i.onFire()
	})
}
