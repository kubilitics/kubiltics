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

	"github.com/kubilitics/kcli/internal/ai"
	kcfg "github.com/kubilitics/kcli/internal/config"
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
	aiTimeout         time.Duration
	completionTimeout time.Duration
	cacheMu           sync.Mutex
	cache             map[string]cacheEntry
	aiOnce            sync.Once
	ai                *ai.Client
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
		aiTimeout:         5 * time.Second,
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
		Long:  "kcli provides kubectl parity (requires kubectl on PATH for get, apply, delete, logs, exec, etc.), context/namespace ergonomics (ctx, ns), observability shortcuts, incident mode, and optional AI in one CLI. client-go is used only for context/namespace listing and auth checks.",
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
	cmd.PersistentFlags().DurationVar(&a.aiTimeout, "ai-timeout", 5*time.Second, "AI request timeout (default 5s; use --ai-timeout=30s for slow providers)")
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
		// Debugging
		newDebugCmd(a),
		// Certificate management
		newCertificateCmd(a),
		// Auth token
		newTokenCmd(a),
		// Config management (kustomize — ks alias defined on the command itself)
		newKustomizeCmd(a),
		newKGPShortcutCmd(a),
		newAuthCmd(a),
		newContextCmd(a),
		newNamespaceCmd(a),
		newSearchCmd(a),
		newPluginCmd(),
		newConfigCmd(a),
		newPromptCmd(a),
		newKubeconfigCmd(a),
		// ── Observability ───────────────────────────────────────────────────
		newHealthCmd(a),
		newMetricsCmd(a),
		newRestartsCmd(a),
		newInstabilityCmd(a),
		newEventsCmd(a),
		newReplayCmd(a),
		newBlameCmd(a),
		newPromCmd(a),
		// ── Incident & cost ─────────────────────────────────────────────────
		newIncidentCmd(a),
		newOncallCmd(a),
		newCostCmd(a),
		// ── Security & policy ───────────────────────────────────────────────
		newSecurityCmd(a),
		newPolicyCmd(a),
		// ── Workflow ────────────────────────────────────────────────────────
		newAddonCmd(a),
		newHelmCmd(a),
		newGitopsCmd(a),
		newRBACCmd(a),
		newRunbookCmd(a),
		newDriftCmd(a),
		// ── Advanced ────────────────────────────────────────────────────────
		newGPUCmd(a),
		newPredictCmd(a),
		newAnomalyCmd(a),
		newAutohealCmd(a),
		newAuditCmd(a),
		newTeamCmd(a),
		// ── UI & AI ─────────────────────────────────────────────────────────
		newUICmd(a),
		newAICmd(a),
		newWhyCmd(a),
		newMemoryCmd(a),
		newSummarizeCmd(a),
		newSuggestCmd(a),
		newFixCmd(a),
		newVersionCmd(),
		newCompletionCmd(cmd),
		// ── Resource details ─────────────────────────────────────────────────
		newPodCmd(a),
		newDeploymentCmd(a),
		newServiceCmd(a),
		newNodeCmd(a),
		newStatefulSetCmd(a),
		newDaemonSetCmd(a),
		newJobCmd(a),
		newCronJobCmd(a),
		newHPACmd(a),
		newPVCCmd(a),
		newIngressCmd(a),
		newConfigMapCmd(a),
		newSecretCmd(a),
	)

	cmd.SetVersionTemplate(fmt.Sprintf("kcli {{.Version}} (commit %s, built %s)\n", version.Commit, version.BuildDate))
	cmd.SetHelpCommandGroupID("core")

	cmd.AddGroup(
		&cobra.Group{ID: "core", Title: "Core Kubernetes:"},
		&cobra.Group{ID: "workflow", Title: "Workflow:"},
		&cobra.Group{ID: "observability", Title: "Observability:"},
		&cobra.Group{ID: "incident", Title: "Incident Response:"},
		&cobra.Group{ID: "security", Title: "Security:"},
		&cobra.Group{ID: "ai", Title: "AI:"},
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
		case "version", "completion", "prompt", "config":
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

		// Optional custom kubectl path from config (runner reads KCLI_KUBECTL_PATH).
		if a.cfg != nil && strings.TrimSpace(a.cfg.General.KubectlPath) != "" {
			os.Setenv("KCLI_KUBECTL_PATH", strings.TrimSpace(a.cfg.General.KubectlPath))
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
		// Debugging
		"debug", "events",
		// Certificates & tokens
		"certificate", "token",
		// Kustomize
		"kustomize", "ks",
		// Shortcuts
		"kgp", "auth",
		// Context & namespace
		"ctx", "ns",
		// Other core
		"search", "plugin", "config", "kubeconfig", "prompt",
		// Observability
		"health", "metrics", "restarts", "instability", "replay", "blame", "prom",
		// Incident & cost
		"incident", "oncall", "cost",
		// Security
		"security", "policy",
		// Workflow
		"helm", "gitops", "rbac", "runbook", "drift",
		// Advanced
		"gpu", "predict", "anomaly", "autoheal", "audit", "team",
		// UI & AI
		"ui", "ai", "why", "memory", "summarize", "suggest", "fix",
		// Resource details
		"pod", "deployment", "service", "node", "statefulset", "daemonset",
		"job", "cronjob", "hpa", "pvc", "ingress", "configmap", "secret",
		// Meta
		"help", "completion", "version":
		return true
	default:
		return false
	}
}

func (a *app) uiOptions() ui.Options {
	client := a.aiClient()
	opts := ui.Options{
		Context:         a.context,
		Namespace:       a.namespace,
		Kubeconfig:      a.kubeconfig,
		AIEnabled:       client.Enabled(),
		RefreshInterval: a.cfg.RefreshIntervalDuration(),
		Theme:           a.cfg.ResolvedTheme(),
		Animations:      a.cfg.TUI.Animations,
		MaxListSize:     a.cfg.TUI.MaxListSize,
		ReadOnly:        a.cfg.TUI.ReadOnly,
	}
	if client.Enabled() {
		opts.AIFunc = func(target string) (string, error) {
			return client.Analyze(context.Background(), "why", target)
		}
	}
	return opts
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
	return runner.RunKubectl(full, opts)
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

func (a *app) aiClient() *ai.Client {
	a.aiOnce.Do(func() {
		if a.cfg == nil {
			a.cfg = kcfg.Default()
		}
		base := ai.Config{
			Enabled:          a.cfg.AI.Enabled,
			Provider:         a.cfg.AI.Provider,
			Endpoint:         a.cfg.AI.Endpoint,
			APIKey:           a.cfg.AI.APIKey,
			Model:            a.cfg.AI.Model,
			Timeout:          a.aiTimeout,
			BudgetMonthlyUSD: a.cfg.AI.BudgetMonthlyUSD,
			SoftLimitPercent: a.cfg.AI.SoftLimitPercent,
			MaxInputChars:    a.cfg.AI.MaxInputChars,
		}
		if base.MaxInputChars <= 0 {
			base.MaxInputChars = 16384
		}
		a.ai = ai.New(ai.MergeEnvOverrides(base, a.aiTimeout))
	})
	return a.ai
}

func (a *app) resetAIClient() {
	a.aiOnce = sync.Once{}
	a.ai = nil
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
