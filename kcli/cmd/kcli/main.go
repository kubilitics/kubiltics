package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/kubilitics/kcli/internal/cli"
	"github.com/kubilitics/kcli/internal/logging"
	"github.com/kubilitics/kcli/internal/plugin"
	"github.com/kubilitics/kcli/internal/runner"
)

// procStart records the process start time as early as possible (package-init
// time).  It is used by the startup diagnostics flag KCLI_DEBUG_STARTUP=1.
var procStart = time.Now()

func main() {
	defer handlePanic()

	// Initialise structured logging from KCLI_LOG_LEVEL env var (default "off").
	logging.Init("")

	// Create a root context that is cancelled on SIGINT (Ctrl+C) or SIGTERM.
	// This ensures all kubectl subprocesses are cleaned up on signal delivery
	// instead of being orphaned.
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Register the process-start time with the cli package so the startup-timing
	// diagnostic (KCLI_DEBUG_STARTUP=1) can report accurate latency.
	cli.SetProcessStart(procStart)

	args := os.Args[1:]
	handled, err := plugin.TryRunForArgs(args, cli.IsBuiltinFirstArg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if handled {
		return
	}
	if shouldFallbackToKubectl(args) {
		kubectlArgs, force, ferr := stripKCLIOnlyFlags(args)
		if ferr != nil {
			fmt.Fprintln(os.Stderr, ferr)
			os.Exit(1)
		}
		if err := runner.RunKubectlContext(ctx, kubectlArgs, runner.ExecOptions{Force: force}); err != nil {
			if ctx.Err() != nil {
				// Context was cancelled by signal — exit quietly.
				os.Exit(130)
			}
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	root := cli.NewRootCommand()
	root.SetContext(ctx)
	if err := root.Execute(); err != nil {
		if ctx.Err() != nil {
			os.Exit(130)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// handlePanic recovers from any panic in main, writes a crash log with the
// full stack trace, and exits with code 2 to distinguish from normal errors.
func handlePanic() {
	r := recover()
	if r == nil {
		return
	}
	stack := debug.Stack()

	// Write crash log to a temp file.
	crashFile := fmt.Sprintf("/tmp/kcli-crash-%d.log", time.Now().Unix())
	crashContent := fmt.Sprintf("kcli panic: %v\n\n%s", r, stack)
	_ = os.WriteFile(crashFile, []byte(crashContent), 0o644)

	fmt.Fprintf(os.Stderr, "kcli: internal error (this is a bug)\n%v\n\nPlease report this at https://github.com/kubilitics/kubiltics/issues\nStack trace saved to: %s\n", r, crashFile)
	os.Exit(2)
}

// nativeKCLICommands are commands whose completion is handled by kcli's Cobra
// tree (they have real flags and ValidArgsFunction).  Everything else (kubectl
// passthrough verbs like get, apply, delete) should forward __complete to kubectl
// so kubectl's own rich completion machinery runs.
var nativeKCLICommands = map[string]bool{
	"ctx": true, "ns": true, "health": true, "restarts": true,
	"events": true, "metrics": true, "instability": true, "blame": true,
	"incident": true, "rbac": true, "audit": true, "plugin": true,
	"config": true, "kubeconfig": true, "prompt": true, "search": true,
	"version": true, "completion": true, "ui": true, "help": true,
}

func shouldFallbackToKubectl(args []string) bool {
	first := firstCommandToken(args)
	if first == "" {
		return false
	}
	// For Cobra's __complete/__completeNoDesc: forward to kubectl for kubectl
	// passthrough commands, but keep in kcli for native kcli commands so that
	// Cobra's ValidArgsFunction runs (ctx/ns context+namespace completion, etc.).
	if first == "__complete" || first == "__completeNoDesc" {
		// The completed command is the second non-flag token.
		subArgs := args
		for i, a := range args {
			if a == first {
				subArgs = args[i+1:]
				break
			}
		}
		completedCmd := firstCommandToken(subArgs)
		// Empty = top-level completion (kcli <TAB>) — must stay in kcli.
		if completedCmd == "" {
			return false
		}
		// Native kcli commands: completion handled by Cobra's ValidArgsFunction.
		if nativeKCLICommands[completedCmd] {
			return false
		}
		// Everything else (get, apply, logs, etc.): forward to kubectl.
		return true
	}
	return !cli.IsBuiltinFirstArg(first)
}

func firstCommandToken(args []string) string {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "" {
			continue
		}
		switch {
		case a == "--context" || a == "-n" || a == "--namespace" || a == "--kubeconfig" || a == "--completion-timeout":
			i++
			continue
		case strings.HasPrefix(a, "--context="), strings.HasPrefix(a, "--namespace="), strings.HasPrefix(a, "--kubeconfig="), strings.HasPrefix(a, "--completion-timeout="):
			continue
		case a == "--yes":
			// --yes is kcli-only, no value follows.
			continue
		case strings.HasPrefix(a, "-"):
			continue
		default:
			return a
		}
	}
	return ""
}

func stripKCLIOnlyFlags(args []string) ([]string, bool, error) {
	out := make([]string, 0, len(args))
	force := false
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		switch {
		case a == "--yes":
			// --yes is kcli-only (skip confirmation). Never forward to kubectl.
			force = true
			continue
		case a == "--force":
			// --force is forwarded to kubectl (e.g. kubectl delete --force).
			// It also sets force=true so kcli skips its own confirmation prompt.
			force = true
			out = append(out, args[i])
		case a == "--completion-timeout":
			if i+1 >= len(args) {
				return nil, false, fmt.Errorf("%s requires a value", a)
			}
			i++
			continue
		case strings.HasPrefix(a, "--completion-timeout="):
			continue
		default:
			out = append(out, args[i])
		}
	}
	if len(out) == 0 {
		return nil, false, fmt.Errorf("no kubectl command specified")
	}
	return out, force, nil
}
