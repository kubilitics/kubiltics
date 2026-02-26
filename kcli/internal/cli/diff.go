package cli

// ---------------------------------------------------------------------------
// P3-1: First-class diff command
//
// Replaces the generic kubectl passthrough for 'diff' with a command that adds:
//
//   - Colored unified diff output (green=added, red=removed, cyan=hunk headers)
//   - --summary: compact "N resource(s) will change: Kind/name, ..." line
//   - --ai:      ask the configured AI provider to explain the changes
//   - --no-color: force plain output even on color terminals
//
// All kubectl diff flags (-f, -k, -R, --field-manager, --server-side, etc.)
// pass through unchanged.  Exit-code semantics mirror kubectl diff:
//
//   0 — no differences found
//   1 — differences found (not an error from kcli's perspective)
//   2+ — kubectl itself errored (propagated to caller)
// ---------------------------------------------------------------------------

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/kubilitics/kcli/internal/runner"
	"github.com/spf13/cobra"
)

// newDiffCmd returns a first-class 'diff' command that enhances the output of
// 'kubectl diff' with ANSI colors, a summary mode, and optional AI analysis.
func newDiffCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "diff [args...]",
		Short: "Diff live cluster state against local manifests (with color and summary)",
		Long: `Show differences between the live cluster state and the local manifests.

Wraps 'kubectl diff' and enhances the output with ANSI colors, a compact
summary, and optional AI analysis.  All kubectl diff flags are forwarded
unchanged (-f, -k, -R, --field-manager, --server-side, etc.).

Cross-cluster diff (P3-4): use --against to compare two clusters:
  kcli diff --context=prod --against=staging deployment/payment-api
  kcli diff --context=prod --against=staging -n payments
  kcli diff --context=prod --against=staging   # core resources cluster-wide

Flags (stripped before passing to kubectl):

  --summary   Print a compact summary: "N resource(s) will change: Kind/name"
  --ai        Send the diff to the AI provider for an operational explanation
  --no-color  Suppress ANSI colors even on color terminals
  --against   Compare against another cluster context (cross-cluster diff)

Environment:

  NO_COLOR=1  Standard convention — forces plain output (same as --no-color)

Exit codes (match kubectl diff):

  0   No differences found
  1   Differences found
  2+  Error from kubectl`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			// Strip kcli global flags (--context, --namespace, --kubeconfig, --yes).
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Strip our own diff-specific flags; forward the rest to kubectl.
			summary, aiFlag, noColor, against, kArgs := parseDiffFlags(clean)

			// ── Cross-cluster diff (P3-4) ─────────────────────────────────────
			if against != "" {
				return runCrossClusterDiff(a, cmd, against, summary, aiFlag, noColor, kArgs)
			}

			// ── Run kubectl diff ────────────────────────────────────────────
			// Stdout is captured for processing; stderr is forwarded directly
			// so that kubectl error messages reach the user immediately.
			var outBuf bytes.Buffer
			diffErr := runner.RunKubectl(
				a.scopeArgsFor(append([]string{"diff"}, kArgs...)),
				runner.ExecOptions{
					Force:  false,
					Stdin:  a.stdin,
					Stdout: &outBuf,
					Stderr: a.stderr,
				},
			)

			// Exit code 1 = differences found — that is normal, not an error.
			// Exit code 2+ = kubectl itself failed — propagate.
			if diffErr != nil {
				if exitCode := exitCodeOf(diffErr); exitCode >= 2 {
					return diffErr
				}
				// exitCode == 1: differences found; continue processing.
			}

			out := cmd.OutOrStdout()
			diffText := outBuf.String()

			if strings.TrimSpace(diffText) == "" {
				fmt.Fprintln(out, "No differences found.")
				return nil
			}

			// ── Summary mode ────────────────────────────────────────────────
			if summary {
				return printDiffSummary(out, diffText)
			}

			// ── AI mode ─────────────────────────────────────────────────────
			if aiFlag {
				return runDiffAI(a, cmd, diffText)
			}

			// ── Colorized output ─────────────────────────────────────────────
			useColor := !noColor && isColorOutput(out) && os.Getenv("NO_COLOR") == ""
			if useColor {
				fmt.Fprint(out, colorizeDiff(diffText))
			} else {
				fmt.Fprint(out, diffText)
			}
			return nil
		},
	}
}

// ---------------------------------------------------------------------------
// parseDiffFlags scans args and strips --summary, --ai, --no-color, --against flags.
// All other args are returned in rest for forwarding to kubectl diff.
// ---------------------------------------------------------------------------

func parseDiffFlags(args []string) (summary, ai, noColor bool, against string, rest []string) {
	rest = make([]string, 0, len(args))
	skipNext := false
	for i, a := range args {
		if skipNext {
			skipNext = false
			continue
		}
		t := strings.TrimSpace(a)
		switch {
		case t == "--summary":
			summary = true
		case t == "--ai":
			ai = true
		case t == "--no-color", t == "--no-colour":
			noColor = true
		case t == "--against":
			if i+1 < len(args) {
				against = strings.TrimSpace(args[i+1])
				skipNext = true
			}
		case strings.HasPrefix(t, "--against="):
			against = strings.TrimSpace(strings.TrimPrefix(t, "--against="))
		default:
			rest = append(rest, a)
		}
	}
	return
}

// ---------------------------------------------------------------------------
// colorizeDiff adds ANSI color codes to unified diff text for terminal output.
//
// Color scheme:
//   bold+yellow  diff header lines (diff -u / diff --git)
//   bold         file header lines (--- / +++)
//   red          removed lines     (-)
//   green        added lines       (+)
//   cyan         hunk headers      (@@ ... @@)
//   normal       context lines
// ---------------------------------------------------------------------------

// Note: ansiReset, ansiRed, ansiGreen, ansiYellow, ansiCyan, ansiBold are
// declared in cost.go in the same package.

func colorizeDiff(diff string) string {
	var sb strings.Builder
	sb.Grow(len(diff) + len(diff)/2) // pre-allocate for ANSI bytes

	// strings.Split on a trailing newline produces an empty final element —
	// we trim then re-add a trailing newline for consistent output.
	lines := strings.Split(strings.TrimRight(diff, "\n"), "\n")
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "diff "):
			sb.WriteString(ansiBold + ansiYellow + line + ansiReset + "\n")
		case strings.HasPrefix(line, "--- "), strings.HasPrefix(line, "+++ "):
			sb.WriteString(ansiBold + line + ansiReset + "\n")
		case strings.HasPrefix(line, "-"):
			sb.WriteString(ansiRed + line + ansiReset + "\n")
		case strings.HasPrefix(line, "+"):
			sb.WriteString(ansiGreen + line + ansiReset + "\n")
		case strings.HasPrefix(line, "@@"):
			sb.WriteString(ansiCyan + line + ansiReset + "\n")
		default:
			sb.WriteString(line + "\n")
		}
	}
	return sb.String()
}

// ---------------------------------------------------------------------------
// parseDiffResources scans the diff output for resource identifiers.
//
// kubectl diff writes temp files using the naming convention:
//   <group>.<version>.<Kind>.<namespace>.<name>
// e.g. apps.v1.Deployment.default.myapp
//      .v1.Pod.kube-system.coredns-5dd5756b68-xyz  (core group = empty)
//
// For each "diff -u" header the function extracts the LIVE file's basename
// and derives a friendly "<Kind>/<name>" label.
// ---------------------------------------------------------------------------

func parseDiffResources(diff string) []string {
	seen := make(map[string]struct{})
	var resources []string

	for _, line := range strings.Split(diff, "\n") {
		if !strings.HasPrefix(line, "diff ") {
			continue
		}
		// Typical kubectl diff -u line:
		//   diff -u -N /tmp/kubectl-diff-NNN/LIVE-NNN/resource /tmp/kubectl-diff-NNN/MERGED-NNN/resource
		// Find the LIVE path component.
		fields := strings.Fields(line)
		livePath := ""
		for _, f := range fields {
			if strings.Contains(f, "LIVE-") {
				livePath = f
				break
			}
		}
		if livePath == "" && len(fields) >= 3 {
			// Fall back to the second-to-last field (first file path in diff -u).
			livePath = fields[len(fields)-2]
		}
		if livePath == "" {
			continue
		}
		base := filepath.Base(livePath)
		if _, dup := seen[base]; dup {
			continue
		}
		seen[base] = struct{}{}
		resources = append(resources, diffResourceLabel(base))
	}
	return resources
}

// diffResourceLabel converts a kubectl diff temp-file basename to a human-
// friendly "<Kind>/<name>" label.
//
// Expected formats:
//   apps.v1.Deployment.default.myapp     → Deployment/myapp
//   .v1.Pod.kube-system.coredns-xyz      → Pod/coredns-xyz
//   rbac.authorization.k8s.io.v1.ClusterRole.cluster-admin → ClusterRole/cluster-admin
//
// Falls back to the raw basename if parsing fails.
func diffResourceLabel(basename string) string {
	// Strip a leading "." (core API group).
	clean := strings.TrimPrefix(basename, ".")
	parts := strings.Split(clean, ".")
	// We need at least <version>.<Kind>.<namespace>.<name> = 4 parts.
	if len(parts) >= 4 {
		// Kind is the first title-cased segment (heuristic).
		kindIdx := -1
		for i, p := range parts {
			if len(p) > 0 && p[0] >= 'A' && p[0] <= 'Z' {
				kindIdx = i
				break
			}
		}
		if kindIdx >= 0 && kindIdx < len(parts)-1 {
			return parts[kindIdx] + "/" + parts[len(parts)-1]
		}
	}
	return basename
}

// ---------------------------------------------------------------------------
// printDiffSummary prints a compact summary line.
// ---------------------------------------------------------------------------

func printDiffSummary(w io.Writer, diff string) error {
	resources := parseDiffResources(diff)
	if len(resources) == 0 {
		// Diff has content but we couldn't extract resource names.
		// Count hunk headers as a proxy for change count.
		hunks := 0
		for _, line := range strings.Split(diff, "\n") {
			if strings.HasPrefix(line, "@@") {
				hunks++
			}
		}
		fmt.Fprintf(w, "%d hunk(s) will change (resource names could not be parsed)\n", hunks)
		return nil
	}
	noun := "resource"
	if len(resources) != 1 {
		noun = "resources"
	}
	fmt.Fprintf(w, "%d %s will change: %s\n", len(resources), noun, strings.Join(resources, ", "))
	return nil
}

// ---------------------------------------------------------------------------
// runDiffAI sends the diff text to the AI provider for an explanation.
// ---------------------------------------------------------------------------

func runDiffAI(a *app, cmd *cobra.Command, diffText string) error {
	client := a.aiClient()
	if !client.Enabled() {
		fmt.Fprintln(cmd.OutOrStdout(), "AI is disabled. Set KCLI_AI_PROVIDER (or a provider-specific env var) to enable.")
		// Still print the raw diff so the user isn't left empty-handed.
		fmt.Fprint(cmd.OutOrStdout(), diffText)
		return nil
	}

	ctx, cancel := context.WithTimeout(cmd.Context(), a.aiTimeout)
	defer cancel()

	res, err := withSpinner(cmd, "AI", func() (string, error) {
		return client.Analyze(ctx, "diff", diffText)
	})
	if err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), res)
	return nil
}

// ---------------------------------------------------------------------------
// runCrossClusterDiff compares resources across two cluster contexts (P3-4).
// Left cluster: a.context (or current). Right cluster: against.
// ---------------------------------------------------------------------------

func runCrossClusterDiff(a *app, cmd *cobra.Command, against string, summary, aiFlag, noColor bool, kArgs []string) error {
	leftCtx := a.context
	if leftCtx == "" {
		out, err := runner.CaptureKubectl(buildContextArgs(a, []string{"config", "current-context"}))
		if err != nil {
			return fmt.Errorf("could not determine current context: %w", err)
		}
		leftCtx = strings.TrimSpace(out)
	}
	rightCtx := against

	// Parse resource target from kArgs: TYPE/NAME, or -n NAMESPACE, or full cluster
	var kind, name, namespace string
	allNamespaces := false
	for i := 0; i < len(kArgs); i++ {
		arg := kArgs[i]
		switch arg {
		case "-n", "--namespace":
			if i+1 < len(kArgs) {
				namespace = strings.TrimSpace(kArgs[i+1])
				i++
			}
		case "-A", "--all-namespaces":
			allNamespaces = true
		default:
			if !strings.HasPrefix(arg, "-") && kind == "" && strings.Contains(arg, "/") {
				parts := strings.SplitN(arg, "/", 2)
				if len(parts) == 2 {
					kind, name = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
				}
			} else if !strings.HasPrefix(arg, "-") && kind == "" && i+1 < len(kArgs) && !strings.HasPrefix(kArgs[i+1], "-") {
				kind, name = arg, kArgs[i+1]
				i++
			}
		}
	}
	if namespace == "" && a.namespace != "" {
		namespace = a.namespace
	}

	var diffText string
	var diffErr error

	if kind != "" && name != "" {
		// Single resource diff
		diffText, diffErr = diffSingleResource(a, leftCtx, rightCtx, kind, name, namespace)
	} else if namespace != "" || allNamespaces {
		// Namespace or cluster-wide diff
		diffText, diffErr = diffNamespaceResources(a, leftCtx, rightCtx, namespace, allNamespaces)
	} else {
		// Full cluster: diff core resources
		diffText, diffErr = diffNamespaceResources(a, leftCtx, rightCtx, "", true)
	}

	if diffErr != nil {
		return diffErr
	}

	out := cmd.OutOrStdout()
	if strings.TrimSpace(diffText) == "" {
		fmt.Fprintln(out, "No differences found between clusters.")
		return nil
	}

	if summary {
		return printDiffSummary(out, diffText)
	}
	if aiFlag {
		return runDiffAI(a, cmd, diffText)
	}
	useColor := !noColor && isColorOutput(out) && os.Getenv("NO_COLOR") == ""
	if useColor {
		fmt.Fprint(out, colorizeDiff(diffText))
	} else {
		fmt.Fprint(out, diffText)
	}
	return nil
}

func buildContextArgs(a *app, args []string) []string {
	// Build args with kubeconfig if set; context is passed explicitly by caller.
	out := make([]string, 0, len(args)+2)
	if a.kubeconfig != "" {
		out = append(out, "--kubeconfig", a.kubeconfig)
	}
	return append(out, args...)
}

func captureKubectlWithContext(a *app, ctx string, args []string) (string, error) {
	full := make([]string, 0, len(args)+4)
	if ctx != "" {
		full = append(full, "--context", ctx)
	}
	full = append(full, buildContextArgs(a, args)...)
	return runner.CaptureKubectl(full)
}

func diffSingleResource(a *app, leftCtx, rightCtx, kind, name, namespace string) (string, error) {
	getArgs := []string{"get", kind, name, "-o", "yaml"}
	if namespace != "" {
		getArgs = append(getArgs, "-n", namespace)
	}
	leftYaml, err := captureKubectlWithContext(a, leftCtx, getArgs)
	if err != nil {
		return "", fmt.Errorf("failed to get %s/%s from %s: %w", kind, name, leftCtx, err)
	}
	rightYaml, err := captureKubectlWithContext(a, rightCtx, getArgs)
	if err != nil {
		return "", fmt.Errorf("failed to get %s/%s from %s: %w", kind, name, rightCtx, err)
	}
	return unifiedDiff(leftYaml, rightYaml, leftCtx, rightCtx, kind+"/"+name)
}

func diffNamespaceResources(a *app, leftCtx, rightCtx, namespace string, allNamespaces bool) (string, error) {
	types := []string{"deployments", "services", "configmaps", "secrets"}
	if allNamespaces {
		types = []string{"namespaces", "deployments", "services"}
	}
	var sb strings.Builder
	for _, resourceType := range types {
		getArgs := []string{"get", resourceType, "-o", "yaml"}
		if allNamespaces {
			getArgs = append(getArgs, "-A")
		} else if namespace != "" {
			getArgs = append(getArgs, "-n", namespace)
		}
		leftYaml, err := captureKubectlWithContext(a, leftCtx, getArgs)
		if err != nil {
			continue // Skip resource types that don't exist or fail
		}
		rightYaml, err := captureKubectlWithContext(a, rightCtx, getArgs)
		if err != nil {
			continue
		}
		diff, err := unifiedDiff(leftYaml, rightYaml, leftCtx, rightCtx, resourceType)
		if err != nil {
			continue
		}
		if strings.TrimSpace(diff) != "" {
			sb.WriteString(diff)
			sb.WriteString("\n")
		}
	}
	return sb.String(), nil
}

func unifiedDiff(left, right string, leftLabel, rightLabel, resourceLabel string) (string, error) {
	leftFile, err := os.CreateTemp("", "kcli-diff-left-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(leftFile.Name())
	defer leftFile.Close()

	rightFile, err := os.CreateTemp("", "kcli-diff-right-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(rightFile.Name())
	defer rightFile.Close()

	if _, err := leftFile.WriteString(left); err != nil {
		return "", err
	}
	if _, err := rightFile.WriteString(right); err != nil {
		return "", err
	}
	leftFile.Close()
	rightFile.Close()

	// Use diff -u for unified diff; labels in header
	leftPath := leftLabel + ":" + resourceLabel
	rightPath := rightLabel + ":" + resourceLabel
	cmd := exec.Command("diff", "-u", leftFile.Name(), rightFile.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			// diff exits 1 when files differ — that's success for us
			diffStr := string(out)
			// Replace temp paths with readable labels
			diffStr = strings.Replace(diffStr, "--- "+leftFile.Name(), "--- "+leftPath, 1)
			diffStr = strings.Replace(diffStr, "+++ "+rightFile.Name(), "+++ "+rightPath, 1)
			return diffStr, nil
		}
		return "", fmt.Errorf("diff failed: %w", err)
	}
	return "", nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// isColorOutput returns true when w is a real terminal that supports ANSI
// colors.  Uses the same ModeCharDevice check used elsewhere in the codebase.
func isColorOutput(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

// exitCodeOf extracts the process exit code from an error returned by
// exec.Cmd.Run().  Returns 0 if err is nil or not an *exec.ExitError.
func exitCodeOf(err error) int {
	if err == nil {
		return 0
	}
	type exitErr interface{ ExitCode() int }
	if ee, ok := err.(exitErr); ok {
		return ee.ExitCode()
	}
	return 1
}
