package runner

import (
	"bufio"
	"bytes"
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

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/logging"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/terminal"
)

// KubectlError wraps a kubectl exit error with the captured stderr content,
// enabling callers to programmatically inspect error messages from kubectl
// (e.g. "error: the server doesn't have a resource type ...").
type KubectlError struct {
	Args     []string // kubectl args that were executed
	ExitCode int      // process exit code (non-zero)
	Stderr   string   // captured stderr output (trimmed)
}

func (e *KubectlError) Error() string {
	if e.Stderr != "" {
		return fmt.Sprintf("kubectl %s failed (exit %d): %s", strings.Join(e.Args, " "), e.ExitCode, e.Stderr)
	}
	return fmt.Sprintf("kubectl %s failed (exit %d)", strings.Join(e.Args, " "), e.ExitCode)
}

func (e *KubectlError) Unwrap() error {
	return fmt.Errorf("exit status %d", e.ExitCode)
}

// MinKubectlMajor and MinKubectlMinor define the minimum recommended kubectl client version.
// Older versions may trigger a warning (no hard failure).
const MinKubectlMajor = 1
const MinKubectlMinor = 28

// defaultKubectlTimeout is the maximum wall-clock time for non-streaming kubectl commands.
// Streaming/interactive commands (exec, attach, port-forward, proxy, edit, logs -f) are
// exempt and run without a timeout. This prevents hung kubectl processes from blocking
// kcli indefinitely when the kube-apiserver is unreachable.
const defaultKubectlTimeout = 15 * time.Second

// Retry defaults for CaptureKubectl / CaptureKubectlCtx.
const (
	defaultMaxRetries   = 3
	defaultBaseBackoff  = 500 * time.Millisecond
	defaultBackoffScale = 2 // exponential multiplier
)

// transientSubstrings are error message fragments that indicate a transient
// network or server-side failure worth retrying.
var transientSubstrings = []string{
	"connection refused",
	"connection reset by peer",
	"TLS handshake timeout",
	"i/o timeout",
	"dial tcp",
	"net/http: request canceled while waiting for connection",
	// HTTP status codes returned as kubectl stderr text
	"429 Too Many Requests",
	"503 Service Unavailable",
	"504 Gateway Timeout",
	// context deadline exceeded from the kubectl process itself
	"context deadline exceeded",
}

// nonRetryableSubstrings are error fragments that indicate a permanent failure
// which should NOT be retried.
var nonRetryableSubstrings = []string{
	"401 Unauthorized",
	"403 Forbidden",
	"404 Not Found",
	"error: the server doesn't have a resource type",
	"error: the object has been modified",
	"invalid argument",
	"unknown flag",
	"validation error",
}

// isRetryableError inspects combined stderr+stdout output and the error itself
// to decide whether the kubectl call hit a transient failure.
func isRetryableError(output string, err error) bool {
	if err == nil {
		return false
	}
	combined := output + " " + err.Error()
	// First check for non-retryable patterns (higher priority).
	lower := strings.ToLower(combined)
	for _, s := range nonRetryableSubstrings {
		if strings.Contains(lower, strings.ToLower(s)) {
			return false
		}
	}
	// Then check for transient patterns.
	for _, s := range transientSubstrings {
		if strings.Contains(lower, strings.ToLower(s)) {
			return true
		}
	}
	return false
}

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
	"cp": {}, // file copy to/from containers — tracked in audit log
}

var (
	kubectlCheckOnce sync.Once
	kubectlCheckErr  error
)

// sensitiveEnvPrefixes lists environment variable prefixes that must NOT be
// forwarded to kubectl child processes. These typically contain cloud provider
// secrets that kubectl does not need (it uses KUBECONFIG instead).
var sensitiveEnvPrefixes = []string{
	"AWS_SECRET_ACCESS_KEY=",
	"AWS_SESSION_TOKEN=",
	"GOOGLE_APPLICATION_CREDENTIALS=",
	"AZURE_CLIENT_SECRET=",
	"AZURE_TENANT_ID=",
	"AZURE_CLIENT_ID=",
	"GITHUB_TOKEN=",
	"GH_TOKEN=",
	"GITLAB_TOKEN=",
	"NPM_TOKEN=",
	"DOCKER_PASSWORD=",
	"REGISTRY_PASSWORD=",
}

// kubectlEnv returns a filtered environment for kubectl child processes.
// Strips sensitive cloud/CI credentials that kubectl doesn't need, and
// when ColorDisabled (e.g. Windows cmd.exe), sets TERM=dumb.
func kubectlEnv() []string {
	env := os.Environ()
	out := make([]string, 0, len(env))
	colorDisabled := terminal.ColorDisabled()
	for _, e := range env {
		// Filter TERM when color is disabled
		if colorDisabled && strings.HasPrefix(e, "TERM=") {
			continue
		}
		// Filter sensitive credentials
		if isSensitiveEnv(e) {
			continue
		}
		out = append(out, e)
	}
	if colorDisabled {
		out = append(out, "TERM=dumb")
	}
	return out
}

// isSensitiveEnv returns true if the env var matches a known sensitive prefix.
func isSensitiveEnv(envVar string) bool {
	for _, p := range sensitiveEnvPrefixes {
		if strings.HasPrefix(envVar, p) {
			return true
		}
	}
	return false
}

// kubectlPath holds the custom kubectl binary path set via SetKubectlPath.
// Access is protected by kubectlPathMu to be safe for concurrent use.
var (
	kubectlPathMu sync.RWMutex
	kubectlPath   string
)

// SetKubectlPath sets the kubectl binary path for all runner operations.
// This is the thread-safe replacement for os.Setenv("KCLI_KUBECTL_PATH", ...).
// It should be called once during startup (e.g. from PersistentPreRunE).
func SetKubectlPath(p string) {
	kubectlPathMu.Lock()
	kubectlPath = strings.TrimSpace(p)
	kubectlPathMu.Unlock()
}

// GetKubectlPath returns the configured kubectl binary path, or empty string
// if none was set. Exported for use by other packages (TUI, logs) that need
// to spawn kubectl directly instead of going through the runner.
func GetKubectlPath() string {
	kubectlPathMu.RLock()
	defer kubectlPathMu.RUnlock()
	return kubectlPath
}

// getKubectlBinary returns the kubectl binary path. It checks (in order):
// 1. The path set via SetKubectlPath (thread-safe, preferred)
// 2. The KCLI_KUBECTL_PATH environment variable (legacy fallback)
// 3. "kubectl" (default)
func getKubectlBinary() string {
	if p := GetKubectlPath(); p != "" {
		return p
	}
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

// isStreamingCommand returns true for kubectl commands that are long-lived or interactive
// and should NOT have a default timeout applied.
func isStreamingCommand(args []string) bool {
	verb := firstVerb(args)
	switch verb {
	case "exec", "attach", "port-forward", "proxy", "edit":
		return true
	case "logs":
		// kubectl logs -f / --follow is streaming
		for _, a := range args {
			if a == "-f" || a == "--follow" || strings.HasPrefix(a, "--follow=") {
				return true
			}
		}
	}
	return false
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
	// Use exec.CommandContext with a default timeout for non-streaming commands
	// to prevent hung kubectl processes when the kube-apiserver is unreachable.
	// Streaming/interactive commands run without timeout.
	var cmd *exec.Cmd
	var cancel context.CancelFunc
	if isStreamingCommand(args) {
		cmd = exec.Command(getKubectlBinary(), args...)
	} else {
		var ctx context.Context
		ctx, cancel = context.WithTimeout(context.Background(), defaultKubectlTimeout)
		cmd = exec.CommandContext(ctx, getKubectlBinary(), args...)
	}
	if cancel != nil {
		defer cancel()
	}
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

	// P1-ERR: For non-mutating commands, capture stderr via MultiWriter so that
	// (a) the user still sees real-time stderr output, and (b) on error we can
	// wrap the captured content into a structured KubectlError.
	// Mutating commands keep raw stderr flow for interactive feedback.
	isMutating := isMutatingVerb(args)
	var stderrBuf bytes.Buffer
	if !isMutating {
		cmd.Stderr = io.MultiWriter(stderr, &stderrBuf)
	} else {
		cmd.Stderr = stderr
	}

	// P2-5: Track timing for mutating verbs so we can write an audit record.
	wantAudit := opts.AuditFn != nil && isMutating
	logging.Debug("kubectl exec", "args", args)
	start := time.Now()
	runErr := cmd.Run()
	logging.Debug("kubectl done", "duration", time.Since(start), "error", runErr)

	if wantAudit {
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

	// P1-ERR: Wrap non-mutating command errors with captured stderr for structured handling.
	if runErr != nil && !isMutating {
		exitCode := 1
		if ee, ok := runErr.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		}
		return &KubectlError{
			Args:     args,
			ExitCode: exitCode,
			Stderr:   strings.TrimSpace(stderrBuf.String()),
		}
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
	// Delegate to CaptureKubectlCtx with a default timeout to prevent indefinite
	// blocking when kube-apiserver is unreachable (P1: default context timeout).
	ctx, cancel := context.WithTimeout(context.Background(), defaultKubectlTimeout)
	defer cancel()
	return CaptureKubectlCtx(ctx, args)
}

// CaptureKubectlCtx is like CaptureKubectl but kills the kubectl subprocess when
// ctx is cancelled or its deadline is exceeded. This prevents callers from
// blocking indefinitely when a parent operation (e.g. a watch loop) is stopped.
//
// P1-1: Includes automatic retry with exponential backoff for transient errors
// (connection refused, timeouts, 429/503/504). Auth errors (401/403), not-found
// (404), and validation errors are never retried. Retries are abandoned
// immediately if ctx is cancelled.
func CaptureKubectlCtx(ctx context.Context, args []string) (string, error) {
	if err := ensureKubectlAvailable(); err != nil {
		return "", fmt.Errorf("kubectl not available: %w", err)
	}

	var output string
	var lastErr error
	backoff := defaultBaseBackoff

	for attempt := 0; attempt <= defaultMaxRetries; attempt++ {
		// On retries, sleep with backoff (respecting context cancellation).
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return output, ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= time.Duration(defaultBackoffScale)
		}

		cmd := exec.CommandContext(ctx, getKubectlBinary(), args...)
		cmd.Env = kubectlEnv()
		logging.Debug("kubectl capture", "args", args, "attempt", attempt)
		captureStart := time.Now()
		b, err := cmd.CombinedOutput()
		output = string(b)
		logging.Debug("kubectl capture done", "duration", time.Since(captureStart), "attempt", attempt, "error", err)

		// Context cancellation is not retryable.
		if ctx.Err() != nil {
			return output, ctx.Err()
		}

		// Success — return immediately.
		if err == nil {
			return output, nil
		}

		lastErr = err

		// Only retry on transient errors; bail on permanent failures.
		if !isRetryableError(output, err) {
			return output, err
		}
	}

	// Exhausted all retries.
	return output, fmt.Errorf("kubectl %s failed after %d retries: %w",
		strings.Join(args, " "), defaultMaxRetries, lastErr)
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

// shouldConfirm returns true when a mutating kubectl command should prompt for
// user confirmation before executing.
func shouldConfirm(args []string, force bool) bool {
	if force || len(args) == 0 {
		return false
	}
	// Never prompt for confirmation on help requests or --yes
	for _, a := range args {
		if a == "--help" || a == "-h" {
			return false
		}
		if a == "--yes" {
			return false
		}
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
