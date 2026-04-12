package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	kcfg "github.com/kubilitics/kubilitics/kubilitics-cli/internal/config"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/plugin"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/runner"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/version"
	"github.com/spf13/cobra"
)

// doctorCheckResult represents the outcome of a single doctor check.
type doctorCheckResult struct {
	Name    string `json:"name"`
	Status  string `json:"status"` // "ok", "warn", "error", "info"
	Message string `json:"message"`
}

// doctorReport is the full doctor output, used for JSON serialization.
type doctorReport struct {
	Checks []doctorCheckResult `json:"checks"`
}

func newDoctorCmd(a *app) *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:     "doctor",
		Short:   "Validate kcli environment and diagnose issues",
		Long:    "Runs a series of health checks on the kcli environment: kubectl availability, kubeconfig, cluster connectivity, config file, plugins, shell completion, and version info.",
		GroupID: "workflow",
		RunE: func(cmd *cobra.Command, _ []string) error {
			checks := runDoctorChecks(a)
			if strings.EqualFold(strings.TrimSpace(output), "json") {
				return printDoctorJSON(cmd, checks)
			}
			printDoctorText(cmd, checks)
			return nil
		},
	}
	cmd.Flags().StringVarP(&output, "output", "o", "", "output format (json)")
	return cmd
}

func runDoctorChecks(a *app) []doctorCheckResult {
	var checks []doctorCheckResult
	checks = append(checks, checkKubectl())
	checks = append(checks, checkKubeconfig(a))
	checks = append(checks, checkCluster(a))
	checks = append(checks, checkConfig())
	checks = append(checks, checkPlugins())
	checks = append(checks, checkShellCompletion())
	checks = append(checks, checkVersion())
	return checks
}

// checkKubectl verifies kubectl is installed and reports its version and path.
func checkKubectl() doctorCheckResult {
	bin := "kubectl"
	if p := strings.TrimSpace(os.Getenv("KCLI_KUBECTL_PATH")); p != "" {
		bin = p
	}
	path, err := exec.LookPath(bin)
	if err != nil {
		return doctorCheckResult{
			Name:    "kubectl",
			Status:  "error",
			Message: fmt.Sprintf("kubectl not found in PATH (looked for %q)", bin),
		}
	}

	major, minor, err := runner.KubectlVersionClient()
	if err != nil {
		return doctorCheckResult{
			Name:    "kubectl",
			Status:  "warn",
			Message: fmt.Sprintf("kubectl found at %s but version check failed: %v", path, err),
		}
	}

	msg := fmt.Sprintf("kubectl v%d.%d found at %s", major, minor, path)
	status := "ok"
	if major == runner.MinKubectlMajor && minor < runner.MinKubectlMinor {
		status = "warn"
		msg += fmt.Sprintf(" (recommended >= %d.%d)", runner.MinKubectlMajor, runner.MinKubectlMinor)
	}
	return doctorCheckResult{Name: "kubectl", Status: status, Message: msg}
}

// checkKubeconfig verifies the kubeconfig file exists and is parseable.
func checkKubeconfig(a *app) doctorCheckResult {
	// Use scoped args to pick up --kubeconfig override.
	args := []string{"config", "get-contexts", "-o", "name"}
	if a.kubeconfig != "" {
		args = append([]string{"--kubeconfig", a.kubeconfig}, args...)
	}
	out, err := runner.CaptureKubectlWithTimeout(args, 5*time.Second)
	if err != nil {
		// Try to determine which kubeconfig file is at issue.
		kubeconfigPath := a.kubeconfig
		if kubeconfigPath == "" {
			kubeconfigPath = os.Getenv("KUBECONFIG")
		}
		if kubeconfigPath == "" {
			if home, herr := os.UserHomeDir(); herr == nil {
				kubeconfigPath = filepath.Join(home, ".kube", "config")
			}
		}
		if kubeconfigPath != "" {
			if _, serr := os.Stat(kubeconfigPath); os.IsNotExist(serr) {
				return doctorCheckResult{
					Name:    "kubeconfig",
					Status:  "error",
					Message: fmt.Sprintf("kubeconfig not found: %s", kubeconfigPath),
				}
			}
		}
		return doctorCheckResult{
			Name:    "kubeconfig",
			Status:  "error",
			Message: fmt.Sprintf("kubeconfig parse error: %v", err),
		}
	}
	contexts := strings.Fields(strings.TrimSpace(out))
	count := len(contexts)
	suffix := "context"
	if count != 1 {
		suffix = "contexts"
	}
	return doctorCheckResult{
		Name:    "kubeconfig",
		Status:  "ok",
		Message: fmt.Sprintf("kubeconfig loaded (%d %s)", count, suffix),
	}
}

// checkCluster tests whether the current cluster is reachable.
func checkCluster(a *app) doctorCheckResult {
	args := []string{"cluster-info", "--request-timeout=5s"}
	if a.context != "" {
		args = append([]string{"--context", a.context}, args...)
	}
	if a.kubeconfig != "" {
		args = append([]string{"--kubeconfig", a.kubeconfig}, args...)
	}
	out, err := runner.CaptureKubectlWithTimeout(args, 10*time.Second)
	if err != nil {
		return doctorCheckResult{
			Name:    "cluster",
			Status:  "error",
			Message: "cluster unreachable: " + strings.TrimSpace(firstLine(out)),
		}
	}
	// Extract cluster name from the output — first line typically is
	// "Kubernetes control plane is running at https://..."
	clusterName := extractClusterName(a)
	if clusterName != "" {
		return doctorCheckResult{
			Name:    "cluster",
			Status:  "ok",
			Message: fmt.Sprintf("cluster reachable (%s)", clusterName),
		}
	}
	return doctorCheckResult{
		Name:    "cluster",
		Status:  "ok",
		Message: "cluster reachable",
	}
}

// extractClusterName tries to get the current context name.
func extractClusterName(a *app) string {
	args := []string{"config", "current-context"}
	if a.kubeconfig != "" {
		args = append([]string{"--kubeconfig", a.kubeconfig}, args...)
	}
	out, err := runner.CaptureKubectlWithTimeout(args, 3*time.Second)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// checkConfig validates ~/.kcli/config.yaml.
func checkConfig() doctorCheckResult {
	path, err := kcfg.FilePath()
	if err != nil {
		return doctorCheckResult{
			Name:    "config",
			Status:  "warn",
			Message: fmt.Sprintf("cannot determine config path: %v", err),
		}
	}
	cfg, loadErr := kcfg.Load()
	if loadErr != nil {
		return doctorCheckResult{
			Name:    "config",
			Status:  "error",
			Message: fmt.Sprintf("config invalid: %v", loadErr),
		}
	}
	if cfg == nil {
		cfg = kcfg.Default()
	}
	if valErr := cfg.Validate(); valErr != nil {
		return doctorCheckResult{
			Name:    "config",
			Status:  "warn",
			Message: fmt.Sprintf("config has warnings: %v", valErr),
		}
	}
	// Shorten path for display.
	display := path
	if home, herr := os.UserHomeDir(); herr == nil {
		if rel, rerr := filepath.Rel(home, path); rerr == nil && !strings.HasPrefix(rel, "..") {
			display = "~/" + rel
		}
	}
	return doctorCheckResult{
		Name:    "config",
		Status:  "ok",
		Message: fmt.Sprintf("config valid (%s)", display),
	}
}

// checkPlugins verifies installed plugins' integrity.
func checkPlugins() doctorCheckResult {
	plugins, err := plugin.DiscoverInfo()
	if err != nil {
		return doctorCheckResult{
			Name:    "plugins",
			Status:  "warn",
			Message: fmt.Sprintf("cannot discover plugins: %v", err),
		}
	}
	if len(plugins) == 0 {
		return doctorCheckResult{
			Name:    "plugins",
			Status:  "ok",
			Message: "plugins: none installed",
		}
	}

	var failedNames []string
	for _, p := range plugins {
		if verr := plugin.VerifyPlugin(p.Name); verr != nil {
			failedNames = append(failedNames, p.Name)
		}
	}
	if len(failedNames) > 0 {
		return doctorCheckResult{
			Name:   "plugins",
			Status: "error",
			Message: fmt.Sprintf("plugins: %d installed, verification failed for: %s",
				len(plugins), strings.Join(failedNames, ", ")),
		}
	}
	return doctorCheckResult{
		Name:    "plugins",
		Status:  "ok",
		Message: fmt.Sprintf("plugins: %d installed, all verified", len(plugins)),
	}
}

// checkShellCompletion checks if shell completion is installed for the current shell.
func checkShellCompletion() doctorCheckResult {
	shell := detectShell()
	if shell == "" {
		return doctorCheckResult{
			Name:    "shell-completion",
			Status:  "warn",
			Message: "shell completion: cannot detect current shell",
		}
	}

	installed := false
	switch shell {
	case "zsh":
		installed = zshCompletionInstalled()
	case "bash":
		installed = bashCompletionInstalled()
	case "fish":
		installed = fishCompletionInstalled()
	}

	if installed {
		return doctorCheckResult{
			Name:    "shell-completion",
			Status:  "ok",
			Message: fmt.Sprintf("shell completion installed for %s", shell),
		}
	}
	return doctorCheckResult{
		Name:    "shell-completion",
		Status:  "error",
		Message: fmt.Sprintf("shell completion not installed for %s", shell),
	}
}

// checkVersion reports the current kcli version, Go version, and OS/arch.
func checkVersion() doctorCheckResult {
	return doctorCheckResult{
		Name:   "version",
		Status: "info",
		Message: fmt.Sprintf("kcli v%s (%s, %s/%s)",
			version.Version, runtime.Version(), runtime.GOOS, runtime.GOARCH),
	}
}

// --- helpers ---

func detectShell() string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		return ""
	}
	base := filepath.Base(shell)
	switch base {
	case "zsh", "bash", "fish":
		return base
	}
	return base
}

func zshCompletionInstalled() bool {
	// Check common completion directories for a _kcli file.
	fpath := os.Getenv("FPATH")
	if fpath == "" {
		return false
	}
	for _, dir := range strings.Split(fpath, ":") {
		candidate := filepath.Join(dir, "_kcli")
		if _, err := os.Stat(candidate); err == nil {
			return true
		}
	}
	return false
}

func bashCompletionInstalled() bool {
	// Check common bash completion directories.
	dirs := []string{
		"/etc/bash_completion.d",
		"/usr/local/etc/bash_completion.d",
	}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".bash_completion.d"))
	}
	for _, dir := range dirs {
		candidate := filepath.Join(dir, "kcli")
		if _, err := os.Stat(candidate); err == nil {
			return true
		}
	}
	return false
}

func fishCompletionInstalled() bool {
	if home, err := os.UserHomeDir(); err == nil {
		candidate := filepath.Join(home, ".config", "fish", "completions", "kcli.fish")
		if _, err := os.Stat(candidate); err == nil {
			return true
		}
	}
	return false
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		return s[:idx]
	}
	return s
}

func printDoctorText(cmd *cobra.Command, checks []doctorCheckResult) {
	w := cmd.OutOrStdout()
	fmt.Fprintln(w, "kcli doctor")
	for _, c := range checks {
		var icon string
		switch c.Status {
		case "ok":
			icon = "\u2713" // checkmark
		case "error":
			icon = "\u2717" // cross
		case "warn":
			icon = "\u2717" // cross
		case "info":
			icon = "\u2139" // info
		default:
			icon = "?"
		}
		fmt.Fprintf(w, "  %s %s\n", icon, c.Message)
	}
}

func printDoctorJSON(cmd *cobra.Command, checks []doctorCheckResult) error {
	report := doctorReport{Checks: checks}
	b, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), string(b))
	return nil
}
