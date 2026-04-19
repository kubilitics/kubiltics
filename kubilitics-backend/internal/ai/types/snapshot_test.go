package types

import (
	"testing"
	"time"
)

func TestSidecarStateString(t *testing.T) {
	cases := map[SidecarState]string{
		StateStopped:  "stopped",
		StateStarting: "starting",
		StateReady:    "ready",
		StateStopping: "stopping",
		StateCrashed:  "crashed",
	}
	for s, want := range cases {
		if got := s.String(); got != want {
			t.Errorf("SidecarState(%d).String() = %q, want %q", s, got, want)
		}
	}
}

func TestSidecarStatusZero(t *testing.T) {
	var st SidecarStatus
	if st.State.String() != "stopped" {
		t.Errorf("zero status state = %q, want stopped", st.State.String())
	}
	if !st.NextRetryAt.IsZero() {
		t.Errorf("zero NextRetryAt should be zero time, got %v", st.NextRetryAt)
	}
	_ = time.Now()
}
