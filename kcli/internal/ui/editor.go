package ui

// ---------------------------------------------------------------------------
// P4-3: In-TUI Resource Editing with Apply-on-Save
//
// Enhanced `e` key in list mode — opens the selected resource's YAML in
// $EDITOR and, if the user modifies it, applies the changes to the cluster.
//
// Flow:
//   1. kubectl get RESOURCE -o yaml → temp file
//   2. User edits temp file in $EDITOR (tea.ExecProcess suspends TUI)
//   3. Compare edited file to original (byte-for-byte)
//      - No change → show "No changes" in detail pane, resume TUI
//      - Changed   → kubectl apply -f tempfile (blocking), show result
//   4. Refresh resource list
//
// The `editResourceCmd` already in tui.go handles `kubectl edit` (in-place
// server-side edit) and remains for the YAML tab `e` binding in detail mode.
// This new command provides a client-side $EDITOR workflow with apply-on-save.
// ---------------------------------------------------------------------------

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// editorDoneMsg is returned after the $EDITOR session ends.
type editorDoneMsg struct {
	resource string // e.g. "deployment/api"
	applied  bool   // true if kubectl apply was run
	changed  bool   // true if the file was modified
	result   string // kubectl apply output (if applied) or "" if no change
	err      error  // non-nil if apply failed
}

// editInEditorCmd suspends the TUI, opens the resource YAML in $EDITOR,
// then optionally applies the changes using kubectl apply.
func editInEditorCmd(opts Options, spec resourceSpec, row resourceRow) tea.Cmd {
	c := &editorExecCommand{opts: opts, spec: spec, row: row}
	return tea.Exec(c, func(err error) tea.Msg {
		if err != nil {
			return editorDoneMsg{err: err}
		}
		return c.result
	})
}

// ---------------------------------------------------------------------------
// editorExecCommand implements tea.ExecCommand.
// ---------------------------------------------------------------------------

type editorExecCommand struct {
	opts   Options
	spec   resourceSpec
	row    resourceRow
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
	result editorDoneMsg // populated during Run()
}

func (c *editorExecCommand) SetStdin(r io.Reader)  { c.stdin = r }
func (c *editorExecCommand) SetStdout(w io.Writer) { c.stdout = w }
func (c *editorExecCommand) SetStderr(w io.Writer) { c.stderr = w }

// Run is called by Bubble Tea after it releases the terminal.
func (c *editorExecCommand) Run() error {
	resourceRef := c.spec.KubectlType + "/" + c.row.Name
	c.result.resource = resourceRef

	// 1. Fetch current YAML from cluster.
	getArgs := buildScopedArgs(c.opts, []string{"get", c.spec.KubectlType, c.row.Name, "-o", "yaml"})
	if c.row.Namespace != "" && c.row.Namespace != "-" && c.spec.Namespaced {
		getArgs = insertNamespace(getArgs, c.row.Namespace)
	}
	original, err := captureCommand(kubectlBinary(), getArgs)
	if err != nil {
		fmt.Fprintf(c.stderr, "\nedit: could not fetch %s: %v\n", resourceRef, err)
		return err
	}

	// 2. Write to temp file.
	tmp, err := os.CreateTemp("", "kcli-edit-*.yaml")
	if err != nil {
		return fmt.Errorf("edit: create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.WriteString(original); err != nil {
		tmp.Close()
		return fmt.Errorf("edit: write temp file: %w", err)
	}
	tmp.Close()

	// 3. Open $EDITOR.
	editor := resolveEditor()
	editorCmd := exec.Command(editor, tmpPath)
	editorCmd.Stdin = c.stdin
	editorCmd.Stdout = c.stdout
	editorCmd.Stderr = c.stderr
	if err := editorCmd.Run(); err != nil {
		// Editor exited non-zero — treat as no-change (user may have aborted).
		c.result.changed = false
		return nil
	}

	// 4. Read edited file and compare.
	edited, err := os.ReadFile(tmpPath)
	if err != nil {
		return fmt.Errorf("edit: read temp file: %w", err)
	}

	if bytes.Equal([]byte(original), edited) {
		// No changes made.
		c.result.changed = false
		c.result.result = "No changes detected — resource not modified."
		return nil
	}
	c.result.changed = true

	// 5. Apply changes with kubectl apply.
	applyArgs := buildScopedArgs(c.opts, []string{"apply", "-f", tmpPath})
	out, applyErr := captureCommand(kubectlBinary(), applyArgs)
	c.result.result = strings.TrimSpace(out)
	if applyErr != nil {
		c.result.err = fmt.Errorf("apply failed: %w\n%s", applyErr, out)
		fmt.Fprintf(c.stderr, "\n✗ Apply failed for %s: %v\n%s\n", resourceRef, applyErr, out)
		return nil // Don't return error so the TUI resumes
	}

	c.result.applied = true
	fmt.Fprintf(c.stdout, "\n✓ Applied changes to %s\n%s\n", resourceRef, c.result.result)
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveEditor returns the editor to use, respecting $VISUAL > $EDITOR > vi.
func resolveEditor() string {
	if e := strings.TrimSpace(os.Getenv("VISUAL")); e != "" {
		return e
	}
	if e := strings.TrimSpace(os.Getenv("EDITOR")); e != "" {
		return e
	}
	return "vi"
}

// buildScopedArgs prepends kubeconfig/context flags to args (no namespace).
func buildScopedArgs(opts Options, args []string) []string {
	out := make([]string, 0, len(args)+4)
	if opts.Kubeconfig != "" {
		out = append(out, "--kubeconfig", opts.Kubeconfig)
	}
	if opts.Context != "" {
		out = append(out, "--context", opts.Context)
	}
	out = append(out, args...)
	return out
}

// insertNamespace inserts "-n NAMESPACE" after the kubectl verb (index 0 is
// the verb after global flags prepended by buildScopedArgs).
// We just append to the end — kubectl accepts -n anywhere in the args.
func insertNamespace(args []string, ns string) []string {
	return append(args, "-n", ns)
}

// captureCommand runs cmd with args and returns combined stdout+stderr output.
func captureCommand(cmd string, args []string) (string, error) {
	c := exec.Command(cmd, args...)
	out, err := c.CombinedOutput()
	return string(out), err
}
