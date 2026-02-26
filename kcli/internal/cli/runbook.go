// runbook.go — kcli runbook: declarative YAML runbooks (P3-6).
//
// Runbooks chain kcli commands with variable substitution and optional conditions.
// Stored in ~/.kcli/runbooks/*.yaml
package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

const runbooksDirName = "runbooks"

type runbookSpec struct {
	Name    string        `yaml:"name"`
	Trigger string        `yaml:"trigger"`
	Steps   []runbookStep `yaml:"steps"`
}

type runbookStep struct {
	Cmd       string  `yaml:"cmd"`
	Condition string  `yaml:"condition"`
}

func newRunbookCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "runbook",
		Short: "Declarative runbooks that chain kcli commands",
		Long: `Runbooks are YAML files in ~/.kcli/runbooks/ that chain kcli commands
with variable substitution and optional conditions.

Example runbook (~/.kcli/runbooks/oom-handler.yaml):
  name: OOM Handler
  trigger: OOMKilled
  steps:
    - cmd: kcli why pod/{pod}
    - cmd: kcli fix deployment/{owner} --memory
      condition: namespace == production

Variables like {pod}, {owner}, {namespace} are substituted from --pod, --owner, --namespace flags.`,
		GroupID: "workflow",
	}

	list := &cobra.Command{
		Use:   "list",
		Short: "List available runbooks",
		RunE: func(c *cobra.Command, args []string) error {
			return a.runRunbookList(c)
		},
	}

	run := &cobra.Command{
		Use:   "run [name]",
		Short: "Execute a runbook",
		Long:  `Execute a runbook by name. Pass variables via --pod, --owner, --namespace, or --var key=value.`,
		Example: `  kcli runbook run oom-handler --pod=crashed-xyz
  kcli runbook run oom-handler --pod=api-0 --owner=api --namespace=prod`,
		Args: cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			return a.runRunbookRun(c, args[0])
		},
	}
	run.Flags().String("pod", "", "Value for {pod} variable")
	run.Flags().String("owner", "", "Value for {owner} variable")
	run.Flags().StringP("namespace", "n", "", "Value for {namespace} variable (also from global -n)")
	run.Flags().StringSlice("var", nil, "Additional variables as key=value (e.g. --var confidence=0.85)")

	cmd.AddCommand(list, run)
	return cmd
}

func (a *app) runbooksDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".kcli", runbooksDirName), nil
}

func (a *app) runRunbookList(cmd *cobra.Command) error {
	dir, err := a.runbooksDir()
	if err != nil {
		return err
	}
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			fmt.Fprintf(a.stdout, "\n%sNo runbooks found.%s\n", ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "%sCreate ~/.kcli/runbooks/ and add YAML files.%s\n\n", ansiGray, ansiReset)
			return nil
		}
		return err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	var runbooks []runbookSpec
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".yaml") && !strings.HasSuffix(strings.ToLower(e.Name()), ".yml") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var spec runbookSpec
		if err := yaml.Unmarshal(b, &spec); err != nil {
			continue
		}
		if spec.Name == "" {
			spec.Name = strings.TrimSuffix(strings.TrimSuffix(e.Name(), ".yaml"), ".yml")
		}
		runbooks = append(runbooks, spec)
	}

	if len(runbooks) == 0 {
		fmt.Fprintf(a.stdout, "\n%sNo runbooks found in ~/.kcli/runbooks/%s\n\n", ansiGray, ansiReset)
		return nil
	}

	fmt.Fprintf(a.stdout, "\n%s%s Runbooks%s\n\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "  %-25s %s\n", "NAME", "TRIGGER")
	fmt.Fprintf(a.stdout, "  %s\n", strings.Repeat("─", 50))
	for _, r := range runbooks {
		trigger := r.Trigger
		if trigger == "" {
			trigger = "-"
		}
		fmt.Fprintf(a.stdout, "  %-25s %s\n", r.Name, trigger)
	}
	fmt.Fprintln(a.stdout)
	return nil
}

func (a *app) runRunbookRun(cmd *cobra.Command, name string) error {
	dir, err := a.runbooksDir()
	if err != nil {
		return err
	}

	// Resolve runbook file (name or name.yaml)
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err != nil {
		path = filepath.Join(dir, name+".yaml")
		if _, err := os.Stat(path); err != nil {
			path = filepath.Join(dir, name+".yml")
			if _, err := os.Stat(path); err != nil {
				return fmt.Errorf("runbook %q not found in ~/.kcli/runbooks/", name)
			}
		}
	}

	b, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read runbook: %w", err)
	}

	var spec runbookSpec
	if err := yaml.Unmarshal(b, &spec); err != nil {
		return fmt.Errorf("invalid runbook YAML: %w", err)
	}
	if spec.Name == "" {
		spec.Name = name
	}

	// Build variable map from flags
	vars := make(map[string]string)
	if pod, _ := cmd.Flags().GetString("pod"); pod != "" {
		vars["pod"] = pod
	}
	if owner, _ := cmd.Flags().GetString("owner"); owner != "" {
		vars["owner"] = owner
	}
	if ns, _ := cmd.Flags().GetString("namespace"); ns != "" {
		vars["namespace"] = ns
	} else if a.namespace != "" {
		vars["namespace"] = a.namespace
	}
	if extra, _ := cmd.Flags().GetStringSlice("var"); len(extra) > 0 {
		for _, kv := range extra {
			parts := strings.SplitN(kv, "=", 2)
			if len(parts) == 2 {
				vars[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
			}
		}
	}

	// Resolve {owner} from pod if not set — get owner reference from pod
	if vars["owner"] == "" && vars["pod"] != "" {
		owner, _ := a.resolvePodOwner(vars["pod"], vars["namespace"])
		if owner != "" {
			vars["owner"] = owner
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot determine executable path: %w", err)
	}

	fmt.Fprintf(a.stdout, "\n%s%s Running runbook: %s%s\n\n", ansiBold, ansiCyan, spec.Name, ansiReset)

	for i, step := range spec.Steps {
		if step.Cmd == "" {
			continue
		}

		// Evaluate condition
		if step.Condition != "" && !a.evalRunbookCondition(step.Condition, vars) {
			fmt.Fprintf(a.stdout, "%s[%d] Skipped (condition not met: %s)%s\n", ansiGray, i+1, step.Condition, ansiReset)
			continue
		}

		// Substitute variables in cmd
		resolvedCmd := substituteVars(step.Cmd, vars)
		// Parse into args: "kcli why pod/x" -> ["why", "pod/x"]
		args := parseRunbookCmd(resolvedCmd)

		fmt.Fprintf(a.stdout, "%s[%d] %s%s\n", ansiBold, i+1, resolvedCmd, ansiReset)

		runArgs := []string{exe}
		if a.context != "" {
			runArgs = append(runArgs, "--context", a.context)
		}
		if a.namespace != "" {
			runArgs = append(runArgs, "-n", a.namespace)
		}
		if a.kubeconfig != "" {
			runArgs = append(runArgs, "--kubeconfig", a.kubeconfig)
		}
		runArgs = append(runArgs, args...)

		c := exec.Command(runArgs[0], runArgs[1:]...)
		c.Stdin = a.stdin
		c.Stdout = a.stdout
		c.Stderr = a.stderr
		if err := c.Run(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				return fmt.Errorf("step %d failed (exit %d)", i+1, exitErr.ExitCode())
			}
			return fmt.Errorf("step %d failed: %w", i+1, err)
		}
		fmt.Fprintln(a.stdout)
	}

	fmt.Fprintf(a.stdout, "%s✓ Runbook %s completed.%s\n\n", ansiGreen, spec.Name, ansiReset)
	return nil
}

func substituteVars(s string, vars map[string]string) string {
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{"+k+"}", v)
	}
	return s
}

// parseRunbookCmd splits "kcli why pod/x" or "kcli fix deployment/y --memory" into ["why", "pod/x"] or ["fix", "deployment/y", "--memory"].
// We expect the cmd to start with "kcli " or just be the subcommand.
func parseRunbookCmd(cmd string) []string {
	cmd = strings.TrimSpace(cmd)
	if strings.HasPrefix(cmd, "kcli ") {
		cmd = strings.TrimSpace(cmd[5:])
	}
	var args []string
	for len(cmd) > 0 {
		cmd = strings.TrimLeft(cmd, " \t")
		if len(cmd) == 0 {
			break
		}
		if cmd[0] == '"' || cmd[0] == '\'' {
			quote := cmd[0]
			end := strings.IndexByte(cmd[1:], quote)
			if end < 0 {
				args = append(args, cmd[1:])
				break
			}
			args = append(args, cmd[1:end+1])
			cmd = cmd[end+2:]
			continue
		}
		// Find next space or end
		i := 0
		for i < len(cmd) && cmd[i] != ' ' && cmd[i] != '\t' {
			i++
		}
		args = append(args, cmd[:i])
		cmd = cmd[i:]
	}
	return args
}

// evalRunbookCondition evaluates simple conditions: "namespace == production", "confidence > 0.80", "key != value".
func (a *app) evalRunbookCondition(cond string, vars map[string]string) bool {
	cond = strings.TrimSpace(cond)
	if cond == "" {
		return true
	}

	// namespace == production
	if m := regexp.MustCompile(`^namespace\s*==\s*(.+)$`).FindStringSubmatch(cond); len(m) == 2 {
		val := strings.Trim(strings.TrimSpace(m[1]), `"'`)
		return vars["namespace"] == val
	}
	if m := regexp.MustCompile(`^namespace\s*!=\s*(.+)$`).FindStringSubmatch(cond); len(m) == 2 {
		val := strings.Trim(strings.TrimSpace(m[1]), `"'`)
		return vars["namespace"] != val
	}

	// confidence > 0.80
	if m := regexp.MustCompile(`^confidence\s*>\s*([\d.]+)$`).FindStringSubmatch(cond); len(m) == 2 {
		threshold, _ := strconv.ParseFloat(m[1], 64)
		v, _ := strconv.ParseFloat(vars["confidence"], 64)
		return v > threshold
	}
	if m := regexp.MustCompile(`^confidence\s*>=\s*([\d.]+)$`).FindStringSubmatch(cond); len(m) == 2 {
		threshold, _ := strconv.ParseFloat(m[1], 64)
		v, _ := strconv.ParseFloat(vars["confidence"], 64)
		return v >= threshold
	}

	return false
}

// resolvePodOwner returns the owning deployment/statefulset name for a pod.
func (a *app) resolvePodOwner(podName, namespace string) (string, error) {
	args := []string{"get", "pod", podName, "-o", "json"}
	if namespace != "" {
		args = append(args, "-n", namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return "", err
	}
	var pod struct {
		Metadata struct {
			OwnerReferences []struct {
				Kind string `json:"kind"`
				Name string `json:"name"`
			} `json:"ownerReferences"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(out), &pod); err != nil {
		return "", err
	}
	for _, ref := range pod.Metadata.OwnerReferences {
		switch ref.Kind {
		case "ReplicaSet":
			// ReplicaSet's owner is Deployment — need one more lookup
			rsName := ref.Name
			rsArgs := []string{"get", "replicaset", rsName, "-o", "json"}
			if namespace != "" {
				rsArgs = append(rsArgs, "-n", namespace)
			}
			rsOut, err := a.captureKubectl(rsArgs)
			if err != nil {
				return rsName, nil // fallback to replicaset name
			}
			var rs struct {
				Metadata struct {
					OwnerReferences []struct {
						Kind string `json:"kind"`
						Name string `json:"name"`
					} `json:"ownerReferences"`
				} `json:"metadata"`
			}
			if json.Unmarshal([]byte(rsOut), &rs) == nil {
				for _, r := range rs.Metadata.OwnerReferences {
					if r.Kind == "Deployment" {
						return r.Name, nil
					}
				}
			}
			return rsName, nil
		case "StatefulSet", "DaemonSet":
			return ref.Name, nil
		}
	}
	return "", nil
}
