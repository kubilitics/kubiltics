package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	kcfg "github.com/kubilitics/kcli/internal/config"
	kcerr "github.com/kubilitics/kcli/internal/errors"
	"github.com/kubilitics/kcli/internal/runner"
	"github.com/kubilitics/kcli/internal/ui"
	"github.com/kubilitics/kcli/internal/version"
	"github.com/spf13/cobra"
)

// processStart is the earliest timestamp kcli can record.  main() sets this
// via SetProcessStart before NewRootCommand() is called.  It is used by the
// startup-timing diagnostic (KCLI_DEBUG_STARTUP=1) and by tests.
var processStart time.Time

// SetProcessStart records the process launch time. Call this as the very first
// statement in main() — before any other work — to get accurate startup timing.
func SetProcessStart(t time.Time) { processStart = t }

// ProcessStart returns the recorded process start time.
func ProcessStart() time.Time { return processStart }

type app struct {
	force             bool
	context           string
	namespace         string
	kubeconfig        string
	completionTimeout time.Duration
	cacheMu           sync.Mutex
	cache             map[string]cacheEntry
	cfg               *kcfg.Config
	cfgErr            error
	stdin             io.Reader
	stdout            io.Writer
	stderr            io.Writer
}

func NewRootCommand() *cobra.Command {
	return newRootCommand(os.Stdin, os.Stdout, os.Stderr)
}

func NewRootCommandWithIO(in io.Reader, out, errOut io.Writer) *cobra.Command {
	return newRootCommand(in, out, errOut)
}

func newRootCommand(in io.Reader, out, errOut io.Writer) *cobra.Command {
	cfg, cfgErr := kcfg.Load()
	if cfg == nil {
		cfg = kcfg.Default()
	}
	a := &app{
		completionTimeout: 250 * time.Millisecond,
		cache:             initCache(),
		cfg:               cfg,
		cfgErr:            cfgErr,
		stdin:             in,
		stdout:            out,
		stderr:            errOut,
	}

	cmd := &cobra.Command{
		Use:   "kcli",
		Short: "Unified Kubernetes command interface",
		Long:  "kcli provides kubectl parity (requires kubectl on PATH for get, apply, delete, logs, exec, etc.), context/namespace ergonomics (ctx, ns), observability shortcuts, and incident mode in one CLI. client-go is used only for context/namespace listing and auth checks.",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       version.Version,
	}

	// --yes is the canonical bypass flag for kcli safety confirmations.
	// --force is a DEPRECATED alias that also passes through to kubectl for
	// commands that use it (e.g. kubectl delete --force --grace-period=0).
	// DisableFlagParsing commands handle --force passthrough in applyInlineGlobalFlags.
	cmd.PersistentFlags().BoolVar(&a.force, "yes", false, "skip safety confirmations for mutating commands")
	cmd.PersistentFlags().BoolVar(&a.force, "force", false, "deprecated: use --yes for kcli confirmations; --force is passed through to kubectl")
	_ = cmd.PersistentFlags().MarkDeprecated("force", "use --yes to skip kcli confirmations; --force is now forwarded to kubectl")
	cmd.PersistentFlags().StringVar(&a.context, "context", "", "override kubectl context")
	cmd.PersistentFlags().StringVarP(&a.namespace, "namespace", "n", "", "override namespace")
	cmd.PersistentFlags().StringVar(&a.kubeconfig, "kubeconfig", "", "path to the kubeconfig file")
	cmd.PersistentFlags().DurationVar(&a.completionTimeout, "completion-timeout", 250*time.Millisecond, "timeout for completion lookups")

	cmd.AddCommand(
		// ── Core kubectl verbs ──────────────────────────────────────────────
		newGetCmd(a),
		newDescribeCmd(a),
		newApplyCmd(a),
		newCreateCmd(a),
		newDeleteCmd(a),
		newRunCmd(a),
		newExposeCmd(a),
		newSetCmd(a),
		newReplaceCmd(a),
		newLogsCmd(a),
		newExecCmd(a),
		newPortForwardCmd(a),
		newTopCmd(a),
		newRolloutCmd(a),
		newDiffCmd(a),
		newCpCmd(a),
		newProxyCmd(a),
		newAttachCmd(a),
		newExplainCmd(a),
		newWaitCmd(a),
		newScaleCmd(a),
		newAutoscaleCmd(a),
		newPatchCmd(a),
		newLabelCmd(a),
		newAnnotateCmd(a),
		newEditCmd(a),
		// Node operations
		newDrainCmd(a),
		newCordonCmd(a),
		newUncordonCmd(a),
		newTaintCmd(a),
		// Cluster info
		newClusterInfoCmd(a),
		newAPIResourcesCmd(a),
		newAPIVersionsCmd(a),
		// Debugging & auth
		newDebugCmd(a),
		newCertificateCmd(a),
		newTokenCmd(a),
		newKGPShortcutCmd(a),
		newAuthCmd(a),
		// ── Navigation ──────────────────────────────────────────────────────
		newContextCmd(a),
		newNamespaceCmd(a),
		newSearchCmd(a),
		// ── Observability ───────────────────────────────────────────────────
		newHealthCmd(a),
		newMetricsCmd(a),
		newRestartsCmd(a),
		newInstabilityCmd(a),
		newEventsCmd(a),
		newBlameCmd(a),
		// ── Incident ────────────────────────────────────────────────────────
		newIncidentCmd(a),
		// ── RBAC & Audit ────────────────────────────────────────────────────
		newRBACCmd(a),
		newAuditCmd(a),
		// ── TUI ─────────────────────────────────────────────────────────────
		newUICmd(a),
		// ── Config & Infrastructure ─────────────────────────────────────────
		newPluginCmd(),
		newConfigCmd(a),
		newPromptCmd(a),
		newKubeconfigCmd(a),
		newVersionCmd(),
		newCompletionCmd(cmd),
		newDoctorCmd(a),
	)

	cmd.SetVersionTemplate(fmt.Sprintf("kcli {{.Version}} (commit %s, built %s)\n", version.Commit, version.BuildDate))
	cmd.SetHelpCommandGroupID("core")

	cmd.AddGroup(
		&cobra.Group{ID: "core", Title: "Core Kubernetes:"},
		&cobra.Group{ID: "navigation", Title: "Navigation:"},
		&cobra.Group{ID: "observability", Title: "Observability:"},
		&cobra.Group{ID: "workflow", Title: "Workflow:"},
	)

	cmd.PersistentPreRunE = func(cmd *cobra.Command, _ []string) error {
		// ── Startup timing diagnostic ────────────────────────────────────
		// When KCLI_DEBUG_STARTUP=1 is set, print how long the process
		// took from launch to reaching the first command's pre-run hook.
		// This covers: Go runtime init, package-level vars, config load,
		// cobra setup, and flag parsing — everything before actual work.
		if os.Getenv("KCLI_DEBUG_STARTUP") == "1" && !processStart.IsZero() {
			ready := time.Since(processStart)
			budget := 250 * time.Millisecond
			if a.cfg != nil {
				if b, err := time.ParseDuration(a.cfg.General.StartupTimeBudget); err == nil && b > 0 {
					budget = b
				}
			}
			label := "ok"
			if ready > budget {
				label = "SLOW"
			}
			fmt.Fprintf(a.stderr, "[kcli startup] %s in %v (budget: %v) [%s]\n", cmd.Name(), ready.Round(time.Millisecond), budget, label)
		}

		// Commands that never invoke kubectl — skip any cluster/kubectl setup.
		// Kubectl is checked lazily on first RunKubectl/CaptureKubectl (P1-2).
		switch cmd.Name() {
		case "version", "completion", "prompt", "config", "doctor":
			return nil
		}
		// Config subcommands (view, get, set, reset, edit, profile) also skip.
		if p := cmd.Parent(); p != nil && p.Name() == "config" {
			return nil
		}

		// CI/CD Mode Enforcement
		if os.Getenv("KCLI_CI") == "true" {
			a.force = true
			if a.cfg != nil {
				a.cfg.TUI.Animations = false
			}
		}

		// Optional custom kubectl path from config — set via thread-safe runner API (P1-10).
		if a.cfg != nil && strings.TrimSpace(a.cfg.General.KubectlPath) != "" {
			runner.SetKubectlPath(strings.TrimSpace(a.cfg.General.KubectlPath))
		}
		// Kubectl is checked lazily on first use (runner.ensureKubectlAvailable) so version/completion/prompt start fast.

		if a.cfgErr != nil {
			return fmt.Errorf("invalid %s: %w", configPathSafe(), a.cfgErr)
		}
		if strings.TrimSpace(a.context) == "-" {
			return fmt.Errorf("--context '-' is not valid; use 'kcli ctx -' to switch to previous context")
		}
		return nil
	}

	cmd.SetErrPrefix("kcli: ")
	cmd.SetOut(a.stdout)
	cmd.SetErr(a.stderr)
	return cmd
}

func IsBuiltinFirstArg(name string) bool {
	switch strings.TrimSpace(name) {
	case "":
		return true
	// Core kubectl verbs
	case "get", "g", "describe", "desc", "apply", "ap", "create", "cr", "delete",
		"run", "expose", "set", "replace",
		"logs", "exec", "port-forward", "top",
		"rollout", "diff", "cp", "proxy", "attach", "explain", "wait", "scale", "autoscale",
		"patch", "label", "annotate", "edit",
		// Node operations
		"drain", "cordon", "uncordon", "taint",
		// Cluster info
		"cluster-info", "api-resources", "api-versions",
		// Debugging & auth
		"debug", "events", "certificate", "token", "auth",
		// Shortcuts
		"kgp",
		// Navigation
		"ctx", "ns", "search",
		// Config & infrastructure
		"plugin", "config", "kubeconfig", "prompt",
		// Observability
		"health", "metrics", "restarts", "instability", "blame",
		// Incident & RBAC
		"incident", "rbac", "audit",
		// TUI
		"ui",
		// Meta
		"help", "completion", "version", "doctor":
		return true
	default:
		return false
	}
}

func (a *app) uiOptions() ui.Options {
	return ui.Options{
		Context:         a.context,
		Namespace:       a.namespace,
		Kubeconfig:      a.kubeconfig,
		RefreshInterval: a.cfg.RefreshIntervalDuration(),
		Theme:           a.cfg.ResolvedTheme(),
		Animations:      a.cfg.TUI.Animations,
		MaxListSize:     a.cfg.TUI.MaxListSize,
		ReadOnly:        a.cfg.TUI.ReadOnly,
	}
}

func (a *app) scopedArgs() []string {
	args := make([]string, 0, 4)
	if a.context != "" {
		args = append(args, "--context", a.context)
	}
	if a.namespace != "" {
		args = append(args, "-n", a.namespace)
	}
	if a.kubeconfig != "" {
		args = append(args, "--kubeconfig", a.kubeconfig)
	}
	return args
}

func (a *app) runKubectl(args []string) error {
	full := a.scopeArgsFor(args)
	opts := runner.ExecOptions{
		Force:  a.force,
		Stdin:  a.stdin,
		Stdout: a.stdout,
		Stderr: a.stderr,
	}
	// P2-5: attach an audit callback for mutating commands unless opted out.
	noAuditEnv := strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "1" ||
		strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "true"
	auditDisabledByConfig := a.cfg != nil && a.cfg.General.AuditEnabled != nil && !*a.cfg.General.AuditEnabled
	if !noAuditEnv && !auditDisabledByConfig {
		opts.AuditFn = a.buildAuditFn()
	}
	return kcerr.Wrap(runner.RunKubectl(full, opts))
}

// buildAuditFn returns a function that appends an auditRecord after each
// mutating kubectl call.  The returned function captures a.context and
// a.namespace from the app so each record carries the right cluster/ns scope.
func (a *app) buildAuditFn() func(args []string, exitCode int, durationMS int64) {
	ctx := a.context
	ns := a.namespace
	return func(args []string, exitCode int, durationMS int64) {
		// Derive verb + rest-of-args from the full scoped arg list.
		verb := ""
		argParts := make([]string, 0, len(args))
		skip := false
		for i, tok := range args {
			if skip {
				skip = false
				continue
			}
			if tok == "--context" || tok == "--namespace" || tok == "-n" || tok == "--kubeconfig" {
				skip = true
				continue
			}
			if strings.HasPrefix(tok, "--context=") || strings.HasPrefix(tok, "--namespace=") || strings.HasPrefix(tok, "--kubeconfig=") {
				continue
			}
			if strings.HasPrefix(tok, "-n=") {
				continue
			}
			if verb == "" && !strings.HasPrefix(tok, "-") {
				verb = tok
				_ = i
				continue
			}
			argParts = append(argParts, tok)
		}

		result := "success"
		if exitCode != 0 {
			result = "error"
		}
		AppendAuditRecord(auditRecord{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			User:      currentUser(),
			Context:   ctx,
			Namespace: ns,
			Command:   verb,
			Args:      strings.Join(argParts, " "),
			Result:    result,
			Duration:  strconv.FormatInt(durationMS, 10),
		})
	}
}

func (a *app) captureKubectl(args []string) (string, error) {
	full := a.scopeArgsFor(args)
	return runner.CaptureKubectl(full)
}

// captureKubectlCtx is like captureKubectl but kills the kubectl subprocess
// when ctx is cancelled, preventing indefinite blocking in watch loops.
func (a *app) captureKubectlCtx(ctx context.Context, args []string) (string, error) {
	full := a.scopeArgsFor(args)
	return runner.CaptureKubectlCtx(ctx, full)
}

func (a *app) captureKubectlWithTimeout(args []string, timeout time.Duration) (string, error) {
	full := a.scopeArgsFor(args)
	return runner.CaptureKubectlWithTimeout(full, timeout)
}

func (a *app) scopeArgsFor(args []string) []string {
	out := make([]string, 0, len(args)+4)
	if a.context != "" && !hasContextFlag(args) {
		out = append(out, "--context", a.context)
	}
	if a.namespace != "" && !hasNamespaceFlag(args) && !hasAllNamespacesFlag(args) {
		out = append(out, "-n", a.namespace)
	}
	if a.kubeconfig != "" && !hasKubeconfigFlag(args) {
		out = append(out, "--kubeconfig", a.kubeconfig)
	}
	out = append(out, args...)
	return out
}

func hasContextFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "--context" {
			return true
		}
		if strings.HasPrefix(a, "--context=") {
			return true
		}
	}
	return false
}

func hasNamespaceFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "-n" || a == "--namespace" {
			return true
		}
		if strings.HasPrefix(a, "--namespace=") {
			return true
		}
	}
	return false
}

func hasAllNamespacesFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "-A" || a == "--all-namespaces" {
			return true
		}
	}
	return false
}

func hasKubeconfigFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "--kubeconfig" {
			return true
		}
		if strings.HasPrefix(a, "--kubeconfig=") {
			return true
		}
	}
	return false
}

func (a *app) applyInlineGlobalFlags(args []string) ([]string, func(), error) {
	prevForce := a.force
	prevContext := a.context
	prevNamespace := a.namespace
	prevKubeconfig := a.kubeconfig

	restore := func() {
		a.force = prevForce
		a.context = prevContext
		a.namespace = prevNamespace
		a.kubeconfig = prevKubeconfig
	}

	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		t := strings.TrimSpace(args[i])
		switch {
		case t == "--yes":
			// --yes: kcli-only flag, skip confirmation, do NOT forward to kubectl.
			a.force = true
		case t == "--force":
			// --force: set kcli confirmation bypass AND forward to kubectl.
			// kubectl uses --force for immediate deletion (--grace-period=0), etc.
			a.force = true
			out = append(out, args[i])
		case t == "--context":
			if i+1 >= len(args) {
				restore()
				return nil, func() {}, fmt.Errorf("--context requires a value")
			}
			i++
			a.context = strings.TrimSpace(args[i])
		case strings.HasPrefix(t, "--context="):
			a.context = strings.TrimSpace(strings.TrimPrefix(t, "--context="))
		case t == "-n" || t == "--namespace":
			if i+1 >= len(args) {
				restore()
				return nil, func() {}, fmt.Errorf("%s requires a value", t)
			}
			i++
			a.namespace = strings.TrimSpace(args[i])
		case strings.HasPrefix(t, "--namespace="):
			a.namespace = strings.TrimSpace(strings.TrimPrefix(t, "--namespace="))
		case t == "--kubeconfig":
			if i+1 >= len(args) {
				restore()
				return nil, func() {}, fmt.Errorf("--kubeconfig requires a value")
			}
			i++
			a.kubeconfig = strings.TrimSpace(args[i])
		case strings.HasPrefix(t, "--kubeconfig="):
			a.kubeconfig = strings.TrimSpace(strings.TrimPrefix(t, "--kubeconfig="))
		default:
			out = append(out, args[i])
		}
	}
	return out, restore, nil
}

func configPathSafe() string {
	p, err := kcfg.FilePath()
	if err != nil {
		return "~/.kcli/config.yaml"
	}
	return p
}
