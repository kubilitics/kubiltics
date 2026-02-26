package ui

// ---------------------------------------------------------------------------
// P4-1: In-TUI exec with real PTY
//
// Implements `s` key (shell) for the pod list view.  Uses tea.ExecProcess
// which correctly pauses the Bubble Tea renderer, hands the terminal over to
// the interactive process, and resumes the TUI when the process exits.
//
// Architecture:
//   1. User presses `s` on a pod in list mode.
//   2. execShellCmd() is returned as a tea.Cmd.
//   3. Bubble Tea calls ExecProcess, releasing the terminal.
//   4. shellExecCommand.Run():
//        a. Fetches the pod's container list via kubectl get -o jsonpath.
//        b. If >1 container, shows a numbered picker on stdout, reads stdin.
//        c. Runs `kubectl exec -it POD [-c CONTAINER] [-n NS] -- /bin/sh`.
//   5. When exec exits (user types "exit" or Ctrl-D), Bubble Tea resumes.
//   6. execDoneMsg is sent; Update() refreshes the pod list.
// ---------------------------------------------------------------------------

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// execDoneMsg is returned after a kubectl exec session ends.
// err is nil on clean exit; non-nil if exec itself failed to start.
type execDoneMsg struct{ err error }

// execShellCmd returns a tea.Cmd that suspends the TUI, runs an interactive
// shell inside the given pod, and resumes the TUI when the shell exits.
//
// Container selection:
//   - Single container → exec directly, no prompt.
//   - Multiple containers → numbered picker printed to the terminal.
func execShellCmd(opts Options, row resourceRow) tea.Cmd {
	c := &shellExecCommand{opts: opts, row: row}
	// tea.Exec is the generic form that accepts any ExecCommand interface.
	// tea.ExecProcess only accepts *exec.Cmd; shellExecCommand is richer.
	return tea.Exec(c, func(err error) tea.Msg {
		return execDoneMsg{err: err}
	})
}

// ---------------------------------------------------------------------------
// shellExecCommand implements tea.ExecCommand.
// ---------------------------------------------------------------------------

// shellExecCommand implements the tea.ExecCommand interface so that
// tea.ExecProcess can pause the Bubble Tea renderer while the shell runs.
type shellExecCommand struct {
	opts   Options
	row    resourceRow
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
}

func (c *shellExecCommand) SetStdin(r io.Reader)  { c.stdin = r }
func (c *shellExecCommand) SetStdout(w io.Writer) { c.stdout = w }
func (c *shellExecCommand) SetStderr(w io.Writer) { c.stderr = w }

// Run is called by Bubble Tea after it has released the terminal.
// It blocks until the shell exits.
func (c *shellExecCommand) Run() error {
	// 1. Discover containers in the pod.
	containers, err := getContainerNames(c.opts, c.row)
	if err != nil {
		// Print the error to the terminal so the user can see it before the
		// TUI resumes (which would clear the screen).
		fmt.Fprintf(c.stderr, "\nexec: could not get containers for pod/%s: %v\n", c.row.Name, err)
		return err
	}

	// 2. Pick the container to exec into.
	container := ""
	switch len(containers) {
	case 0:
		// Defensive: pod has no containers listed (shouldn't happen in practice).
		fmt.Fprintf(c.stderr, "\nexec: pod/%s has no containers\n", c.row.Name)
		return fmt.Errorf("pod/%s has no containers", c.row.Name)
	case 1:
		container = containers[0]
	default:
		// Multiple containers: show a numbered picker.
		container, err = pickContainerFromReader(c.stdin, c.stdout, containers, c.row.Name)
		if err != nil {
			return err
		}
	}

	// 3. Build and run `kubectl exec -it`.
	args := buildShellExecArgs(c.opts, c.row, container)
	cmd := exec.Command(kubectlBinary(), args...)
	cmd.Stdin = c.stdin
	cmd.Stdout = c.stdout
	cmd.Stderr = c.stderr
	return cmd.Run()
}

// ---------------------------------------------------------------------------
// getContainerNames returns the container names for the given pod.
// ---------------------------------------------------------------------------

// getContainerNames queries the pod's container names using kubectl get.
// It returns the list of container names, or an error.
func getContainerNames(opts Options, row resourceRow) ([]string, error) {
	getArgs := []string{
		"get", "pod", row.Name,
		"-o", "jsonpath={.spec.containers[*].name}",
	}
	if row.Namespace != "" && row.Namespace != "-" {
		getArgs = append(getArgs, "-n", row.Namespace)
	}
	out, err := runKubectl(opts, getArgs)
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(out)
	if raw == "" {
		return nil, nil
	}
	return strings.Fields(raw), nil
}

// ---------------------------------------------------------------------------
// pickContainerFromReader shows a numbered menu and reads a selection.
// ---------------------------------------------------------------------------

// pickContainerFromReader prints a numbered container menu to w and reads a
// selection from r.  Returns the selected container name.
//
// Input handling:
//   - Empty / EOF → first container (safe default)
//   - "1"-"N"     → selects that container by number
//   - Other text  → treated as a container name (passthrough for advanced use)
func pickContainerFromReader(r io.Reader, w io.Writer, containers []string, podName string) (string, error) {
	fmt.Fprintf(w, "\nPod %q has %d containers. Select one:\n\n", podName, len(containers))
	for i, name := range containers {
		fmt.Fprintf(w, "  [%d] %s\n", i+1, name)
	}
	fmt.Fprintf(w, "\nContainer [1]: ")

	scanner := bufio.NewScanner(r)
	if !scanner.Scan() {
		// EOF → default to first.
		return containers[0], nil
	}
	input := strings.TrimSpace(scanner.Text())
	if input == "" {
		return containers[0], nil
	}

	// Numeric selection.
	if n, err := strconv.Atoi(input); err == nil {
		if n >= 1 && n <= len(containers) {
			return containers[n-1], nil
		}
		fmt.Fprintf(os.Stderr, "exec: invalid selection %d (valid: 1–%d), using %q\n",
			n, len(containers), containers[0])
		return containers[0], nil
	}

	// Raw container name passthrough (advanced users who know the exact name).
	return input, nil
}

// ---------------------------------------------------------------------------
// buildShellExecArgs constructs kubectl exec arguments.
// ---------------------------------------------------------------------------

// buildShellExecArgs returns the kubectl arguments for an interactive shell
// exec into the given pod/container.
func buildShellExecArgs(opts Options, row resourceRow, container string) []string {
	args := make([]string, 0, 12)

	// kubectl global flags.
	if opts.Kubeconfig != "" {
		args = append(args, "--kubeconfig", opts.Kubeconfig)
	}
	if opts.Context != "" {
		args = append(args, "--context", opts.Context)
	}

	// kubectl exec flags.
	args = append(args, "exec", "-it", row.Name)
	if row.Namespace != "" && row.Namespace != "-" {
		args = append(args, "-n", row.Namespace)
	}
	if container != "" {
		args = append(args, "-c", container)
	}

	// Prefer /bin/bash; fall back to /bin/sh.
	// We default to /bin/sh here for maximum compatibility.  Power users
	// who want bash can run `kcli exec pod-name -- /bin/bash` directly.
	args = append(args, "--", "/bin/sh")

	return args
}
