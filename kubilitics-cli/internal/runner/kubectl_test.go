package runner

import (
	"testing"
	"time"
)

func TestDefaultTimeout(t *testing.T) {
	if defaultKubectlTimeout != 15*time.Second {
		t.Errorf("defaultKubectlTimeout = %v, want 15s", defaultKubectlTimeout)
	}
}
