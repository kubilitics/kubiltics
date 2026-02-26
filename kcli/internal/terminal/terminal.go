// Package terminal provides cross-platform terminal capability detection.
// P2-10: Windows compatibility — disable ANSI colors in cmd.exe and older PowerShell.
package terminal

import (
	"os"
	"runtime"
	"strings"
)

// ColorDisabled returns true when ANSI colors should be disabled.
// - KCLI_NO_COLOR or NO_COLOR env set (any value)
// - Windows without Windows Terminal (cmd.exe, older PowerShell)
//
// Windows Terminal is detected via WT_SESSION or TERM_PROGRAM=WindowsTerminal.
// Full color and TUI support requires Windows Terminal.
func ColorDisabled() bool {
	if strings.TrimSpace(os.Getenv("KCLI_NO_COLOR")) != "" || strings.TrimSpace(os.Getenv("NO_COLOR")) != "" {
		return true
	}
	if runtime.GOOS != "windows" {
		return false
	}
	// Windows: enable only for Windows Terminal
	wtSession := strings.TrimSpace(os.Getenv("WT_SESSION"))
	termProgram := strings.TrimSpace(os.Getenv("TERM_PROGRAM"))
	return wtSession == "" && termProgram != "WindowsTerminal"
}
