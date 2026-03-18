// Package logging provides structured logging for kcli using log/slog.
//
// By default the logger is a no-op (level "off"). Call Init to configure
// a TextHandler writing to stderr. The log level can also be set via the
// KCLI_LOG_LEVEL environment variable.
package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
)

// logger is the package-level slog.Logger. It starts as a no-op (discards
// everything) and is replaced by Init when the user opts in to logging.
var logger atomic.Pointer[slog.Logger]

func init() {
	// Default: discard all log output.
	nop := slog.New(nopHandler{})
	logger.Store(nop)
}

// Init configures the package logger. The level string is case-insensitive
// and supports "debug", "info", "warn", "error", and "off" (the default).
// If level is empty, Init reads KCLI_LOG_LEVEL from the environment.
// An unrecognised or empty value is treated as "off" (no-op logger).
func Init(level string) {
	if level == "" {
		level = os.Getenv("KCLI_LOG_LEVEL")
	}
	lvl, ok := parseLevel(level)
	if !ok {
		// "off" or unrecognised — keep the no-op logger.
		return
	}
	h := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: lvl,
	})
	logger.Store(slog.New(h))
}

// Logger returns the current package-level *slog.Logger. Useful when callers
// need to pass a logger to libraries or create child loggers with With().
func Logger() *slog.Logger {
	return logger.Load()
}

// Convenience functions that delegate to the package logger.

func Debug(msg string, args ...any) { logger.Load().Debug(msg, args...) }
func Info(msg string, args ...any)  { logger.Load().Info(msg, args...) }
func Warn(msg string, args ...any)  { logger.Load().Warn(msg, args...) }
func Error(msg string, args ...any) { logger.Load().Error(msg, args...) }

// parseLevel maps a level string to slog.Level. Returns false for "off" or
// unrecognised values.
func parseLevel(s string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	default:
		return 0, false
	}
}

// nopHandler is a slog.Handler that discards all records.
type nopHandler struct{}

func (nopHandler) Enabled(context.Context, slog.Level) bool  { return false }
func (nopHandler) Handle(context.Context, slog.Record) error  { return nil }
func (h nopHandler) WithAttrs([]slog.Attr) slog.Handler       { return h }
func (h nopHandler) WithGroup(string) slog.Handler            { return h }
