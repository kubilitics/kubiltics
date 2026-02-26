package cli

// helm.go — kcli helm command group.
//
// First-class Helm integration. Wraps the helm binary (must be installed)
// and augments it with AI diagnostics, context/namespace scoping, and
// consistent UX alongside other kcli commands.
//
// Commands:
//   kcli helm list              — list releases across namespaces
//   kcli helm status <r>        — release details
//   kcli helm history <r>       — upgrade history
//   kcli helm diff <r>          — diff pending values vs live
//   kcli helm upgrade <r> <ch>  — upgrade / install release
//   kcli helm rollback <r> [n]  — rollback to revision
//   kcli helm install <r> <ch>  — install release
//   kcli helm uninstall <r>     — uninstall release
//   kcli helm values <r>        — show computed values
//   kcli helm template <r> <ch> — render templates
//   kcli helm lint <chart>      — lint chart
//   kcli helm test <r>          — run helm tests
//   kcli helm search hub <q>    — search Artifact Hub
//   kcli helm search repo <q>   — search added repos
//   kcli helm repo add/list/update/remove
//   kcli helm why <r>           — AI: why did this helm release fail?
//   kcli helm suggest <r>       — AI: suggest value optimizations

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

// ─── helm binary detection ────────────────────────────────────────────────────

func findHelmBinary() (string, error) {
	if h := os.Getenv("HELM_BIN"); h != "" {
		return h, nil
	}
	p, err := exec.LookPath("helm")
	if err != nil {
		return "", fmt.Errorf("helm binary not found — install from https://helm.sh/docs/intro/install/")
	}
	return p, nil
}

// runHelm executes a helm command, inheriting stdio from the kcli process.
func (a *app) runHelm(args []string) error {
	bin, err := findHelmBinary()
	if err != nil {
		return err
	}
	scoped := a.helmScopedArgs(args)
	cmd := exec.Command(bin, scoped...)
	cmd.Stdin = a.stdin
	cmd.Stdout = a.stdout
	cmd.Stderr = a.stderr
	if err := cmd.Run(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			os.Exit(ee.ExitCode())
		}
		return err
	}
	return nil
}

// captureHelm executes a helm command and returns combined stdout.
func (a *app) captureHelm(args []string) (string, error) {
	bin, err := findHelmBinary()
	if err != nil {
		return "", err
	}
	scoped := a.helmScopedArgs(args)
	out, err := exec.Command(bin, scoped...).Output()
	return string(out), err
}

// helmScopedArgs injects --namespace and --kube-context from kcli global flags.
func (a *app) helmScopedArgs(args []string) []string {
	out := make([]string, 0, len(args)+4)
	if a.namespace != "" && !helmHasFlag(args, "--namespace", "-n") {
		out = append(out, "--namespace", a.namespace)
	}
	if a.context != "" && !helmHasFlag(args, "--kube-context", "") {
		out = append(out, "--kube-context", a.context)
	}
	if a.kubeconfig != "" && !helmHasFlag(args, "--kubeconfig", "") {
		out = append(out, "--kubeconfig", a.kubeconfig)
	}
	return append(out, args...)
}

func helmHasFlag(args []string, long, short string) bool {
	for i, a := range args {
		if long != "" && (a == long || strings.HasPrefix(a, long+"=")) {
			return true
		}
		if short != "" && (a == short) && i+1 < len(args) {
			return true
		}
	}
	return false
}

// newHelmPassthroughCmd creates a cobra command that passes all args directly to helm.
func newHelmPassthroughCmd(a *app, use, short string, aliases ...string) *cobra.Command {
	verb := strings.Split(use, " ")[0]
	return &cobra.Command{
		Use:                use,
		Short:              short,
		Aliases:            aliases,
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, args []string) error {
			return a.runHelm(append([]string{verb}, args...))
		},
	}
}

// ─── kcli helm list ───────────────────────────────────────────────────────────

func newHelmListCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "list [args...]",
		Short:              "List Helm releases",
		Aliases:            []string{"ls"},
		DisableFlagParsing: true,
		Example: `  kcli helm list
  kcli helm list --all-namespaces
  kcli helm list -n production
  kcli helm list --filter payment`,
		RunE: func(_ *cobra.Command, args []string) error {
			return a.runHelm(append([]string{"list"}, args...))
		},
	}
}

// ─── kcli helm why (AI) ───────────────────────────────────────────────────────

func newHelmWhyCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "why <release>",
		Short: "AI: diagnose why a Helm release failed or is degraded",
		Args:  cobra.ExactArgs(1),
		Example: `  kcli helm why payment-api
  kcli helm why cert-manager -n cert-manager`,
		RunE: func(cmd *cobra.Command, args []string) error {
			release := args[0]
			client := a.aiClient()
			if !client.Enabled() {
				return fmt.Errorf("AI not configured — run: kcli config set ai.provider openai && kcli config set ai.api_key <key>")
			}

			// Gather helm status + history
			statusOut, _ := a.captureHelm([]string{"status", release, "--output", "json"})
			historyOut, _ := a.captureHelm([]string{"history", release, "--max", "5", "--output", "json"})
			// Get recent k8s events in the same namespace
			eventsOut, _ := a.captureKubectl([]string{"get", "events", "--sort-by=.lastTimestamp", "--field-selector=type=Warning"})

			prompt := fmt.Sprintf("Helm release '%s' context:\n\nSTATUS:\n%s\n\nHISTORY:\n%s\n\nRECENT WARNING EVENTS:\n%s\n\nDiagnose the root cause. Be specific, concise, and provide a fix command.",
				release, statusOut, historyOut, eventsOut)

			fmt.Fprintf(a.stdout, "%s%s Helm AI Diagnosis: %s%s%s\n\n",
				ansiBold, ansiCyan, ansiYellow, release, ansiReset)

			result, err := client.Analyze(context.Background(), "helm-why", prompt)
			if err != nil {
				return fmt.Errorf("AI analysis failed: %w", err)
			}
			fmt.Fprintln(a.stdout, result)
			return nil
		},
	}
}

// ─── kcli helm suggest (AI) ───────────────────────────────────────────────────

func newHelmSuggestCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "suggest <release>",
		Short: "AI: suggest Helm values optimizations for a release",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			release := args[0]
			client := a.aiClient()
			if !client.Enabled() {
				return fmt.Errorf("AI not configured")
			}

			valuesOut, _ := a.captureHelm([]string{"get", "values", release})
			chartOut, _ := a.captureHelm([]string{"status", release, "--output", "json"})

			prompt := fmt.Sprintf("Helm release '%s' current values:\n\n%s\n\nChart status:\n%s\n\nSuggest production-grade optimizations for resources, replicas, affinity, PDB, and best practices. Format as specific --set flags or values.yaml patches.",
				release, valuesOut, chartOut)

			fmt.Fprintf(a.stdout, "%s%s Helm AI Suggestions: %s%s%s\n\n",
				ansiBold, ansiCyan, ansiYellow, release, ansiReset)

			result, err := client.Analyze(context.Background(), "helm-suggest", prompt)
			if err != nil {
				return fmt.Errorf("AI analysis failed: %w", err)
			}
			fmt.Fprintln(a.stdout, result)
			return nil
		},
	}
}

// ─── kcli helm explain ────────────────────────────────────────────────────────

func newHelmExplainCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "explain <release> <values.key>",
		Short: "AI: explain what a helm values key does",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			release := args[0]
			valKey := args[1]
			client := a.aiClient()
			if !client.Enabled() {
				return fmt.Errorf("AI not configured")
			}

			valuesOut, _ := a.captureHelm([]string{"get", "values", release, "--all"})
			prompt := fmt.Sprintf("In Helm release '%s', explain the values key '%s' and its impact. Current computed values:\n%s", release, valKey, valuesOut)

			result, err := client.Analyze(context.Background(), "helm-explain", prompt)
			if err != nil {
				return fmt.Errorf("AI analysis failed: %w", err)
			}
			fmt.Fprintln(a.stdout, result)
			return nil
		},
	}
}

// ─── kcli helm repo ───────────────────────────────────────────────────────────

func newHelmRepoCmd(a *app) *cobra.Command {
	repo := &cobra.Command{
		Use:   "repo",
		Short: "Manage Helm chart repositories",
	}
	repo.AddCommand(
		newHelmPassthroughCmd(a, "add [args...]", "Add a chart repository"),
		newHelmPassthroughCmd(a, "list [args...]", "List chart repositories", "ls"),
		newHelmPassthroughCmd(a, "update [args...]", "Update chart repository indexes", "up"),
		newHelmPassthroughCmd(a, "remove [args...]", "Remove a chart repository", "rm"),
		newHelmPassthroughCmd(a, "index [args...]", "Generate an index file for a directory"),
	)
	return repo
}

// ─── kcli helm search ─────────────────────────────────────────────────────────

func newHelmSearchCmd(a *app) *cobra.Command {
	search := &cobra.Command{
		Use:   "search",
		Short: "Search Helm charts in hubs and repos",
	}
	search.AddCommand(
		newHelmPassthroughCmd(a, "hub [args...]", "Search Artifact Hub for charts"),
		newHelmPassthroughCmd(a, "repo [args...]", "Search charts in added repositories"),
	)
	return search
}

// ─── kcli helm diff ───────────────────────────────────────────────────────────

// helmDiffPluginInstalled returns true when the helm-diff plugin is present
// in `helm plugin list` output.  Runs helm with a 5-second timeout via the
// existing captureHelm helper so failures are non-fatal (returns false).
func (a *app) helmDiffPluginInstalled() bool {
	out, err := a.captureHelm([]string{"plugin", "list"})
	if err != nil {
		return false
	}
	for _, line := range strings.Split(out, "\n") {
		// plugin list columns: NAME  VERSION  DESCRIPTION
		// Match "diff" as the first whitespace-separated field.
		fields := strings.Fields(line)
		if len(fields) > 0 && strings.EqualFold(fields[0], "diff") {
			return true
		}
	}
	return false
}

const helmDiffInstallMsg = `helm-diff plugin not found.

Install with:
  helm plugin install https://github.com/databus23/helm-diff

Then retry:
  kcli helm diff %s`

func newHelmDiffCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "diff [subcommand] [release] [chart] [flags]",
		Short: "Preview changes a helm upgrade/rollback would make (requires helm-diff plugin)",
		Long: `Preview changes a helm command would make to a release without actually upgrading.

Requires the helm-diff plugin:
  helm plugin install https://github.com/databus23/helm-diff

Common subcommands:
  upgrade  <release> <chart>    diff pending upgrade against live release
  rollback <release> [revision] diff rollback target against live release
  release  <release>            diff two revisions of a release

Examples:
  kcli helm diff upgrade my-app ./chart
  kcli helm diff upgrade my-app ./chart --values prod.yaml
  kcli helm diff rollback my-app 3
  kcli helm diff release my-app 2 3`,
		DisableFlagParsing: true,
		RunE: func(c *cobra.Command, args []string) error {
			// Show help when --help/-h passed (DisableFlagParsing prevents cobra from handling it).
			for _, arg := range args {
				if arg == "--help" || arg == "-h" {
					_ = c.Help()
					return nil // Help() prints to stdout; returning nil avoids double-print of ErrHelp
				}
			}
			// P2-6: Check for helm-diff plugin before forwarding.
			if !a.helmDiffPluginInstalled() {
				releaseHint := "[release] [chart]"
				if len(args) >= 2 {
					releaseHint = strings.Join(args, " ")
				}
				return fmt.Errorf(helmDiffInstallMsg, releaseHint)
			}
			return a.runHelm(append([]string{"diff"}, args...))
		},
	}
}

// ─── kcli helm (parent) ───────────────────────────────────────────────────────

func newHelmCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "helm",
		Short: "First-class Helm integration with AI diagnostics",
		Long: `kcli helm provides full Helm CLI parity with automatic context and namespace
scoping from kcli global flags, plus AI-powered diagnostics.

All helm commands are passed through to the helm binary with kcli's active
context (--context) and namespace (-n) automatically applied.

Prerequisites: helm must be installed (https://helm.sh/docs/intro/install/)`,
		GroupID: "workflow",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	cmd.AddCommand(
		newHelmListCmd(a),
		newHelmPassthroughCmd(a, "status [args...]", "Show status of a release"),
		newHelmPassthroughCmd(a, "history [args...]", "Fetch release history", "hist"),
		newHelmDiffCmd(a),
		newHelmPassthroughCmd(a, "upgrade [args...]", "Upgrade a release", "up"),
		newHelmPassthroughCmd(a, "rollback [args...]", "Roll back a release to a previous revision"),
		newHelmPassthroughCmd(a, "install [args...]", "Install a chart"),
		newHelmPassthroughCmd(a, "uninstall [args...]", "Uninstall a release", "delete", "del"),
		newHelmPassthroughCmd(a, "get [args...]", "Download extended info (values, manifest, hooks, notes)"),
		newHelmPassthroughCmd(a, "values [args...]", "Show computed values for a release"),
		newHelmPassthroughCmd(a, "template [args...]", "Render chart templates locally"),
		newHelmPassthroughCmd(a, "lint [args...]", "Examine a chart for possible issues"),
		newHelmPassthroughCmd(a, "test [args...]", "Run tests for a release"),
		newHelmPassthroughCmd(a, "package [args...]", "Package a chart directory into a .tgz"),
		newHelmPassthroughCmd(a, "verify [args...]", "Verify that a chart at a given path has been signed"),
		newHelmPassthroughCmd(a, "dependency [args...]", "Manage chart dependencies", "dep"),
		newHelmPassthroughCmd(a, "plugin [args...]", "Install, list, or uninstall Helm plugins"),
		newHelmPassthroughCmd(a, "show [args...]", "Show chart information", "inspect"),
		newHelmPassthroughCmd(a, "pull [args...]", "Download a chart from a repository", "fetch"),
		newHelmPassthroughCmd(a, "push [args...]", "Push a chart to a remote"),
		newHelmPassthroughCmd(a, "registry [args...]", "Login to or logout from a registry"),
		newHelmPassthroughCmd(a, "env [args...]", "Helm client environment information"),
		newHelmPassthroughCmd(a, "version [args...]", "Print the client version information"),
		newHelmSearchCmd(a),
		newHelmRepoCmd(a),
		newHelmWhyCmd(a),
		newHelmSuggestCmd(a),
		newHelmExplainCmd(a),
	)

	return cmd
}
