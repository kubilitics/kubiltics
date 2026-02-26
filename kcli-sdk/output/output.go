// Package output provides output formatting helpers for kcli plugins.
//
// Plugins should use these helpers rather than calling fmt.Printf directly
// so that output is consistent with the rest of the kcli ecosystem and can
// be switched between human-readable and machine-readable (JSON) formats.
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
)

// Printer writes formatted output to a target writer.
// Construct one via NewPrinter.
type Printer struct {
	w      io.Writer
	jsonFmt bool
}

// NewPrinter creates a Printer that writes to w.
// When jsonFmt is true, Table/Row calls emit JSON instead of text.
func NewPrinter(w io.Writer, jsonFmt bool) *Printer {
	return &Printer{w: w, jsonFmt: jsonFmt}
}

// Println writes a line terminated with \n.
func (p *Printer) Println(args ...interface{}) {
	fmt.Fprintln(p.w, args...)
}

// Printf writes a formatted string.
func (p *Printer) Printf(format string, args ...interface{}) {
	fmt.Fprintf(p.w, format, args...)
}

// Error writes an error message prefixed with "error: ".
func (p *Printer) Error(err error) {
	fmt.Fprintf(p.w, "error: %v\n", err)
}

// Table renders tabular data.
// headers is the column header slice; rows is a slice of string slices.
// In JSON mode, each row is emitted as a JSON object keyed by header name.
func (p *Printer) Table(headers []string, rows [][]string) {
	if p.jsonFmt {
		records := make([]map[string]string, 0, len(rows))
		for _, row := range rows {
			rec := make(map[string]string, len(headers))
			for i, h := range headers {
				if i < len(row) {
					rec[h] = row[i]
				}
			}
			records = append(records, rec)
		}
		b, _ := json.MarshalIndent(records, "", "  ")
		fmt.Fprintln(p.w, string(b))
		return
	}
	tw := tabwriter.NewWriter(p.w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, strings.Join(headers, "\t"))
	for _, row := range rows {
		fmt.Fprintln(tw, strings.Join(row, "\t"))
	}
	_ = tw.Flush()
}

// JSON marshals v and writes it as indented JSON.
func (p *Printer) JSON(v interface{}) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Fprintln(p.w, string(b))
	return nil
}

// Header writes a section header in bold-like formatting (uppercase, underlined).
func (p *Printer) Header(title string) {
	if p.jsonFmt {
		return // skip decorative headers in JSON mode
	}
	fmt.Fprintln(p.w, strings.ToUpper(title))
	fmt.Fprintln(p.w, strings.Repeat("─", len(title)))
}

// Success writes a success message prefixed with ✓.
func (p *Printer) Success(msg string, args ...interface{}) {
	fmt.Fprintf(p.w, "✓ "+msg+"\n", args...)
}

// Warning writes a warning message prefixed with ⚠.
func (p *Printer) Warning(msg string, args ...interface{}) {
	fmt.Fprintf(p.w, "⚠ "+msg+"\n", args...)
}
