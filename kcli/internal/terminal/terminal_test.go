package terminal

import (
	"os"
	"runtime"
	"testing"
)

func TestColorDisabled_EnvOverride(t *testing.T) {
	// KCLI_NO_COLOR disables colors on any platform
	os.Setenv("KCLI_NO_COLOR", "1")
	defer os.Unsetenv("KCLI_NO_COLOR")
	if !ColorDisabled() {
		t.Error("expected ColorDisabled true when KCLI_NO_COLOR=1")
	}

	os.Unsetenv("KCLI_NO_COLOR")
	os.Setenv("NO_COLOR", "1")
	defer os.Unsetenv("NO_COLOR")
	if !ColorDisabled() {
		t.Error("expected ColorDisabled true when NO_COLOR=1")
	}
}

func TestColorDisabled_NonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("skipping on Windows")
	}
	os.Unsetenv("KCLI_NO_COLOR")
	os.Unsetenv("NO_COLOR")
	if ColorDisabled() {
		t.Error("expected ColorDisabled false on non-Windows when no env override")
	}
}
