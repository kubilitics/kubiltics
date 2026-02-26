package cli

import (
	"fmt"
	"strings"
	"sync"

	"github.com/kubilitics/kcli/internal/runner"
	"github.com/kubilitics/kcli/internal/state"
)

type multiClusterOptions struct {
	AllContexts bool
	Group       string
	Args        []string
}

func parseMultiClusterOptions(args []string) (multiClusterOptions, error) {
	out := multiClusterOptions{Args: make([]string, 0, len(args))}
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		switch {
		case a == "--all-contexts":
			out.AllContexts = true
		case a == "--context-group":
			if i+1 >= len(args) {
				return out, fmt.Errorf("--context-group requires a value")
			}
			i++
			out.Group = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--context-group="):
			out.Group = strings.TrimSpace(strings.TrimPrefix(a, "--context-group="))
		default:
			out.Args = append(out.Args, args[i])
		}
	}
	if out.Group != "" {
		out.AllContexts = true
	}
	if out.AllContexts && out.Group == "" {
		out.Group = ""
	}
	return out, nil
}

func (a *app) runGetWithMultiCluster(args []string) error {
	opts, err := parseMultiClusterOptions(args)
	if err != nil {
		return err
	}
	if !opts.AllContexts {
		full := append([]string{"get"}, opts.Args...)
		return a.runKubectl(full)
	}

	contexts, err := a.resolveTargetContexts(opts.Group)
	if err != nil {
		return err
	}
	if len(contexts) == 0 {
		return fmt.Errorf("no contexts available for multi-cluster query")
	}
	if strings.TrimSpace(a.context) != "" {
		return fmt.Errorf("--all-contexts cannot be combined with global --context")
	}

	type result struct {
		ctxName string
		out     string
		err     error
	}
	results := make([]result, len(contexts))
	var wg sync.WaitGroup
	for i, ctxName := range contexts {
		wg.Add(1)
		go func(i int, ctxName string) {
			defer wg.Done()
			cmdArgs := make([]string, 0, len(opts.Args)+4)
			cmdArgs = append(cmdArgs, "--context", ctxName, "get")
			if a.namespace != "" && !hasNamespaceFlag(opts.Args) {
				cmdArgs = append(cmdArgs, "-n", a.namespace)
			}
			cmdArgs = append(cmdArgs, opts.Args...)
			out, runErr := runner.CaptureKubectl(cmdArgs)
			results[i] = result{ctxName: ctxName, out: out, err: runErr}
		}(i, ctxName)
	}
	wg.Wait()

	// Output in original context order
	var hadFailure bool
	for _, r := range results {
		fmt.Printf("\n=== Context: %s ===\n", r.ctxName)
		if strings.TrimSpace(r.out) != "" {
			fmt.Print(r.out)
			if !strings.HasSuffix(r.out, "\n") {
				fmt.Println()
			}
		}
		if r.err != nil {
			hadFailure = true
			fmt.Printf("error: %v\n", r.err)
		}
	}
	if hadFailure {
		return fmt.Errorf("one or more contexts failed")
	}
	return nil
}

func (a *app) resolveTargetContexts(groupName string) ([]string, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName != "" {
		s, err := state.Load()
		if err != nil {
			return nil, err
		}
		if s.ContextGroups == nil {
			return nil, fmt.Errorf("context group %q not found", groupName)
		}
		contexts, ok := s.ContextGroups[groupName]
		if !ok || len(contexts) == 0 {
			return nil, fmt.Errorf("context group %q is empty or not found", groupName)
		}
		return contexts, nil
	}
	return listContexts(a)
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
