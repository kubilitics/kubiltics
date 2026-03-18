package logging

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestDefaultLoggerIsNop(t *testing.T) {
	// The default logger should discard everything (nopHandler).
	l := Logger()
	if l.Enabled(nil, slog.LevelError) {
		t.Fatal("default logger should not be enabled for any level")
	}
}

func TestParseLevel(t *testing.T) {
	tests := []struct {
		input string
		want  slog.Level
		ok    bool
	}{
		{"debug", slog.LevelDebug, true},
		{"DEBUG", slog.LevelDebug, true},
		{"info", slog.LevelInfo, true},
		{"warn", slog.LevelWarn, true},
		{"error", slog.LevelError, true},
		{"off", 0, false},
		{"", 0, false},
		{"unknown", 0, false},
	}
	for _, tt := range tests {
		got, ok := parseLevel(tt.input)
		if ok != tt.ok {
			t.Errorf("parseLevel(%q): ok = %v, want %v", tt.input, ok, tt.ok)
		}
		if ok && got != tt.want {
			t.Errorf("parseLevel(%q): level = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestInitEnablesLogging(t *testing.T) {
	// Reset to no-op after test.
	defer func() {
		nop := slog.New(nopHandler{})
		logger.Store(nop)
	}()

	Init("debug")
	l := Logger()
	if !l.Enabled(nil, slog.LevelDebug) {
		t.Fatal("after Init(\"debug\"), logger should be enabled for debug level")
	}
}

func TestInitOffKeepsNop(t *testing.T) {
	// Reset to no-op after test.
	defer func() {
		nop := slog.New(nopHandler{})
		logger.Store(nop)
	}()

	Init("off")
	l := Logger()
	if l.Enabled(nil, slog.LevelError) {
		t.Fatal("Init(\"off\") should keep the no-op logger")
	}
}

func TestConvenienceFunctionsDoNotPanic(t *testing.T) {
	// With default no-op logger, calling convenience functions must not panic.
	Debug("test debug", "key", "value")
	Info("test info")
	Warn("test warn", "n", 42)
	Error("test error", "err", "something")
}

func TestNopHandler(t *testing.T) {
	h := nopHandler{}
	if h.Enabled(nil, slog.LevelError) {
		t.Fatal("nopHandler should never be enabled")
	}
	if err := h.Handle(nil, slog.Record{}); err != nil {
		t.Fatal("nopHandler.Handle should return nil")
	}
	if h.WithAttrs(nil) != h {
		t.Fatal("nopHandler.WithAttrs should return itself")
	}
	if h.WithGroup("g") != h {
		t.Fatal("nopHandler.WithGroup should return itself")
	}
}

func TestTextHandlerOutput(t *testing.T) {
	// Verify that when we manually create a TextHandler with a buffer,
	// the slog machinery produces the expected output.
	var buf bytes.Buffer
	h := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	l := slog.New(h)
	l.Info("hello", "key", "val")
	out := buf.String()
	if !strings.Contains(out, "hello") {
		t.Fatalf("expected output to contain 'hello', got: %s", out)
	}
	if !strings.Contains(out, "key=val") {
		t.Fatalf("expected output to contain 'key=val', got: %s", out)
	}
}
