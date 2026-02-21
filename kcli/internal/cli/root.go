package cli

import (
	"context"
	"fmt"
	"io"
	"os"
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
		aiTimeout:         30 * time.Second,
		completionTimeout: 250 * time.Millisecond,
		cache:             initCache(),
		cfg:               cfg,
		cfgErr:            cfgErr,
		stdin:             in,
		stdout:            out,
		stderr:            errOut,
	}

	cmd := &cobra.Command{
		Use:           "kcli",
		Short:         "Unified Kubernetes command interface for Kubilitics",
		Long:          "kcli brings kubectl parity, context/namespace ergonomics, observability shortcuts, incident mode, and optional AI in one CLI.",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       version.Version,
	}

	cmd.PersistentFlags().BoolVar(&a.force, "force", false, "skip safety confirmations for mutating commands")
	cmd.PersistentFlags().StringVar(&a.context, "context", "", "override kubectl context")
	cmd.PersistentFlags().StringVarP(&a.namespace, "namespace", "n", "", "override namespace")
	cmd.PersistentFlags().StringVar(&a.kubeconfig, "kubeconfig", "", "path to the kubeconfig file")
	cmd.PersistentFlags().DurationVar(&a.aiTimeout, "ai-timeout", 30*time.Second, "AI request timeout")
	cmd.PersistentFlags().DurationVar(&a.completionTimeout, "completion-timeout", 250*time.Millisecond, "timeout for completion lookups")

	cmd.AddCommand(
		newKubectlVerbCmd(a, "get", "Get resources", "g"),
		newKubectlVerbCmd(a, "describe", "Describe resources", "desc"),
		newKubectlVerbCmd(a, "apply", "Apply configuration to a resource", "ap"),
		newKubectlVerbCmd(a, "create", "Create resources from a file or stdin", "cr"),
		newKubectlVerbCmd(a, "delete", "Delete resources", "del"),
		newLogsCmd(a),
		newExecCmd(a),
		newPortForwardCmd(a),
		newKubectlVerbCmd(a, "top", "Display resource usage"),
		newKubectlVerbCmd(a, "rollout", "Manage rollout of resources"),
		newKubectlVerbCmd(a, "diff", "Diff live and local objects"),
		newKubectlVerbCmd(a, "cp", "Copy files and directories to and from containers"),
		newKubectlVerbCmd(a, "proxy", "Run a proxy to the Kubernetes API server"),
		newKubectlVerbCmd(a, "attach", "Attach to a running container"),
		newKubectlVerbCmd(a, "explain", "Show documentation for resource fields"),
		newKubectlVerbCmd(a, "wait", "Wait for a specific condition"),
		newKubectlVerbCmd(a, "scale", "Set a new size for a workload"),
		newKubectlVerbCmd(a, "patch", "Update fields of a resource"),
		newKubectlVerbCmd(a, "label", "Update labels on a resource"),
		newKubectlVerbCmd(a, "annotate", "Update annotations on a resource"),
		newKubectlVerbCmd(a, "edit", "Edit a resource on the server"),
		newKGPShortcutCmd(a),
		newAuthCmd(a),
		newContextCmd(a),
		newNamespaceCmd(a),
		newSearchCmd(a),
		newPluginCmd(),
		newConfigCmd(a),
		newHealthCmd(a),
		newMetricsCmd(a),
		newRestartsCmd(a),
		newInstabilityCmd(a),
		newEventsCmd(a),
		newIncidentCmd(a),
		newCostCmd(a),
		newSecurityCmd(a),
		newUICmd(a),
		newAICmd(a),
		newWhyCmd(a),
		newSummarizeCmd(a),
		newSuggestCmd(a),
		newFixCmd(a),
		newVersionCmd(),
		newCompletionCmd(cmd),
	)

	cmd.SetVersionTemplate(fmt.Sprintf("kcli {{.Version}} (commit %s, built %s)\n", version.Commit, version.BuildDate))
	cmd.SetHelpCommandGroupID("core")

	cmd.AddGroup(
		&cobra.Group{ID: "core", Title: "Core Kubernetes:"},
		&cobra.Group{ID: "workflow", Title: "Workflow:"},
		&cobra.Group{ID: "observability", Title: "Observability:"},
		&cobra.Group{ID: "incident", Title: "Incident Response:"},
		&cobra.Group{ID: "ai", Title: "AI:"},
	)

	cmd.PersistentPreRunE = func(cmd *cobra.Command, _ []string) error {
		// version and completion do not need a live cluster or kubectl.
		switch cmd.Name() {
		case "version", "completion":
			return nil
		}

		// CI/CD Mode Enforcement
		if os.Getenv("KCLI_CI") == "true" {
			a.force = true
			if a.cfg != nil {
				a.cfg.TUI.Animations = false
			}
		}

		// Kubernetes Dependency Check
		if err := checkKubectlDependency(); err != nil {
			return fmt.Errorf("dependency check failed: %w", err)
		}
		runner.WarnKubectlVersionSkew(a.stderr)

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

func checkKubectlDependency() error {
	_, err := runner.CaptureKubectl([]string{"version", "--client", "--output=json"})
	return err
}

func IsBuiltinFirstArg(name string) bool {
	switch strings.TrimSpace(name) {
	case "":
		return true
	case "get", "g", "describe", "desc", "apply", "ap", "create", "cr", "delete", "del", "logs", "exec", "port-forward", "top",
		"rollout", "diff", "explain", "wait", "scale", "patch", "label", "annotate", "edit", "kgp", "auth",
		"ctx", "ns", "search", "plugin", "config", "health", "metrics", "restarts", "instability", "events", "incident", "ui",
		"ai", "why", "summarize", "suggest", "fix", "help", "completion", "version",
		"cost", "security":
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
	return runner.RunKubectl(full, runner.ExecOptions{Force: a.force, Stdin: a.stdin, Stdout: a.stdout, Stderr: a.stderr})
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
		case t == "--force":
			a.force = true
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
