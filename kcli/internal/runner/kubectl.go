package runner

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kcli/internal/terminal"
)

// MinKubectlMajor and MinKubectlMinor define the minimum recommended kubectl client version.
// Older versions may trigger a warning (no hard failure).
const MinKubectlMajor = 1
const MinKubectlMinor = 28

type ExecOptions struct {
	Force  bool
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
	// AuditFn, when set, is called after every mutating kubectl execution
	// with the full args list, the process exit code (0 = success), and the
	// wall-clock duration in milliseconds.  Called synchronously before
	// RunKubectl returns so the audit record is always written.  The
	// implementation must be fast and non-blocking (e.g. write to a file;
	// do NOT make network calls).  Set to nil to disable.
	AuditFn func(args []string, exitCode int, durationMS int64)
}

var mutatingVerbs = map[string]struct{}{
	"apply": {}, "delete": {}, "edit": {}, "patch": {}, "replace": {},
	"create": {}, "run": {}, "drain": {}, "taint": {}, "set": {}, "expose": {},
	"rollout": {}, "scale": {}, "autoscale": {}, "label": {}, "annotate": {},
}

var (
	kubectlCheckOnce sync.Once
	kubectlCheckErr  error
)

// kubectlEnv returns the environment for kubectl child process.
// P2-10: When ColorDisabled (e.g. Windows cmd.exe), sets TERM=dumb so kubectl outputs plain text.
func kubectlEnv() []string {
	env := os.Environ()
	if !terminal.ColorDisabled() {
		return env
	}
	// Override TERM so kubectl does not emit ANSI codes
	out := make([]string, 0, len(env)+1)
	prefix := "TERM="
	for _, e := range env {
		if !strings.HasPrefix(e, prefix) {
			out = append(out, e)
		}
	}
	out = append(out, "TERM=dumb")
	return out
}

// getKubectlBinary returns the kubectl binary path (from KCLI_KUBECTL_PATH env or "kubectl").
func getKubectlBinary() string {
	if p := strings.TrimSpace(os.Getenv("KCLI_KUBECTL_PATH")); p != "" {
		return p
	}
	return "kubectl"
}

// ensureKubectlAvailable runs kubectl version --client once per process and caches the result.
// This avoids running the check for commands that do not use kubectl (e.g. version, completion, prompt).
func ensureKubectlAvailable() error {
	kubectlCheckOnce.Do(func() {
		cmd := exec.Command(getKubectlBinary(), "version", "--client", "--output=json")
		cmd.Stdout = nil
		cmd.Stderr = nil
		kubectlCheckErr = cmd.Run()
	})
	return kubectlCheckErr
}

func RunKubectl(args []string, opts ExecOptions) error {
	if len(args) == 0 {
		return fmt.Errorf("no kubectl command provided")
	}
	if err := ensureKubectlAvailable(); err != nil {
		return fmt.Errorf("kubectl not available: %w", err)
	}
	if opts.Stderr != nil {
		WarnKubectlVersionSkew(opts.Stderr)
	}
	if shouldConfirm(args, opts.Force) {
		ok, err := askForConfirmation(args)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("aborted")
		}
	}
	cmd := exec.Command(getKubectlBinary(), args...)
	cmd.Env = kubectlEnv()
	stdin := opts.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}
	stdout := opts.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	cmd.Stdin = stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	// P2-5: Track timing for mutating verbs so we can write an audit record.
	isMutating := opts.AuditFn != nil && isMutatingVerb(args)
	start := time.Now()
	runErr := cmd.Run()

	if isMutating {
		exitCode := 0
		if runErr != nil {
			if ee, ok := runErr.(*exec.ExitError); ok {
				exitCode = ee.ExitCode()
			} else {
				exitCode = 1
			}
		}
		opts.AuditFn(args, exitCode, time.Since(start).Milliseconds())
	}

	return runErr
}

// isMutatingVerb returns true when the first non-flag word in args is one of
// the known mutating kubectl verbs.
func isMutatingVerb(args []string) bool {
	verb := firstVerb(args)
	_, ok := mutatingVerbs[verb]
	return ok
}

// NewKubectlCmd creates an *exec.Cmd for the given kubectl args with stdin,
// stdout, and stderr wired from opts, but does NOT call cmd.Start().
//
// Use this when you need Start/Wait semantics (e.g. concurrent progress
// display while kubectl runs in the background).  The caller is responsible
// for calling cmd.Start() and cmd.Wait().
//
// Note: WarnKubectlVersionSkew is NOT called here to avoid duplicate warnings.
// The caller should call WarnKubectlVersionSkew if needed before Start().
func NewKubectlCmd(args []string, opts ExecOptions) (*exec.Cmd, error) {
	if len(args) == 0 {
		return nil, fmt.Errorf("no kubectl command provided")
	}
	if err := ensureKubectlAvailable(); err != nil {
		return nil, fmt.Errorf("kubectl not available: %w", err)
	}
	cmd := exec.Command(getKubectlBinary(), args...)
	cmd.Env = kubectlEnv()
	stdin := opts.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}
	stdout := opts.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	cmd.Stdin = stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd, nil
}

// RunKubectlContext is like RunKubectl but accepts a context for cancellation.
// Useful for running kubectl commands that should be cancelled when a parent
// operation completes (e.g. background event watchers).
func RunKubectlContext(ctx context.Context, args []string, opts ExecOptions) error {
	if len(args) == 0 {
		return fmt.Errorf("no kubectl command provided")
	}
	if err := ensureKubectlAvailable(); err != nil {
		return fmt.Errorf("kubectl not available: %w", err)
	}
	cmd := exec.CommandContext(ctx, getKubectlBinary(), args...)
	cmd.Env = kubectlEnv()
	stdin := opts.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}
	stdout := opts.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	cmd.Stdin = stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}

func CaptureKubectl(args []string) (string, error) {
	if err := ensureKubectlAvailable(); err != nil {
		return "", fmt.Errorf("kubectl not available: %w", err)
	}
	cmd := exec.Command(getKubectlBinary(), args...)
	b, err := cmd.CombinedOutput()
	return string(b), err
}

// KubectlVersionClient returns the client version (major, minor) from kubectl version --client -o json.
// Returns 0,0 and nil error if parsing fails (caller can ignore).
func KubectlVersionClient() (major, minor int, err error) {
	out, err := CaptureKubectl([]string{"version", "--client", "--output=json"})
	if err != nil {
		return 0, 0, err
	}
	var v struct {
		ClientVersion struct {
			Major string `json:"major"`
			Minor string `json:"minor"`
		} `json:"clientVersion"`
	}
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		return 0, 0, err
	}
	major, _ = strconv.Atoi(strings.TrimSpace(v.ClientVersion.Major))
	minor, _ = strconv.Atoi(strings.TrimPrefix(strings.TrimSpace(v.ClientVersion.Minor), "+"))
	return major, minor, nil
}

// WarnKubectlVersionSkew checks the current kubectl client version against MinKubectlMajor/MinKubectlMinor
// and writes a warning to w if the version is older. No-op if check fails (e.g. kubectl not in PATH).
func WarnKubectlVersionSkew(w io.Writer) {
	if w == nil {
		return
	}
	major, minor, err := KubectlVersionClient()
	if err != nil {
		return
	}
	if major > MinKubectlMajor {
		return
	}
	if major == MinKubectlMajor && minor >= MinKubectlMinor {
		return
	}
	fmt.Fprintf(w, "kcli: warning: kubectl client version %d.%d is older than recommended %d.%d; some features may not work\n", major, minor, MinKubectlMajor, MinKubectlMinor)
}

func CaptureKubectlWithTimeout(args []string, timeout time.Duration) (string, error) {
	if err := ensureKubectlAvailable(); err != nil {
		return "", fmt.Errorf("kubectl not available: %w", err)
	}
	if timeout <= 0 {
		return CaptureKubectl(args)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, getKubectlBinary(), args...)
	cmd.Env = kubectlEnv()
	b, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(b), fmt.Errorf("kubectl timed out after %s", timeout)
	}
	return string(b), err
}

func shouldConfirm(args []string, force bool) bool {
	if force || len(args) == 0 {
		return false
	}
	words := commandWords(args)
	if len(words) == 0 {
		return false
	}
	verb := strings.ToLower(strings.TrimSpace(words[0]))
	if verb == "rollout" && len(words) > 1 {
		sub := strings.ToLower(strings.TrimSpace(words[1]))
		if sub == "status" || sub == "history" {
			return false
		}
	}
	_, ok := mutatingVerbs[verb]
	return ok
}

func commandWords(args []string) []string {
	words := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		tok := strings.TrimSpace(args[i])
		if tok == "" {
			continue
		}
		if tok == "--context" || tok == "--namespace" || tok == "-n" || tok == "--kubeconfig" {
			i++
			continue
		}
		if strings.HasPrefix(tok, "--context=") || strings.HasPrefix(tok, "--namespace=") || strings.HasPrefix(tok, "--kubeconfig=") {
			continue
		}
		if strings.HasPrefix(tok, "-") {
			continue
		}
		words = append(words, tok)
	}
	return words
}

func firstVerb(args []string) string {
	words := commandWords(args)
	if len(words) == 0 {
		return ""
	}
	return words[0]
}

func askForConfirmation(args []string) (bool, error) {
	if !IsTerminal() {
		return false, fmt.Errorf("refusing mutating command in non-interactive mode without --force")
	}
	fmt.Fprintf(os.Stderr, "This command may mutate cluster state:\n  kubectl %s\n", strings.Join(args, " "))
	fmt.Fprint(os.Stderr, "Proceed? [y/N]: ")
	r := bufio.NewReader(os.Stdin)
	line, err := r.ReadString('\n')
	if err != nil {
		if err == io.EOF {
			return false, fmt.Errorf("confirmation required in non-interactive mode; rerun with --force")
		}
		return false, err
	}
	ans := strings.ToLower(strings.TrimSpace(line))
	return ans == "y" || ans == "yes", nil
}

func IsTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
