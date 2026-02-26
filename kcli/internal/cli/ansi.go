// Package cli — ANSI color constants (P2-10: disabled on Windows cmd.exe).
package cli

import (
	"github.com/kubilitics/kcli/internal/terminal"
)

// ANSI escape sequences. Empty when ColorDisabled() (e.g. Windows cmd.exe).
// Full color support requires Windows Terminal (WT_SESSION or TERM_PROGRAM=WindowsTerminal).
var (
	ansiReset  string
	ansiBold   string
	ansiGreen  string
	ansiYellow string
	ansiRed    string
	ansiCyan   string
	ansiGray   string
)

// ansiClearLine is \033[2K\r for clearing the current line (e.g. security scan progress).
var ansiClearLine string

// podColors are 256-color codes for log stream prefixes. Empty when colors disabled.
var podColors []string

func init() {
	if terminal.ColorDisabled() {
		ansiReset = ""
		ansiBold = ""
		ansiGreen = ""
		ansiYellow = ""
		ansiRed = ""
		ansiCyan = ""
		ansiGray = ""
		ansiClearLine = ""
		podColors = []string{"", "", "", "", "", "", ""}
		return
	}
	ansiReset = "\033[0m"
	ansiBold = "\033[1m"
	ansiGreen = "\033[32m"
	ansiYellow = "\033[33m"
	ansiRed = "\033[31m"
	ansiCyan = "\033[36m"
	ansiGray = "\033[90m"
	ansiClearLine = "\033[2K\r"
	podColors = []string{
		"\x1b[38;5;39m", "\x1b[38;5;208m", "\x1b[38;5;112m",
		"\x1b[38;5;177m", "\x1b[38;5;45m", "\x1b[38;5;214m", "\x1b[38;5;141m",
	}
}
