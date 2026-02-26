package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/kubilitics/kcli/internal/runner"
	"github.com/spf13/cobra"
)

// destructiveExecPattern matches shell commands that can permanently destroy
// data or system state inside a container. This is a best-effort heuristic —
// it covers the most common dangerous patterns and is not exhaustive.
var destructiveExecPattern = regexp.MustCompile(
	`(?i)\b(rm\s+(-[a-z]*f[a-z]*|--force)\b|` + // rm -rf, rm -f, rm --force
		`dd\s+|` + // dd (disk dump — can overwrite block devices)
		`mkfs\b|` + // format filesystem
		`fdisk\b|` + // partition editor
		`truncate\s+|` + // truncate file to zero bytes
		`shred\s+|` + // secure delete
		`>(>?)\s*/dev/[^n]|` + // redirect to /dev/sda, /dev/nvme etc. (not /dev/null)
		`kubectl\s+delete|` + // kubectl inside kubectl exec — high blast radius
		`apt(-get)?\s+(remove|purge)|` + // package removal
		`yum\s+(remove|erase)|` + // rpm package removal
		`apk\s+del)`) // Alpine package removal

func newExecCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "exec (POD | TYPE/NAME) [COMMAND] [flags]",
		Short:              "Execute a command in a container with smart container selection",
		GroupID:            "core",
		DisableFlagParsing: true,
		ValidArgsFunction:  a.completeKubectl("exec"),
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()

			// If no container is specified via -c, try to find the best one
			if !hasContainerFlag(clean) && len(clean) > 0 {
				target := clean[0]
				if !strings.HasPrefix(target, "-") {
					ns, pod, err := a.resolvePod(target)
					if err == nil {
						container, err := a.selectContainer(ns, pod, "exec")
						if err == nil && container != "" {
							clean = insertContainerFlag(clean, container)
						}
					}
				}
			}

			// Guard against destructive commands run via exec without --yes.
			// e.g. kcli exec pod-name -- rm -rf /data
			if !a.force {
				if cmd, ok := extractExecCommand(clean); ok && isDestructiveExecCmd(cmd) {
					if !runner.IsTerminal() {
						return fmt.Errorf(
							"refusing to exec destructive command in non-interactive mode: %q\n"+
								"  Rerun with --yes to bypass this check, or verify the command is safe.",
							strings.Join(cmd, " "))
					}
					fmt.Fprintf(os.Stderr,
						"kcli: WARNING — this exec command may be destructive:\n"+
							"  kubectl exec %s\n"+
							"  Command after --: %s\n"+
							"Proceed? [y/N]: ",
						strings.Join(clean, " "),
						strings.Join(cmd, " "))
					r := bufio.NewReader(os.Stdin)
					line, _ := r.ReadString('\n')
					ans := strings.ToLower(strings.TrimSpace(line))
					if ans != "y" && ans != "yes" {
						return fmt.Errorf("aborted")
					}
				}
			}

			full := append([]string{"exec"}, clean...)
			return a.runKubectl(full)
		},
	}
}

func newPortForwardCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "port-forward (POD | TYPE/NAME) [LOCAL_PORT:]REMOTE_PORT [...-PORT] [flags]",
		Short:              "Forward one or more local ports to a pod",
		GroupID:            "core",
		DisableFlagParsing: true,
		ValidArgsFunction:  a.completeKubectl("port-forward"),
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()

			full := append([]string{"port-forward"}, clean...)
			return a.runKubectl(full)
		},
	}
}

func hasContainerFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "-c" || a == "--container" {
			return true
		}
		if strings.HasPrefix(a, "--container=") {
			return true
		}
	}
	return false
}

func insertContainerFlag(args []string, container string) []string {
	if len(args) == 0 {
		return []string{"-c", container}
	}
	// Insert after the first non-flag argument (the pod name)
	for i := 0; i < len(args); i++ {
		if !strings.HasPrefix(args[i], "-") {
			out := make([]string, 0, len(args)+2)
			out = append(out, args[:i+1]...)
			out = append(out, "-c", container)
			out = append(out, args[i+1:]...)
			return out
		}
	}
	return append([]string{"-c", container}, args...)
}

func (a *app) resolvePod(target string) (string, string, error) {
	// Simple pod resolution: handle ns/pod or just pod
	parts := strings.SplitN(target, "/", 2)
	if len(parts) == 2 {
		return parts[0], parts[1], nil
	}
	ns := a.namespace
	if ns == "" {
		ns = "default"
	}
	return ns, target, nil
}

// extractExecCommand returns the slice of arguments that follow a "--"
// separator in the exec arg list. These are the commands run inside the
// container and are the only portion subject to the destructive-command check.
func extractExecCommand(args []string) ([]string, bool) {
	for i, a := range args {
		if a == "--" && i+1 < len(args) {
			return args[i+1:], true
		}
	}
	return nil, false
}

// isDestructiveExecCmd returns true if any token in cmd matches the
// destructive-command heuristic pattern.
func isDestructiveExecCmd(cmd []string) bool {
	joined := strings.Join(cmd, " ")
	return destructiveExecPattern.MatchString(joined)
}

func (a *app) selectContainer(namespace, pod, _ string) (string, error) {
	// Use captureKubectl to get pod info as JSON
	out, err := a.captureKubectl([]string{"get", "pod", pod, "-n", namespace, "-o", "json"})
	if err != nil {
		return "", err
	}

	var p struct {
		Spec struct {
			Containers []struct {
				Name string `json:"name"`
			} `json:"containers"`
		} `json:"spec"`
	}
	if err := json.Unmarshal([]byte(out), &p); err != nil {
		return "", fmt.Errorf("failed to parse pod JSON: %w", err)
	}

	containers := make([]string, 0, len(p.Spec.Containers))
	for _, c := range p.Spec.Containers {
		containers = append(containers, c.Name)
	}

	if len(containers) <= 1 {
		return "", nil // No need to select if only one or zero
	}

	// If in terminal, prompt. Otherwise pick first.
	if !runner.IsTerminal() {
		return containers[0], nil
	}

	fmt.Fprintf(os.Stderr, "Pod %s has %d containers. Please select one:\n", pod, len(containers))
	for i, c := range containers {
		fmt.Fprintf(os.Stderr, " [%d] %s\n", i+1, c)
	}

	var choice int
	for {
		fmt.Fprintf(os.Stderr, "Select [1-%d]: ", len(containers))
		_, err := fmt.Scanf("%d", &choice)
		if err == nil && choice >= 1 && choice <= len(containers) {
			break
		}
		// Clear stdin buffer if invalid
		var discard string
		fmt.Scanln(&discard)
	}

	return containers[choice-1], nil
}
