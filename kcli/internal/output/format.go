// Package output provides a unified output rendering system for kcli-native
// commands.  Every kcli command that produces its own output (as opposed to
// passing through kubectl output) should use this package to ensure consistent
// flag naming, format detection, and rendering.
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
	sigYAML "sigs.k8s.io/yaml"
)

// Format describes the serialisation format for command output.
type Format int

const (
	// FormatAuto chooses FormatTable when stdout is a TTY, FormatPlain
	// otherwise.
	FormatAuto Format = iota
	FormatTable
	FormatJSON
	FormatYAML
	FormatPlain
)

// ParseFlag converts a user-supplied -o/--output value to a Format.
// It returns an error for unknown values.
func ParseFlag(s string) (Format, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "auto":
		return FormatAuto, nil
	case "table":
		return FormatTable, nil
	case "json":
		return FormatJSON, nil
	case "yaml":
		return FormatYAML, nil
	case "plain":
		return FormatPlain, nil
	default:
		return 0, fmt.Errorf("unsupported output format %q (supported: auto, table, json, yaml)", s)
	}
}

// Resolve converts FormatAuto into a concrete format based on whether w is a
// terminal.  All other formats are returned unchanged.
func Resolve(f Format, w io.Writer) Format {
	if f != FormatAuto {
		return f
	}
	if file, ok := w.(*os.File); ok && term.IsTerminal(int(file.Fd())) {
		return FormatTable
	}
	return FormatPlain
}

// Render writes v to w in the given format.
//
// For FormatJSON, v is marshalled with json.MarshalIndent.
// For FormatYAML, v is marshalled to real YAML via sigs.k8s.io/yaml.
// For FormatTable and FormatPlain, the caller must supply a TableRenderer via
// the opts.  If none is provided, Render falls back to JSON.
func Render(w io.Writer, f Format, v any, opts ...RenderOption) error {
	cfg := renderConfig{}
	for _, o := range opts {
		o(&cfg)
	}

	resolved := Resolve(f, w)
	switch resolved {
	case FormatYAML:
		return renderYAML(w, v)
	case FormatJSON:
		return renderJSON(w, v)
	case FormatTable, FormatPlain:
		if cfg.tableFunc != nil {
			return cfg.tableFunc(w, v)
		}
		// Fallback: JSON if no table renderer provided.
		return renderJSON(w, v)
	default:
		return renderJSON(w, v)
	}
}

func renderJSON(w io.Writer, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(b))
	return err
}

func renderYAML(w io.Writer, v any) error {
	b, err := sigYAML.Marshal(v)
	if err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

// renderConfig holds optional configuration for Render.
type renderConfig struct {
	tableFunc func(io.Writer, any) error
}

// RenderOption configures Render behaviour.
type RenderOption func(*renderConfig)

// WithTable supplies a function that renders v as a human-readable table.
// The function receives the same value passed to Render.
func WithTable(fn func(io.Writer, any) error) RenderOption {
	return func(c *renderConfig) {
		c.tableFunc = fn
	}
}
