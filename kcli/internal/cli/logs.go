package cli

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/spf13/cobra"
)

// podRef identifies a specific pod by namespace and name.
type podRef struct {
	Namespace string
	Name      string
}

// logsOptions holds all options parsed from `kcli logs` arguments.
type logsOptions struct {
	Target        string
	Follow        bool
	AllNamespaces bool
	Namespace     string
	Container     string
	Tail          string
	Since         string
	Timestamps    bool
	Grep          string
	GrepV         string
	Save          string
	AIAnalyze   bool // --ai: general analysis of last 200 lines
	AISummarize bool
	AIErrors    bool
	AIExplain   bool

	// P4-4 / P0-7: stern-parity additions
	ExcludePods    string // --exclude: exclude pods whose name matches this regex
	ContainerState string // --container-state: running|waiting|terminated
	Node           string // --node: stream all pods on a specific node
	Output         string // --output: default|raw|json
	Template       string // --template: Go template for each log line
	MaxLogRequests int    // --max-log-requests: override logs.max_pods config

	// P1-8: Loki/LogQL integration
	Loki string // --loki '<logql>': query Loki instead of kubectl logs
}

// logLineData is the data structure passed to the --template Go template.
type logLineData struct {
	Namespace     string
	PodName       string
	ContainerName string
	Message       string
	Timestamp     string
}

// streamWriter multiplexes log lines from multiple pods to stdout and an
// optional save-file with per-pod colour coding.
type streamWriter struct {
	mu     sync.Mutex
	out    *os.File
	save   *os.File
	color  map[string]string
	output string             // "default" | "raw" | "json"
	tmpl   *template.Template // compiled --template, or nil
}

// podColors defined in ansi.go (empty when ColorDisabled for Windows cmd.exe)

// newLogsCmd creates the first-class `kcli logs` command.
func newLogsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "logs [target] [flags]",
		Short:   "Stream logs from pods, selectors, deployments, or nodes",
		GroupID: "core",
		Long: strings.TrimSpace(`
Stream Kubernetes logs with multi-pod fan-out, coloured prefixes, and AI analysis.

TARGET FORMS
  pod-name              Plain pod name → passed to kubectl logs directly
  pod-name.*            Pod name regex → matches all pods whose name matches
  key=value             Label selector → streams all matching pods
  deployment/name       Streams pods backing a Deployment
  --node NODE           Streams all pods scheduled on a node

FILTER FLAGS (kcli-native, not forwarded to kubectl)
  --grep PATTERN        Only show log lines matching PATTERN (Go regex)
  --grep-v PATTERN      Suppress log lines matching PATTERN
  --exclude PATTERN     Exclude pods whose name matches PATTERN (Go regex)
  --container-state S   Only include pods in state: running|waiting|terminated

OUTPUT
  --output default      Colour-prefixed  SOURCE | line  (default)
  --output raw          Bare log lines without prefix or colour
  --output json         JSON per-line: {"source":"ns/pod","message":"..."}
  --save FILE           Also write plain log lines to FILE

SINCE
  --since 5m            Standard kubectl duration (1h, 30m, …)
  --since 14:30         Absolute time today (converted to a duration)
  --since 14:30:00      Absolute time today with seconds

AI FLAGS
  --ai                  Collect last 200 lines, run AI root-cause analysis (no -f needed)
  --ai-summarize        Summarise log patterns with AI
  --ai-errors           Extract error/warn lines then run AI analysis
  --ai-explain          Explain the log stream with AI

LOKI (P1-8)
  --loki '<logql>'      Query Loki instead of kubectl logs. Requires Loki endpoint
                        (integrations.lokiEndpoint or LOKI_ENDPOINT env).
  --since, --tail, --timestamps  Apply to Loki queries.

Any other flags (e.g. -f, --timestamps, --tail, -c) are forwarded to kubectl.
`),
		DisableFlagParsing: true,
		ValidArgsFunction:  a.completeKubectl("logs"),
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()

			opts, err := parseLogsOptions(clean, a.namespace)
			if err != nil {
				return err
			}
			if opts.AIAnalyze || opts.AISummarize || opts.AIErrors || opts.AIExplain {
				return runLogsAI(a, clean, opts)
			}
			if opts.Loki != "" {
				return runLokiLogs(a, opts)
			}
			// Multi-pod path when any multi-pod signal is present.
			if opts.Node != "" || isPodNameRegex(opts.Target) ||
				isMultiPodTarget(opts.Target) ||
				opts.Grep != "" || opts.GrepV != "" ||
				opts.Save != "" || opts.ExcludePods != "" ||
				opts.Template != "" {
				return runMultiPodLogs(a, opts)
			}
			// Single pod: pass clean args (minus kcli-native flags) to kubectl.
			return a.runKubectl(append([]string{"logs"}, stripKcliLogsFlags(clean)...))
		},
	}
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

func parseLogsOptions(args []string, defaultNamespace string) (logsOptions, error) {
	opts := logsOptions{Namespace: defaultNamespace}
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		switch {
		case a == "":
			continue
		case a == "-f" || a == "--follow":
			opts.Follow = true
		case a == "-A" || a == "--all-namespaces":
			opts.AllNamespaces = true
		case a == "--timestamps":
			opts.Timestamps = true
		case a == "-n" || a == "--namespace":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("%s requires a value", a)
			}
			i++
			opts.Namespace = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--namespace="):
			opts.Namespace = strings.TrimSpace(strings.TrimPrefix(a, "--namespace="))
		case a == "-c" || a == "--container":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("%s requires a value", a)
			}
			i++
			opts.Container = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--container="):
			opts.Container = strings.TrimSpace(strings.TrimPrefix(a, "--container="))
		case a == "--tail":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--tail requires a value")
			}
			i++
			opts.Tail = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--tail="):
			opts.Tail = strings.TrimSpace(strings.TrimPrefix(a, "--tail="))
		case a == "--since":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--since requires a value")
			}
			i++
			opts.Since = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--since="):
			opts.Since = strings.TrimSpace(strings.TrimPrefix(a, "--since="))
		case a == "--grep":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--grep requires a value")
			}
			i++
			opts.Grep = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--grep="):
			opts.Grep = strings.TrimSpace(strings.TrimPrefix(a, "--grep="))
		case a == "--grep-v":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--grep-v requires a value")
			}
			i++
			opts.GrepV = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--grep-v="):
			opts.GrepV = strings.TrimSpace(strings.TrimPrefix(a, "--grep-v="))
		case a == "--save":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--save requires a value")
			}
			i++
			opts.Save = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--save="):
			opts.Save = strings.TrimSpace(strings.TrimPrefix(a, "--save="))
		case a == "--ai":
			opts.AIAnalyze = true
		case a == "--ai-summarize":
			opts.AISummarize = true
		case a == "--ai-errors":
			opts.AIErrors = true
		case a == "--ai-explain":
			opts.AIExplain = true

		// P4-4: stern-parity flags
		case a == "--exclude":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--exclude requires a value")
			}
			i++
			opts.ExcludePods = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--exclude="):
			opts.ExcludePods = strings.TrimSpace(strings.TrimPrefix(a, "--exclude="))
		case a == "--container-state":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--container-state requires a value")
			}
			i++
			opts.ContainerState = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--container-state="):
			opts.ContainerState = strings.TrimSpace(strings.TrimPrefix(a, "--container-state="))
		case a == "--node":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--node requires a value")
			}
			i++
			opts.Node = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--node="):
			opts.Node = strings.TrimSpace(strings.TrimPrefix(a, "--node="))
		case a == "--output":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--output requires a value")
			}
			i++
			opts.Output = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--output="):
			opts.Output = strings.TrimSpace(strings.TrimPrefix(a, "--output="))
		case a == "--template":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--template requires a value")
			}
			i++
			opts.Template = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--template="):
			opts.Template = strings.TrimSpace(strings.TrimPrefix(a, "--template="))
		case a == "--max-log-requests":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--max-log-requests requires a value")
			}
			i++
			n := 0
			fmt.Sscan(strings.TrimSpace(args[i]), &n)
			opts.MaxLogRequests = n
		case strings.HasPrefix(a, "--max-log-requests="):
			val := strings.TrimPrefix(a, "--max-log-requests=")
			n := 0
			fmt.Sscan(strings.TrimSpace(val), &n)
			opts.MaxLogRequests = n

		// P1-8: Loki/LogQL
		case a == "--loki":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--loki requires a LogQL query (e.g. --loki '{namespace=\"production\"} |= \"ERROR\"')")
			}
			i++
			opts.Loki = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--loki="):
			opts.Loki = strings.TrimSpace(strings.TrimPrefix(a, "--loki="))

		case !strings.HasPrefix(a, "-") && opts.Target == "":
			opts.Target = a
		}
	}
	if opts.AllNamespaces {
		opts.Namespace = ""
	}
	return opts, nil
}

// stripKcliLogsFlags removes kcli-native log flags (not understood by kubectl)
// before forwarding args to `kubectl logs`.
func stripKcliLogsFlags(args []string) []string {
	// Single-token boolean flags to drop.
	drop := map[string]bool{
		"--ai":           true,
		"--ai-summarize": true,
		"--ai-errors":    true,
		"--ai-explain":   true,
	}
	// Value-bearing flags whose flag+value pair must be dropped.
	dropPair := map[string]bool{
		"--grep": true, "--grep-v": true, "--save": true,
		"--exclude": true, "--node": true, "--container-state": true,
		"--output": true, "--template": true, "--max-log-requests": true,
		"--loki": true,
	}
	// Prefix forms (--flag=value) to drop.
	dropPfx := []string{
		"--grep=", "--grep-v=", "--save=",
		"--exclude=", "--node=", "--container-state=",
		"--output=", "--template=", "--max-log-requests=",
		"--loki=",
	}
	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if drop[a] {
			continue
		}
		if dropPair[a] {
			i++ // skip the value token
			continue
		}
		skip := false
		for _, pfx := range dropPfx {
			if strings.HasPrefix(a, pfx) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}
		out = append(out, args[i])
	}
	return out
}

// stripAILogFlags is kept for backward compatibility; delegates to stripKcliLogsFlags.
func stripAILogFlags(args []string) []string {
	return stripKcliLogsFlags(args)
}

// ---------------------------------------------------------------------------
// Target detection
// ---------------------------------------------------------------------------

// isMultiPodTarget returns true when target clearly addresses multiple pods
// via a label selector or deployment reference.
func isMultiPodTarget(target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	if strings.HasPrefix(target, "deployment/") || strings.HasPrefix(target, "deploy/") {
		return true
	}
	return strings.Contains(target, "=")
}

// isPodNameRegex returns true when s contains regex metacharacters that are
// not valid in plain Kubernetes pod names (which allow only [a-z0-9.-]).
func isPodNameRegex(s string) bool {
	if s == "" {
		return false
	}
	for _, ch := range `*+?[](){}|^$\` {
		if strings.ContainsRune(s, ch) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Since time parsing
// ---------------------------------------------------------------------------

// parseAbsoluteSince converts an absolute HH:MM or HH:MM:SS time-of-day into
// a kubectl --since duration string (e.g. "3720s"). Standard Go-parseable
// durations (5m, 2h30m, etc.) pass through unchanged, as does anything else.
func parseAbsoluteSince(since string) string {
	since = strings.TrimSpace(since)
	if since == "" {
		return since
	}
	// Already a Go duration? kubectl accepts 1h30m, 5m, 30s, etc.
	if _, err := time.ParseDuration(since); err == nil {
		return since
	}
	// Try HH:MM:SS first, then HH:MM (absolute time today → relative duration).
	layouts := []string{"15:04:05", "15:04"}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, since); err == nil {
			now := time.Now()
			target := time.Date(now.Year(), now.Month(), now.Day(),
				t.Hour(), t.Minute(), t.Second(), 0, now.Location())
			if target.After(now) {
				// Interpreted as yesterday's time.
				target = target.AddDate(0, 0, -1)
			}
			d := now.Sub(target)
			if d < time.Second {
				d = time.Second
			}
			return fmt.Sprintf("%ds", int(d.Seconds()))
		}
	}
	// Unknown format — pass through as-is; kubectl will validate.
	return since
}

// ---------------------------------------------------------------------------
// Pod listing helpers
// ---------------------------------------------------------------------------

// parsePodRefOutput parses "NAMESPACE\tNAME\n..." kubectl jsonpath output.
func parsePodRefOutput(out string) []podRef {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	pods := make([]podRef, 0, len(lines))
	seen := map[string]struct{}{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 2 {
			continue
		}
		p := podRef{
			Namespace: strings.TrimSpace(parts[0]),
			Name:      strings.TrimSpace(parts[1]),
		}
		if p.Namespace == "" || p.Name == "" {
			continue
		}
		k := p.Namespace + "/" + p.Name
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		pods = append(pods, p)
	}
	sort.SliceStable(pods, func(i, j int) bool {
		if pods[i].Namespace == pods[j].Namespace {
			return pods[i].Name < pods[j].Name
		}
		return pods[i].Namespace < pods[j].Namespace
	})
	return pods
}

// filterExcludePods removes pods whose name matches the given regex pattern.
func filterExcludePods(pods []podRef, pattern string) ([]podRef, error) {
	if pattern == "" {
		return pods, nil
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid --exclude regex %q: %w", pattern, err)
	}
	out := make([]podRef, 0, len(pods))
	for _, p := range pods {
		if !re.MatchString(p.Name) {
			out = append(out, p)
		}
	}
	return out, nil
}

// containerStateFieldSelector returns the kubectl --field-selector value for
// the given container-state string, or "" when no field filter is applicable.
func containerStateFieldSelector(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "running":
		return "status.phase=Running"
	case "waiting":
		return "status.phase=Pending"
	default:
		// "terminated" and empty — no phase filter; list all pods.
		// For "terminated" we later pass --previous to kubectl logs.
		return ""
	}
}

// listPodsBySelector lists pods matching a label selector, optionally filtered
// by container-state and --exclude pod-name regex.
func listPodsBySelector(a *app, opts logsOptions, selector string) ([]podRef, error) {
	args := []string{
		"get", "pods", "-l", selector,
		"-o", "jsonpath={range .items[*]}{.metadata.namespace}{\"\\t\"}{.metadata.name}{\"\\n\"}{end}",
	}
	if fs := containerStateFieldSelector(opts.ContainerState); fs != "" {
		args = append(args, "--field-selector="+fs)
	}
	if opts.AllNamespaces {
		args = append(args, "-A")
	} else if opts.Namespace != "" {
		args = append(args, "-n", opts.Namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, err
	}
	pods := parsePodRefOutput(out)
	return filterExcludePods(pods, opts.ExcludePods)
}

// listPodsByNode lists all pods scheduled on the node named opts.Node.
func listPodsByNode(a *app, opts logsOptions) ([]podRef, error) {
	fieldSel := "spec.nodeName=" + opts.Node
	if fs := containerStateFieldSelector(opts.ContainerState); fs != "" {
		fieldSel += "," + fs
	}
	args := []string{
		"get", "pods",
		"--field-selector=" + fieldSel,
		"-o", "jsonpath={range .items[*]}{.metadata.namespace}{\"\\t\"}{.metadata.name}{\"\\n\"}{end}",
	}
	if opts.AllNamespaces {
		args = append(args, "-A")
	} else if opts.Namespace != "" {
		args = append(args, "-n", opts.Namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, err
	}
	pods := parsePodRefOutput(out)
	return filterExcludePods(pods, opts.ExcludePods)
}

// listPodsByNameRegex lists all pods whose names match the given regex pattern.
func listPodsByNameRegex(a *app, opts logsOptions, pattern string) ([]podRef, error) {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("invalid pod name regex %q: %w", pattern, err)
	}
	args := []string{
		"get", "pods",
		"-o", "jsonpath={range .items[*]}{.metadata.namespace}{\"\\t\"}{.metadata.name}{\"\\n\"}{end}",
	}
	if fs := containerStateFieldSelector(opts.ContainerState); fs != "" {
		args = append(args, "--field-selector="+fs)
	}
	if opts.AllNamespaces {
		args = append(args, "-A")
	} else if opts.Namespace != "" {
		args = append(args, "-n", opts.Namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, err
	}
	all := parsePodRefOutput(out)
	filtered := make([]podRef, 0, len(all))
	for _, p := range all {
		if re.MatchString(p.Name) {
			filtered = append(filtered, p)
		}
	}
	return filterExcludePods(filtered, opts.ExcludePods)
}

// resolveDeploymentSelector returns the label selector string for a
// deployment/name or deploy/name target.
func resolveDeploymentSelector(a *app, opts logsOptions) (string, error) {
	target := strings.TrimSpace(opts.Target)
	parts := strings.SplitN(target, "/", 2)
	name := strings.TrimSpace(parts[1])
	if name == "" {
		return "", fmt.Errorf("invalid deployment target %q", target)
	}
	args := []string{
		"get", "deployment", name,
		"-o", "go-template={{range $k, $v := .spec.selector.matchLabels}}{{printf \"%s=%s,\" $k $v}}{{end}}",
	}
	if opts.Namespace != "" {
		args = append(args, "-n", opts.Namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return "", err
	}
	sel := strings.Trim(strings.TrimSpace(out), ",")
	if sel == "" {
		return "", fmt.Errorf("deployment %q has no matchLabels selector", name)
	}
	return sel, nil
}

// resolveLogsTargetPods resolves the full set of pods to stream logs from,
// handling all target forms: --node, label selector, deployment, pod-name regex.
func resolveLogsTargetPods(a *app, opts logsOptions) ([]podRef, error) {
	target := strings.TrimSpace(opts.Target)

	// --node takes highest precedence.
	if opts.Node != "" {
		return listPodsByNode(a, opts)
	}
	// label selector (key=value[,key=value…])
	if strings.Contains(target, "=") {
		return listPodsBySelector(a, opts, target)
	}
	// deployment/name or deploy/name
	if strings.HasPrefix(target, "deployment/") || strings.HasPrefix(target, "deploy/") {
		sel, err := resolveDeploymentSelector(a, opts)
		if err != nil {
			return nil, err
		}
		return listPodsBySelector(a, opts, sel)
	}
	// pod name regex
	if isPodNameRegex(target) {
		return listPodsByNameRegex(a, opts, target)
	}
	if target == "" {
		return nil, fmt.Errorf("logs target required when using multi-pod flags (--grep, --save, --exclude, etc.)")
	}
	return nil, fmt.Errorf("unsupported logs target %q; use selector key=value, deployment/name, or pod name regex", target)
}

// resolveLogSelector returns the label selector string for a multi-pod target.
// Kept for backward compatibility; new code uses resolveLogsTargetPods.
func resolveLogSelector(a *app, opts logsOptions) (string, error) {
	target := strings.TrimSpace(opts.Target)
	if target == "" {
		return "", fmt.Errorf("multi-pod logs requires target (selector or deployment/name)")
	}
	if strings.Contains(target, "=") {
		return target, nil
	}
	if strings.HasPrefix(target, "deployment/") || strings.HasPrefix(target, "deploy/") {
		return resolveDeploymentSelector(a, opts)
	}
	return "", fmt.Errorf("unsupported logs target %q; use selector key=value or deployment/name", target)
}

// ---------------------------------------------------------------------------
// Multi-pod streaming
// ---------------------------------------------------------------------------

func runMultiPodLogs(a *app, opts logsOptions) error {
	pods, err := resolveLogsTargetPods(a, opts)
	if err != nil {
		return err
	}
	if len(pods) == 0 {
		if opts.Node != "" {
			return fmt.Errorf("no pods found on node %q", opts.Node)
		}
		return fmt.Errorf("no pods match target %q", opts.Target)
	}

	match, exclude, err := compileLogFilters(opts)
	if err != nil {
		return err
	}

	// Compile --template if provided.
	var tmpl *template.Template
	if opts.Template != "" {
		tmpl, err = template.New("log").Parse(opts.Template)
		if err != nil {
			return fmt.Errorf("invalid --template: %w", err)
		}
	}

	writer, cleanup, err := newStreamWriter(opts.Save, opts.Output, tmpl)
	if err != nil {
		return err
	}
	defer cleanup()

	// Resolve absolute --since once so all goroutines use the same value.
	if opts.Since != "" {
		opts.Since = parseAbsoluteSince(opts.Since)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	// Determine effective max pods limit:
	// --max-log-requests CLI flag overrides config; config overrides 0 (unlimited).
	maxPods := 0
	if a.cfg != nil && a.cfg.Logs.MaxPods > 0 {
		maxPods = a.cfg.Logs.MaxPods
	}
	if opts.MaxLogRequests > 0 {
		maxPods = opts.MaxLogRequests
	}

	active := map[string]context.CancelFunc{}
	var mu sync.Mutex
	startStream := func(p podRef) {
		k := p.Namespace + "/" + p.Name
		mu.Lock()
		if _, ok := active[k]; ok {
			mu.Unlock()
			return
		}
		if maxPods > 0 && len(active) >= maxPods {
			mu.Unlock()
			fmt.Fprintf(os.Stderr, "%sWARN: max-log-requests limit (%d) reached — skipping %s/%s%s\n",
				ansiYellow, maxPods, p.Namespace, p.Name, ansiReset)
			return
		}
		pctx, pcancel := context.WithCancel(ctx)
		active[k] = pcancel
		mu.Unlock()
		go func() {
			_ = streamPodLogs(pctx, a, opts, p, writer, match, exclude)
			mu.Lock()
			delete(active, k)
			mu.Unlock()
		}()
	}

	for _, p := range pods {
		startStream(p)
	}

	if !opts.Follow {
		for {
			time.Sleep(100 * time.Millisecond)
			mu.Lock()
			left := len(active)
			mu.Unlock()
			if left == 0 {
				return nil
			}
		}
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			mu.Lock()
			for _, stop := range active {
				stop()
			}
			mu.Unlock()
			return nil
		case <-ticker.C:
			// Re-resolve pods on each tick so newly-scheduled pods are picked up.
			newPods, err := resolveLogsTargetPods(a, opts)
			if err != nil {
				continue
			}
			for _, p := range newPods {
				startStream(p)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Per-pod log streaming
// ---------------------------------------------------------------------------

func streamPodLogs(ctx context.Context, a *app, opts logsOptions, pod podRef, w *streamWriter, match, exclude *regexp.Regexp) error {
	args := []string{}
	if a.kubeconfig != "" {
		args = append(args, "--kubeconfig", a.kubeconfig)
	}
	if a.context != "" {
		args = append(args, "--context", a.context)
	}
	args = append(args, "logs")
	if opts.Follow {
		args = append(args, "-f")
	}
	// --container-state=terminated: fetch logs from the previously terminated
	// container instance using kubectl logs --previous.
	if strings.ToLower(strings.TrimSpace(opts.ContainerState)) == "terminated" {
		args = append(args, "--previous")
	}
	args = append(args, pod.Name, "-n", pod.Namespace)
	// Determine container name for template rendering.
	containerName := opts.Container
	if opts.Container != "" {
		args = append(args, "-c", opts.Container)
	}
	if opts.Tail != "" {
		args = append(args, "--tail", opts.Tail)
	}
	if opts.Since != "" {
		args = append(args, "--since", opts.Since)
	}
	if opts.Timestamps {
		args = append(args, "--timestamps")
	}

	kubectlBin := "kubectl"
	if p := strings.TrimSpace(os.Getenv("KCLI_KUBECTL_PATH")); p != "" {
		kubectlBin = p
	}
	cmd := exec.CommandContext(ctx, kubectlBin, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	var wg sync.WaitGroup
	consume := func(r io.Reader) {
		defer wg.Done()
		s := bufio.NewScanner(r)
		for s.Scan() {
			line := s.Text()
			if match != nil && !match.MatchString(line) {
				continue
			}
			if exclude != nil && exclude.MatchString(line) {
				continue
			}
			w.writeEntry(pod.Namespace, pod.Name, containerName, line)
		}
	}
	wg.Add(2)
	go consume(stdout)
	go consume(stderr)
	wg.Wait()
	return cmd.Wait()
}

// ---------------------------------------------------------------------------
// AI log analysis
// ---------------------------------------------------------------------------

func runLogsAI(a *app, cleanArgs []string, opts logsOptions) error {
	if opts.Follow {
		return fmt.Errorf("AI log analysis does not support follow mode; remove -f/--follow")
	}
	client := a.aiClient()
	if !client.Enabled() {
		return fmt.Errorf("AI not configured. Run: kcli config set ai.enabled true")
	}

	// P1-6: Collect at least 200 lines for AI analysis when --tail not specified.
	if opts.Tail == "" {
		opts.Tail = "200"
	}

	logText, err := collectLogsText(a, cleanArgs, opts)
	if err != nil {
		return err
	}
	if strings.TrimSpace(logText) == "" {
		return fmt.Errorf("no logs available for AI analysis")
	}

	// --ai: general analysis — cap at 200 lines per the P1-6 spec.
	if opts.AIAnalyze {
		input := lastNLogLines(logText, 200)
		out, err := client.Analyze(context.Background(), "why",
			"Analyze these Kubernetes pod logs. Identify error patterns, root causes, and suggest fixes.\n\n"+input)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Log Analysis ===")
		fmt.Fprintln(os.Stdout, out)
	}

	// Remaining AI modes use up to 1000 lines of context.
	logText = lastNLogLines(logText, 1000)

	if opts.AIErrors {
		errLines := extractErrorLines(logText)
		if len(errLines) == 0 {
			fmt.Fprintln(os.Stdout, "No error-like log lines found.")
		} else {
			fmt.Fprintln(os.Stdout, "=== Extracted Errors ===")
			for _, ln := range errLines {
				fmt.Fprintln(os.Stdout, ln)
			}
			fmt.Fprintln(os.Stdout)
		}
		input := logText
		if len(errLines) > 0 {
			input = strings.Join(errLines, "\n")
		}
		out, err := client.Analyze(context.Background(), "why", "Analyze these Kubernetes log errors and identify root causes:\n"+input)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Error Analysis ===")
		fmt.Fprintln(os.Stdout, out)
	}

	if opts.AISummarize {
		out, err := client.Analyze(context.Background(), "summarize-events", "Summarize these Kubernetes logs and major patterns:\n"+logText)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Log Summary ===")
		fmt.Fprintln(os.Stdout, out)
	}

	if opts.AIExplain {
		out, err := client.Analyze(context.Background(), "explain", "Explain this Kubernetes log stream and what to verify next:\n"+logText)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Log Explanation ===")
		fmt.Fprintln(os.Stdout, out)
	}
	return nil
}

// ---------------------------------------------------------------------------
// P1-8: Loki/LogQL integration
// ---------------------------------------------------------------------------

// lokiQueryRangeResponse is the JSON response from Loki /loki/api/v1/query_range.
type lokiQueryRangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Stream map[string]string `json:"stream"`
			Values [][2]string       `json:"values"` // [timestamp_ns, log_line]
		} `json:"result"`
	} `json:"data"`
}

func getLokiEndpoint(a *app) string {
	if a.cfg != nil && strings.TrimSpace(a.cfg.Integrations.LokiEndpoint) != "" {
		return strings.TrimSuffix(strings.TrimSpace(a.cfg.Integrations.LokiEndpoint), "/")
	}
	return strings.TrimSuffix(strings.TrimSpace(os.Getenv("LOKI_ENDPOINT")), "/")
}

func runLokiLogs(a *app, opts logsOptions) error {
	endpoint := getLokiEndpoint(a)
	if endpoint == "" {
		return fmt.Errorf("Loki endpoint not configured. Run: kcli config set integrations.lokiEndpoint http://loki:3100")
	}

	// Parse --since for time range (default: 1h)
	since := opts.Since
	if since == "" {
		since = "1h"
	}
	d, err := parseSinceToDuration(since)
	if err != nil {
		return fmt.Errorf("invalid --since for Loki: %w", err)
	}
	end := time.Now()
	start := end.Add(-d)

	limit := 100
	if opts.Tail != "" {
		if n, e := strconv.Atoi(strings.TrimSpace(opts.Tail)); e == nil && n > 0 {
			limit = n
		}
	}

	u, err := url.Parse(endpoint + "/loki/api/v1/query_range")
	if err != nil {
		return fmt.Errorf("invalid Loki endpoint: %w", err)
	}
	q := u.Query()
	q.Set("query", opts.Loki)
	q.Set("start", strconv.FormatInt(start.UnixNano(), 10))
	q.Set("end", strconv.FormatInt(end.UnixNano(), 10))
	q.Set("limit", strconv.Itoa(limit))
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(context.Background(), "GET", u.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Loki request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Loki returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var out lokiQueryRangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("failed to parse Loki response: %w", err)
	}
	if out.Status != "success" {
		return fmt.Errorf("Loki returned status %q", out.Status)
	}

	writer, cleanup, err := newStreamWriter(opts.Save, opts.Output, nil)
	if err != nil {
		return err
	}
	defer cleanup()

	// Sort all entries by timestamp (Loki returns per-stream; we merge and sort).
	type logEntry struct {
		ts    int64
		source string
		line  string
	}
	var entries []logEntry
	for _, stream := range out.Data.Result {
		source := lokiStreamToSource(stream.Stream)
		for _, v := range stream.Values {
			if len(v) < 2 {
				continue
			}
			ts, _ := strconv.ParseInt(v[0], 10, 64)
			line := v[1]
			if opts.Timestamps {
				t := time.Unix(0, ts)
				line = t.Format(time.RFC3339Nano) + " " + line
			}
			entries = append(entries, logEntry{ts: ts, source: source, line: line})
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ts < entries[j].ts })

	match, exclude, err := compileLogFilters(opts)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if match != nil && !match.MatchString(e.line) {
			continue
		}
		if exclude != nil && exclude.MatchString(e.line) {
			continue
		}
		writer.write(e.source, e.line)
	}
	return nil
}

func lokiStreamToSource(stream map[string]string) string {
	ns := stream["namespace"]
	pod := stream["pod"] // or pod_name
	if pod == "" {
		pod = stream["pod_name"]
	}
	if pod == "" {
		pod = stream["instance"]
	}
	if pod == "" {
		// Fallback: use job (often "namespace/pod")
		if j := stream["job"]; j != "" {
			return j
		}
		return "unknown"
	}
	if ns != "" {
		return ns + "/" + pod
	}
	return pod
}

func parseSinceToDuration(since string) (time.Duration, error) {
	since = strings.TrimSpace(since)
	if since == "" {
		return time.Hour, nil
	}
	if d, err := time.ParseDuration(since); err == nil {
		return d, nil
	}
	// Try absolute time (e.g. 14:30) — reuse parseAbsoluteSince which converts to duration string
	resolved := parseAbsoluteSince(since)
	if resolved == since && resolved != "" {
		// parseAbsoluteSince passed through; try parsing as duration again
		if d, err := time.ParseDuration(resolved); err == nil {
			return d, nil
		}
		return 0, fmt.Errorf("invalid duration or time %q", since)
	}
	return time.ParseDuration(resolved)
}

func collectLogsText(a *app, cleanArgs []string, opts logsOptions) (string, error) {
	stripped := stripKcliLogsFlags(cleanArgs)
	// Single pod: delegate to kubectl directly.
	if opts.Node == "" && !isPodNameRegex(opts.Target) && !isMultiPodTarget(opts.Target) {
		return a.captureKubectl(append([]string{"logs"}, stripped...))
	}
	pods, err := resolveLogsTargetPods(a, opts)
	if err != nil {
		return "", err
	}
	if len(pods) == 0 {
		return "", fmt.Errorf("no pods match target %q", opts.Target)
	}
	if len(pods) > 30 {
		pods = pods[:30]
	}
	// Apply --since absolute time conversion.
	since := parseAbsoluteSince(opts.Since)

	match, exclude, err := compileLogFilters(opts)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, p := range pods {
		args := []string{"logs", p.Name, "-n", p.Namespace}
		if opts.Container != "" {
			args = append(args, "-c", opts.Container)
		}
		if opts.Tail != "" {
			args = append(args, "--tail", opts.Tail)
		}
		if since != "" {
			args = append(args, "--since", since)
		}
		if opts.Timestamps {
			args = append(args, "--timestamps")
		}
		out, err := a.captureKubectl(args)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(out), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if match != nil && !match.MatchString(line) {
				continue
			}
			if exclude != nil && exclude.MatchString(line) {
				continue
			}
			b.WriteString(p.Namespace + "/" + p.Name + " | " + line + "\n")
		}
	}
	return b.String(), nil
}

// ---------------------------------------------------------------------------
// streamWriter
// ---------------------------------------------------------------------------

func newStreamWriter(savePath, output string, tmpl *template.Template) (*streamWriter, func(), error) {
	if output == "" {
		output = "default"
	}
	sw := &streamWriter{out: os.Stdout, color: map[string]string{}, output: output, tmpl: tmpl}
	cleanup := func() {}
	if strings.TrimSpace(savePath) != "" {
		f, err := os.OpenFile(savePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return nil, nil, err
		}
		sw.save = f
		cleanup = func() {
			_ = f.Close()
		}
	}
	return sw, cleanup, nil
}

// writeEntry writes a single log line with full context for template rendering.
// namespace, podName, containerName are the source identifiers; message is the raw log line.
func (w *streamWriter) writeEntry(namespace, podName, containerName, message string) {
	// Apply --template if set (takes precedence over all output modes).
	if w.tmpl != nil {
		w.mu.Lock()
		defer w.mu.Unlock()
		data := logLineData{
			Namespace:     namespace,
			PodName:       podName,
			ContainerName: containerName,
			Message:       message,
			Timestamp:     time.Now().Format(time.RFC3339),
		}
		var buf bytes.Buffer
		if err := w.tmpl.Execute(&buf, data); err != nil {
			// Fallback: print raw on template error (should not happen after compilation).
			fmt.Fprintln(w.out, message)
		} else {
			fmt.Fprintln(w.out, buf.String())
			if w.save != nil {
				fmt.Fprintln(w.save, buf.String())
			}
		}
		return
	}

	// Non-template path: delegate to write() using the legacy source string.
	source := namespace + "/" + podName
	w.write(source, message)
}

// write is the legacy per-source write method used by non-template output modes.
func (w *streamWriter) write(source, line string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	switch w.output {
	case "raw":
		// Bare log lines — no prefix, no colour.
		fmt.Fprintln(w.out, line)
		if w.save != nil {
			fmt.Fprintln(w.save, line)
		}
	case "json":
		// One JSON object per line: {"source":"ns/pod","message":"…"}
		// %q produces a valid JSON string with proper escape sequences.
		jsonStr := fmt.Sprintf(`{"source":%q,"message":%q}`, source, line)
		fmt.Fprintln(w.out, jsonStr)
		if w.save != nil {
			fmt.Fprintln(w.save, jsonStr)
		}
	default:
		// Colour-prefixed output (default).
		if _, ok := w.color[source]; !ok {
			w.color[source] = podColors[len(w.color)%len(podColors)]
		}
		color := w.color[source]
		formatted := fmt.Sprintf("%s%s%s | %s", color, source, ansiReset, line)
		fmt.Fprintln(w.out, formatted)
		if w.save != nil {
			fmt.Fprintln(w.save, source+" | "+line)
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func compileLogFilters(opts logsOptions) (*regexp.Regexp, *regexp.Regexp, error) {
	var match *regexp.Regexp
	var exclude *regexp.Regexp
	var err error
	if strings.TrimSpace(opts.Grep) != "" {
		match, err = regexp.Compile(opts.Grep)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid --grep regex: %w", err)
		}
	}
	if strings.TrimSpace(opts.GrepV) != "" {
		exclude, err = regexp.Compile(opts.GrepV)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid --grep-v regex: %w", err)
		}
	}
	return match, exclude, nil
}

func extractErrorLines(logText string) []string {
	lines := strings.Split(logText, "\n")
	// P1-6: Match ERROR/WARN level and common error keywords.
	re := regexp.MustCompile(`(?i)(\berror\b|\bwarn(ing)?\b|exception|panic|fail(ed|ure)?|crash|timeout|oom|denied|forbidden|refused)`)
	out := make([]string, 0, 200)
	seen := map[string]struct{}{}
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" || !re.MatchString(ln) {
			continue
		}
		if _, ok := seen[ln]; ok {
			continue
		}
		seen[ln] = struct{}{}
		out = append(out, ln)
		if len(out) >= 200 {
			break
		}
	}
	return out
}

func lastNLogLines(logText string, n int) string {
	lines := strings.Split(strings.TrimSpace(logText), "\n")
	if n <= 0 || len(lines) <= n {
		return strings.TrimSpace(logText)
	}
	return strings.Join(lines[len(lines)-n:], "\n")
}
