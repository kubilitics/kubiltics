package cli

// ---------------------------------------------------------------------------
// P3-2: First-class wait command with progress display
//
// Wraps 'kubectl wait' with:
//   - Live elapsed-time counter on stderr while waiting (TTY only)
//   - --watch-events flag: stream events for the target namespace to stderr
//   - Clear, actionable timeout error message
//   - Non-TTY fallback: plain kubectl wait (clean for CI/CD pipelines)
//
// Exit-code semantics mirror kubectl wait:
//   0  — condition met
//   1  — timeout or condition never met
//   2+ — kubectl itself errored
// ---------------------------------------------------------------------------

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kubilitics/kcli/internal/runner"
	"github.com/spf13/cobra"
)

// newWaitCmd returns an enhanced 'wait' command that shows a live progress
// timer while waiting for a Kubernetes condition to be met.
//
// On non-TTY outputs (CI/CD pipes, script redirection) it falls back to plain
// kubectl wait with no decorations so scripts receive clean, parseable output.
func newWaitCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "wait [resource] --for=<condition> [flags]",
		Short: "Wait for a condition with live progress display",
		Long: `Wait for a specific condition on one or more Kubernetes resources.

Wraps 'kubectl wait' and adds a live progress timer showing elapsed time
while the condition is pending.  On non-TTY outputs (pipes, CI) the command
falls back to plain kubectl wait for script-friendly output.

Additional flags (stripped before forwarding to kubectl):

  --watch-events   Stream events for the target namespace to stderr

All standard kubectl wait flags are forwarded unchanged:
  --for=condition=<condition>  Condition to wait for
  --timeout=<duration>         Maximum wait time (default 30s)
  -f, --filename               Files that identify the resource
  -l, --selector               Label selector
  -A, --all-namespaces         Wait across all namespaces

Examples:

  kcli wait deployment/api --for=condition=Available --timeout=5m
  kcli wait pod -l app=nginx --for=condition=Ready --timeout=2m
  kcli wait deployment/api --for=condition=Available --watch-events`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			// Strip kcli global flags (--context, --namespace, --kubeconfig, --yes).
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Strip our own wait-specific flags; forward the rest to kubectl.
			watchEvents, kArgs := parseWaitFlags(clean)

			// Non-TTY: just run kubectl wait normally for clean pipe output.
			if !isColorOutput(a.stderr) {
				return a.runKubectl(append([]string{"wait"}, kArgs...))
			}

			return a.runWaitWithProgress(cmd, kArgs, watchEvents)
		},
	}
}

// ---------------------------------------------------------------------------
// parseWaitFlags strips --watch-events from args, forwarding the rest.
// ---------------------------------------------------------------------------

func parseWaitFlags(args []string) (watchEvents bool, rest []string) {
	rest = make([]string, 0, len(args))
	for _, a := range args {
		if strings.TrimSpace(a) == "--watch-events" {
			watchEvents = true
		} else {
			rest = append(rest, a)
		}
	}
	return
}

// ---------------------------------------------------------------------------
// runWaitWithProgress runs kubectl wait in the background while printing a
// live elapsed-time progress line to stderr.
// ---------------------------------------------------------------------------

func (a *app) runWaitWithProgress(cmd *cobra.Command, kArgs []string, watchEvents bool) error {
	resource, condition, timeoutStr := extractWaitDisplay(kArgs)

	// Build the kubectl wait command (subprocess, not yet started).
	var outBuf bytes.Buffer
	kubectlArgs := a.scopeArgsFor(append([]string{"wait"}, kArgs...))
	kCmd, err := runner.NewKubectlCmd(kubectlArgs, runner.ExecOptions{
		Stdin:  a.stdin,
		Stdout: &outBuf,
		Stderr: a.stderr,
	})
	if err != nil {
		return err
	}

	if err := kCmd.Start(); err != nil {
		return fmt.Errorf("starting kubectl wait: %w", err)
	}

	// Collect the wait result in a goroutine so we can run the progress loop.
	waitDone := make(chan error, 1)
	go func() { waitDone <- kCmd.Wait() }()

	// Optional: stream events for the target namespace to stderr while waiting.
	var cancelEvents context.CancelFunc
	if watchEvents {
		cancelEvents = a.startEventStream(a.namespace)
	}

	// ── Progress loop ────────────────────────────────────────────────────────
	start := time.Now()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	displayLine := buildWaitDisplay(resource, condition, timeoutStr)
	progressLen := 0 // width of last printed progress line for erasure

	clearProgress := func() {
		if progressLen > 0 {
			fmt.Fprintf(a.stderr, "\r%s\r", strings.Repeat(" ", progressLen))
			progressLen = 0
		}
	}

	for {
		select {
		case waitErr := <-waitDone:
			clearProgress()
			if cancelEvents != nil {
				cancelEvents()
			}
			// Forward any kubectl stdout output (e.g. "deployment.apps/api condition met").
			if s := outBuf.String(); s != "" {
				fmt.Fprint(cmd.OutOrStdout(), s)
			}
			if waitErr != nil {
				code := exitCodeOf(waitErr)
				if code >= 2 {
					// Real kubectl error (not a timeout).
					return waitErr
				}
				// Exit code 1 = timeout or condition never met.
				elapsed := time.Since(start).Round(time.Second)
				return fmt.Errorf(
					"timeout waiting for %s after %s\n  condition: %s\n  hint: check 'kcli describe %s' for current state",
					resource, elapsed, condition, resource,
				)
			}
			// Success.
			elapsed := time.Since(start).Round(time.Second)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s condition met after %s\n", resource, elapsed)
			return nil

		case <-ticker.C:
			clearProgress()
			elapsed := time.Since(start).Round(time.Second)
			line := fmt.Sprintf("[%s] %s", formatElapsed(elapsed), displayLine)
			progressLen = len(line)
			fmt.Fprint(a.stderr, line)
		}
	}
}

// ---------------------------------------------------------------------------
// startEventStream launches a background goroutine that runs
// 'kubectl get events --watch' for the given namespace, forwarding output
// to app stderr.  Returns a cancel function to stop the stream.
// ---------------------------------------------------------------------------

func (a *app) startEventStream(namespace string) context.CancelFunc {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		eventsArgs := []string{"get", "events", "--watch"}
		scoped := a.scopeArgsFor(eventsArgs)
		// Suppress the error — the goroutine is cancelled when wait completes.
		_ = runner.RunKubectlContext(ctx, scoped, runner.ExecOptions{
			Stdin:  a.stdin,
			Stdout: a.stderr, // events go to stderr to separate from wait result
			Stderr: a.stderr,
		})
	}()
	return cancel
}

// ---------------------------------------------------------------------------
// extractWaitDisplay extracts display-friendly values from kubectl wait args.
// ---------------------------------------------------------------------------

// extractWaitDisplay returns the resource target, condition expression, and
// timeout string from a set of kubectl wait arguments.  All values are
// best-effort: if not found they fall back to generic placeholder strings.
func extractWaitDisplay(args []string) (resource, condition, timeout string) {
	resource = "resource"
	condition = "unknown"
	timeout = ""

	for i := 0; i < len(args); i++ {
		tok := strings.TrimSpace(args[i])

		// --for=condition=Available or --for=delete or --for=jsonpath='{...}'
		if strings.HasPrefix(tok, "--for=") {
			condition = strings.TrimPrefix(tok, "--for=")
			continue
		}
		if tok == "--for" && i+1 < len(args) {
			i++
			condition = strings.TrimSpace(args[i])
			continue
		}

		// --timeout=5m
		if strings.HasPrefix(tok, "--timeout=") {
			timeout = strings.TrimPrefix(tok, "--timeout=")
			continue
		}
		if tok == "--timeout" && i+1 < len(args) {
			i++
			timeout = strings.TrimSpace(args[i])
			continue
		}

		// Skip flags and their values.
		if strings.HasPrefix(tok, "-") {
			// Consume next token if this flag takes a value (single-dash + letter).
			if len(tok) == 2 {
				switch tok {
				case "-f", "-l", "-n":
					i++ // skip the flag value
				}
			}
			continue
		}

		// First positional argument is the resource target.
		if resource == "resource" {
			resource = tok
		}
	}
	return
}

// buildWaitDisplay returns the progress line body (without the elapsed prefix).
func buildWaitDisplay(resource, condition, timeout string) string {
	msg := fmt.Sprintf("Waiting for %s: %s...", resource, condition)
	if timeout != "" {
		msg += fmt.Sprintf(" (timeout: %s)", timeout)
	}
	return msg
}

// formatElapsed formats a duration as MM:SS or HH:MM:SS.
func formatElapsed(d time.Duration) string {
	d = d.Round(time.Second)
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	if h > 0 {
		return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%02d:%02d", m, s)
}
