package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/k8sclient"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
	"github.com/spf13/cobra"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type k8sEventList struct {
	Items []k8sEvent `json:"items"`
}

type k8sEvent struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Message   string `json:"message"`
	Count     int    `json:"count"`
	EventTime string `json:"eventTime"`

	FirstTimestamp string `json:"firstTimestamp"`
	LastTimestamp  string `json:"lastTimestamp"`

	InvolvedObject struct {
		Kind      string `json:"kind"`
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"involvedObject"`

	Source struct {
		Component string `json:"component"`
		Host      string `json:"host"`
	} `json:"source"`

	Metadata struct {
		Name              string `json:"name"`
		Namespace         string `json:"namespace"`
		CreationTimestamp string `json:"creationTimestamp"`
	} `json:"metadata"`
}

type eventRecord struct {
	Timestamp time.Time `json:"timestamp"`
	Type      string    `json:"type"`
	Namespace string    `json:"namespace"`
	Object    string    `json:"object"`
	Reason    string    `json:"reason"`
	Message   string    `json:"message"`
	Count     int       `json:"count,omitempty"`
	Source    string    `json:"source,omitempty"`
}

type podHealthSummary struct {
	Total         int `json:"total"`
	Running       int `json:"running"`
	Pending       int `json:"pending"`
	Failed        int `json:"failed"`
	Succeeded     int `json:"succeeded"`
	CrashLoop     int `json:"crashLoop"`
	TotalRestarts int `json:"totalRestarts"`
	RestartPods   int `json:"restartPods"`
}

type nodeHealthSummary struct {
	Total       int `json:"total"`
	Ready       int `json:"ready"`
	NotReady    int `json:"notReady"`
	MemoryPress int `json:"memoryPressure"`
	DiskPress   int `json:"diskPressure"`
	PIDPress    int `json:"pidPressure"`
}

// HealthIssue describes a specific health problem detected in the cluster.
type HealthIssue struct {
	Severity string `json:"severity"` // "CRITICAL", "WARNING", "INFO"
	Resource string `json:"resource"` // "pod/payment-svc-xxx"
	Message  string `json:"message"`
}

// healthResult is the structured output for `kcli health`.
type healthResult struct {
	Context      string            `json:"context,omitempty"`
	Timestamp    time.Time         `json:"timestamp"`
	Score        int               `json:"score"`
	ApiReachable bool              `json:"apiReachable"`
	Pods         podHealthSummary  `json:"pods"`
	Nodes        nodeHealthSummary `json:"nodes"`
	Issues       []HealthIssue     `json:"issues"`
}

func newMetricsCmd(a *app) *cobra.Command {
	var allNamespaces bool

	cmd := &cobra.Command{
		Use:   "metrics [pods [NAME]|nodes [NAME]]",
		Short: "Resource usage metrics with used/limits",
		Long: `Show resource usage metrics for pods or nodes.

Without arguments, shows a combined summary of both nodes and pods.
Pod metrics show used/limit and utilization percentage.

Examples:
  kcli metrics                    # combined nodes + pods (current namespace)
  kcli metrics pods               # pod metrics in current namespace
  kcli metrics po -A              # pod metrics across all namespaces
  kcli metrics po coredns-abc     # single pod metrics
  kcli metrics nodes              # node metrics
  kcli metrics no ip-10-20-23     # single node metrics`,
		GroupID:   "observability",
		Args:      cobra.MaximumNArgs(2),
		ValidArgs: []string{"pods", "nodes"},
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) >= 1 {
				target := strings.ToLower(strings.TrimSpace(args[0]))
				var podName string
				if len(args) >= 2 {
					podName = args[1]
				}
				switch target {
				case "pods", "pod", "po":
					return printPodMetricsTable(a, cmd, allNamespaces, podName)
				case "nodes", "node", "no":
					return printNodeMetricsTable(a, cmd, podName)
				default:
					return fmt.Errorf("unsupported metrics target %q (use pods|nodes)", args[0])
				}
			}
			// Combined view: nodes then current-namespace pods
			fmt.Fprintln(cmd.OutOrStdout(), output.GetTheme().Header.Render("── Node Metrics ──"))
			if err := printNodeMetricsTable(a, cmd, ""); err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "Warning: could not fetch node metrics: %v\n", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "\n"+output.GetTheme().Header.Render("── Pod Metrics (top by CPU) ──"))
			return printPodMetricsTable(a, cmd, allNamespaces, "")
		},
	}
	cmd.Flags().BoolVarP(&allNamespaces, "all-namespaces", "A", false, "show pods across all namespaces")
	return cmd
}

// printNodeMetricsTable captures kubectl top nodes output and renders it as an enhanced table.
func printNodeMetricsTable(a *app, cmd *cobra.Command, nodeName string) error {
	topArgs := []string{"top", "nodes", "--no-headers"}
	if nodeName != "" {
		topArgs = append(topArgs, nodeName)
	}
	raw, err := a.captureKubectl(topArgs)
	if err != nil {
		return fmt.Errorf("failed to fetch node metrics: %w", err)
	}

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 45, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Primary }})
	table.AddColumn(output.Column{Name: "CPU", Priority: output.PriorityCritical, MinWidth: 8, MaxWidth: 12, Align: output.Right,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Warning }})
	table.AddColumn(output.Column{Name: "CPU%", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right,
		ColorFunc: metricsPercentColorFunc()})
	table.AddColumn(output.Column{Name: "MEMORY", Priority: output.PriorityCritical, MinWidth: 10, MaxWidth: 14, Align: output.Right,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Warning }})
	table.AddColumn(output.Column{Name: "MEM%", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right,
		ColorFunc: metricsPercentColorFunc()})

	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 5 {
			table.AddRow(fields[:5])
		}
	}

	table.Print()
	return nil
}

// printPodMetricsTable captures kubectl top pods output and enriches it with
// resource requests/limits from the pod spec for a complete utilization view.
func printPodMetricsTable(a *app, cmd *cobra.Command, allNamespaces bool, podName string) error {
	// Build kubectl top args
	topArgs := []string{"top", "pods", "--sort-by=cpu", "--no-headers"}
	if allNamespaces {
		topArgs = append(topArgs, "-A")
	}
	if podName != "" {
		topArgs = append(topArgs, podName)
	}

	raw, err := a.captureKubectl(topArgs)
	if err != nil {
		return fmt.Errorf("failed to fetch pod metrics: %w", err)
	}

	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.HasPrefix(trimmed, "No resources") || strings.HasPrefix(trimmed, "error:") {
		fmt.Fprintln(cmd.OutOrStdout(), "No pod metrics found.")
		return nil
	}

	// Determine namespace for pod spec lookup
	ns := ""
	if allNamespaces {
		ns = "" // all namespaces
	}

	// Fetch pod specs for requests/limits
	bundle, err := k8sclient.NewBundle(a.kubeconfig, a.context)
	if err != nil {
		return printPodMetricsSimple(raw, allNamespaces)
	}

	podList, err := bundle.Clientset.CoreV1().Pods(ns).List(cmd.Context(), metav1.ListOptions{})
	if err != nil {
		return printPodMetricsSimple(raw, allNamespaces)
	}

	// Build lookup: namespace/name → aggregated requests & limits
	type podResources struct {
		cpuReq, cpuLim     int64 // millicores
		memReq, memLim     int64 // bytes
	}
	podRes := make(map[string]*podResources)
	for _, pod := range podList.Items {
		key := pod.Namespace + "/" + pod.Name
		r := &podResources{}
		for _, c := range pod.Spec.Containers {
			if req, ok := c.Resources.Requests[corev1.ResourceCPU]; ok {
				r.cpuReq += req.MilliValue()
			}
			if lim, ok := c.Resources.Limits[corev1.ResourceCPU]; ok {
				r.cpuLim += lim.MilliValue()
			}
			if req, ok := c.Resources.Requests[corev1.ResourceMemory]; ok {
				r.memReq += req.Value()
			}
			if lim, ok := c.Resources.Limits[corev1.ResourceMemory]; ok {
				r.memLim += lim.Value()
			}
		}
		podRes[key] = r
	}

	// Build table — include NAMESPACE column only with -A
	var table *output.Table
	if allNamespaces {
		table = output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
		table.AddNameColumn()
	} else {
		table = output.NewTable()
		table.Style = output.Rounded
		table.AutoNumber = true
		table.AddColumn(output.Column{Name: "#", Priority: output.PriorityAlways, MinWidth: 3, MaxWidth: 5, Align: output.Right,
			ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }})
		table.NameColIdx = 1
		table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 55, Align: output.Left,
			ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Primary }})
	}
	table.AddColumn(output.Column{Name: "CPU", Priority: output.PriorityCritical, MinWidth: 12, MaxWidth: 18, Align: output.Right,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Warning }})
	table.AddColumn(output.Column{Name: "CPU%", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right,
		ColorFunc: metricsPercentColorFunc()})
	table.AddColumn(output.Column{Name: "MEMORY", Priority: output.PriorityCritical, MinWidth: 10, MaxWidth: 20, Align: output.Right,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Warning }})
	table.AddColumn(output.Column{Name: "MEM%", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right,
		ColorFunc: metricsPercentColorFunc()})

	// Resolve the effective namespace for pod spec lookup key
	effectiveNS := a.namespace
	if effectiveNS == "" {
		effectiveNS = "default"
		// Try to read the namespace from kubeconfig context
		if bundle != nil {
			if ctx, ok := bundle.RawConfig.Contexts[bundle.EffectiveContext]; ok && ctx.Namespace != "" {
				effectiveNS = ctx.Namespace
			}
		}
	}

	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		fields := strings.Fields(line)

		var ns, name, cpuUsed, memUsed string
		if allNamespaces {
			// -A format: NAMESPACE NAME CPU MEMORY
			if len(fields) < 4 {
				continue
			}
			ns, name, cpuUsed, memUsed = fields[0], fields[1], fields[2], fields[3]
		} else {
			// Single-namespace format: NAME CPU MEMORY
			if len(fields) < 3 {
				continue
			}
			ns = effectiveNS
			name, cpuUsed, memUsed = fields[0], fields[1], fields[2]
		}
		key := ns + "/" + name

		// Format CPU as "used/limit" (e.g. "11m/200m")
		cpuStr := cpuUsed
		cpuPct := "—"
		memStr := memUsed
		memPct := "—"

		if r, ok := podRes[key]; ok {
			if r.cpuLim > 0 {
				cpuStr = fmt.Sprintf("%s/%s", cpuUsed, formatMillicores(r.cpuLim))
				usedM := parseMillicores(cpuUsed)
				if usedM > 0 {
					cpuPct = fmt.Sprintf("%d%%", usedM*100/r.cpuLim)
				}
			} else if r.cpuReq > 0 {
				cpuStr = fmt.Sprintf("%s/%s", cpuUsed, formatMillicores(r.cpuReq))
			}
			if r.memLim > 0 {
				memStr = fmt.Sprintf("%s/%s", memUsed, formatBytes(r.memLim))
				usedB := parseMiBytes(memUsed)
				if usedB > 0 {
					memPct = fmt.Sprintf("%d%%", usedB*100/r.memLim)
				}
			} else if r.memReq > 0 {
				memStr = fmt.Sprintf("%s/%s", memUsed, formatBytes(r.memReq))
			}
		}

		if allNamespaces {
			table.AddRow([]string{ns, name, cpuStr, cpuPct, memStr, memPct})
		} else {
			table.AddRow([]string{name, cpuStr, cpuPct, memStr, memPct})
		}
	}

	table.Print()
	return nil
}

// printPodMetricsSimple renders metrics without limits (fallback when client-go unavailable).
func printPodMetricsSimple(raw string, allNamespaces bool) error {
	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "CPU", Priority: output.PriorityCritical, MinWidth: 8, MaxWidth: 12, Align: output.Right,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Warning }})
	table.AddColumn(output.Column{Name: "MEMORY", Priority: output.PriorityCritical, MinWidth: 10, MaxWidth: 14, Align: output.Right,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Warning }})

	minFields := 3
	if allNamespaces {
		minFields = 4
	}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= minFields {
			if allNamespaces {
				table.AddRow(fields[:4])
			} else {
				table.AddRow(fields[:3])
			}
		}
	}

	table.Print()
	return nil
}

// parseMillicores parses "42m" → 42, "1" → 1000.
func parseMillicores(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	if strings.HasSuffix(s, "m") {
		v, err := strconv.ParseInt(strings.TrimSuffix(s, "m"), 10, 64)
		if err != nil {
			return 0
		}
		return v
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return v * 1000
}

// formatMillicores formats millicores: 250 → "250m", 1000 → "1".
func formatMillicores(m int64) string {
	if m >= 1000 && m%1000 == 0 {
		return fmt.Sprintf("%d", m/1000)
	}
	return fmt.Sprintf("%dm", m)
}

// parseMiBytes parses "128Mi" → bytes.
func parseMiBytes(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	type suffix struct {
		s string
		m int64
	}
	for _, sfx := range []suffix{
		{"Gi", 1024 * 1024 * 1024},
		{"Mi", 1024 * 1024},
		{"Ki", 1024},
	} {
		if strings.HasSuffix(s, sfx.s) {
			v, err := strconv.ParseInt(strings.TrimSuffix(s, sfx.s), 10, 64)
			if err != nil {
				return 0
			}
			return v * sfx.m
		}
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return v
}

// formatBytes formats bytes to human-readable: Mi, Gi.
func formatBytes(b int64) string {
	if b >= 1024*1024*1024 {
		return fmt.Sprintf("%dGi", b/(1024*1024*1024))
	}
	return fmt.Sprintf("%dMi", b/(1024*1024))
}

// metricsPercentColorFunc colors percentage values — green <50%, yellow 50-80%, red >80%.
func metricsPercentColorFunc() func(string) lipgloss.Style {
	return func(value string) lipgloss.Style {
		v := strings.TrimSuffix(value, "%")
		var n int
		fmt.Sscanf(v, "%d", &n)
		switch {
		case n >= 80:
			return output.GetTheme().Error
		case n >= 50:
			return output.GetTheme().Warning
		default:
			return output.GetTheme().StatusReady
		}
	}
}

func newHealthCmd(a *app) *cobra.Command {
	var outputFlag string
	cmd := &cobra.Command{
		Use:   "health [pods|nodes]",
		Short: "Cluster and resource health summary",
		Long: `Show an overall health score for the cluster, or drill into pod/node health.

Without arguments, computes a 0-100 health score based on node readiness,
pod phases, CrashLoopBackOff counts, and pressure conditions.

Note: health always checks all namespaces for a complete cluster view.

Examples:
  kcli health              # overall cluster health score + issues
  kcli health pods         # pod-specific health summary
  kcli health nodes        # node-specific health summary
  kcli health -o json      # machine-readable JSON output`,
		GroupID: "observability",
		Args:      cobra.MaximumNArgs(1),
		ValidArgs: []string{"pods", "nodes"},
		RunE: func(cmd *cobra.Command, args []string) error {
			ofmt, err := output.ParseFlag(outputFlag)
			if err != nil {
				return err
			}
			if len(args) == 0 {
				return printOverallHealth(a, cmd, ofmt)
			}
			switch strings.ToLower(strings.TrimSpace(args[0])) {
			case "pods", "pod":
				s, err := fetchPodHealthSummary(cmd.Context(), a)
				if err != nil {
					return err
				}
				if ofmt == output.FormatJSON || ofmt == output.FormatYAML {
					return output.Render(cmd.OutOrStdout(), ofmt, s)
				}
				printPodHealthSummary(cmd, s)
				return nil
			case "nodes", "node":
				s, err := fetchNodeHealthSummary(cmd.Context(), a)
				if err != nil {
					return err
				}
				if ofmt == output.FormatJSON || ofmt == output.FormatYAML {
					return output.Render(cmd.OutOrStdout(), ofmt, s)
				}
				printNodeHealthSummary(cmd, s)
				return nil
			default:
				return fmt.Errorf("unsupported health target %q (use pods|nodes)", args[0])
			}
		},
	}
	cmd.Flags().StringVarP(&outputFlag, "output", "o", "table", "output format: table|json|yaml")
	return cmd
}

func printOverallHealth(a *app, cmd *cobra.Command, ofmt output.Format) error {
	// Parallel data collection.
	var (
		pods    podHealthSummary
		nodes   nodeHealthSummary
		podErr  error
		nodeErr error
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); pods, podErr = fetchPodHealthSummary(cmd.Context(), a) }()
	go func() { defer wg.Done(); nodes, nodeErr = fetchNodeHealthSummary(cmd.Context(), a) }()
	wg.Wait()
	if podErr != nil {
		return podErr
	}
	if nodeErr != nil {
		return nodeErr
	}

	score := healthScore(pods, nodes)
	apiReachable := true
	if pods.Total == 0 && nodes.Total == 0 {
		apiReachable = false
		score = -1
	}
	issues := collectHealthIssues(cmd.Context(), a, pods, nodes)
	result := healthResult{
		Context:      a.context,
		Timestamp:    time.Now().UTC(),
		Score:        score,
		ApiReachable: apiReachable,
		Pods:         pods,
		Nodes:        nodes,
		Issues:       issues,
	}

	if ofmt == output.FormatJSON || ofmt == output.FormatYAML {
		return output.Render(cmd.OutOrStdout(), ofmt, result)
	}

	w := cmd.OutOrStdout()
	var label string
	if score < 0 {
		label = "UNKNOWN (no data)"
	} else if score < 50 {
		label = "UNHEALTHY"
	} else if score < 80 {
		label = "DEGRADED"
	} else {
		label = "HEALTHY"
	}

	var scoreText string
	if score < 0 {
		scoreText = label
	} else {
		scoreText = fmt.Sprintf("%d/100 (%s)", score, label)
	}

	// Score table
	scoreTable := output.NewTable()
	scoreTable.Style = output.Rounded
	scoreTable.AddColumn(output.Column{Name: "METRIC", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 25, Align: output.Left})
	scoreTable.AddColumn(output.Column{Name: "VALUE", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 30, Align: output.Left})
	scoreTable.AddRow([]string{"Health Score", scoreText})
	scoreTable.PrintTo(w)

	printPodHealthSummary(cmd, pods)
	printNodeHealthSummary(cmd, nodes)

	if len(issues) > 0 {
		fmt.Fprintln(w)
		issueTable := output.NewTable()
		issueTable.Style = output.Rounded
		issueTable.AddColumn(output.Column{Name: "SEVERITY", Priority: output.PriorityCritical, MinWidth: 8, MaxWidth: 12, Align: output.Left, ColorFunc: func(value string) lipgloss.Style {
			theme := output.GetTheme()
			switch value {
			case "CRITICAL":
				return theme.Error
			case "WARNING":
				return theme.Warning
			default:
				return theme.Info
			}
		}})
		issueTable.AddColumn(output.Column{Name: "RESOURCE", Priority: output.PriorityCritical, MinWidth: 15, MaxWidth: 35, Align: output.Left})
		issueTable.AddColumn(output.Column{Name: "MESSAGE", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 60, Align: output.Left})
		for _, iss := range issues {
			issueTable.AddRow([]string{iss.Severity, iss.Resource, iss.Message})
		}
		issueTable.PrintTo(w)
	}
	return nil
}

// collectHealthIssues scans pods for specific problems and returns a list of issues.
func collectHealthIssues(ctx context.Context, a *app, pods podHealthSummary, nodes nodeHealthSummary) []HealthIssue {
	var issues []HealthIssue

	// Node issues
	if nodes.NotReady > 0 {
		issues = append(issues, HealthIssue{
			Severity: "CRITICAL",
			Resource: fmt.Sprintf("%d node(s)", nodes.NotReady),
			Message:  "not ready",
		})
	}
	if nodes.MemoryPress > 0 {
		issues = append(issues, HealthIssue{
			Severity: "WARNING",
			Resource: fmt.Sprintf("%d node(s)", nodes.MemoryPress),
			Message:  "MemoryPressure condition",
		})
	}
	if nodes.DiskPress > 0 {
		issues = append(issues, HealthIssue{
			Severity: "WARNING",
			Resource: fmt.Sprintf("%d node(s)", nodes.DiskPress),
			Message:  "DiskPressure condition",
		})
	}

	// Pod issues
	if pods.CrashLoop > 0 {
		issues = append(issues, HealthIssue{
			Severity: "CRITICAL",
			Resource: fmt.Sprintf("%d pod(s)", pods.CrashLoop),
			Message:  "CrashLoopBackOff",
		})
	}
	if pods.Failed > 0 {
		issues = append(issues, HealthIssue{
			Severity: "WARNING",
			Resource: fmt.Sprintf("%d pod(s)", pods.Failed),
			Message:  "in Failed phase",
		})
	}
	if pods.Pending > 0 {
		issues = append(issues, HealthIssue{
			Severity: "INFO",
			Resource: fmt.Sprintf("%d pod(s)", pods.Pending),
			Message:  "Pending",
		})
	}

	return issues
}

func newRestartsCmd(a *app) *cobra.Command {
	var recent string
	var threshold int
	var outputFlag string
	cmd := &cobra.Command{
		Use:   "restarts",
		Short: "List pods sorted by restart count",
		Long: `List all containers that have restarted, sorted by restart count (descending).

Useful for spotting CrashLoopBackOff pods and recurring OOMKills.

Examples:
  kcli restarts                   # all containers with >= 1 restart
  kcli restarts --threshold 5     # only containers with >= 5 restarts
  kcli restarts --recent 30m      # only restarts in last 30 minutes
  kcli restarts -o json           # machine-readable JSON output`,
		GroupID: "observability",
		RunE: func(c *cobra.Command, _ []string) error {
			ofmt, err := output.ParseFlag(outputFlag)
			if err != nil {
				return err
			}
			pods, err := fetchPods(c.Context(), a)
			if err != nil {
				return err
			}
			cutoff := time.Time{}
			if strings.TrimSpace(recent) != "" {
				d, err := time.ParseDuration(strings.TrimSpace(recent))
				if err != nil {
					return fmt.Errorf("invalid --recent value %q: %w", recent, err)
				}
				cutoff = time.Now().Add(-d)
			}
			records := buildRestartRecords(pods, threshold, cutoff)
			sort.SliceStable(records, func(i, j int) bool { return records[i].Restarts > records[j].Restarts })
			return output.Render(c.OutOrStdout(), ofmt, records, output.WithTable(func(w io.Writer, v any) error {
				printRestartTableTo(w, v.([]restartRecord))
				return nil
			}))
		},
	}
	cmd.Flags().StringVar(&recent, "recent", "", "only include pods with recent restarts in this window (e.g. 1h)")
	cmd.Flags().IntVar(&threshold, "threshold", 1, "minimum restart count to include")
	cmd.Flags().StringVarP(&outputFlag, "output", "o", "table", "output format: table|json|yaml")
	return cmd
}

type restartRecord struct {
	Namespace string    `json:"namespace"`
	Name      string    `json:"name"`
	Container string    `json:"container,omitempty"`
	Node      string    `json:"node"`
	Phase     string    `json:"phase"`
	Restarts  int       `json:"restarts"`
	LastAt    time.Time `json:"lastRestartTime,omitempty"`
	Reason    string    `json:"reason,omitempty"`
	ExitCode  int       `json:"exitCode,omitempty"`
}

func buildRestartRecords(list *k8sPodList, threshold int, cutoff time.Time) []restartRecord {
	if list == nil {
		return nil
	}
	if threshold <= 0 {
		threshold = 1
	}
	out := make([]restartRecord, 0, len(list.Items))
	for _, p := range list.Items {
		for _, cs := range p.Status.ContainerStatuses {
			if cs.RestartCount < threshold {
				continue
			}
			last := parseRFC3339(cs.LastState.Terminated.FinishedAt)
			if !cutoff.IsZero() && !last.IsZero() && last.Before(cutoff) {
				continue
			}
			reason := cs.LastState.Terminated.Reason
			exitCode := cs.LastState.Terminated.ExitCode
			if reason == "" {
				reason = cs.State.Waiting.Reason // e.g. CrashLoopBackOff
			}
			out = append(out, restartRecord{
				Namespace: p.Metadata.Namespace,
				Name:      p.Metadata.Name,
				Container: cs.Name,
				Node:      p.Spec.NodeName,
				Phase:     p.Status.Phase,
				Restarts:  cs.RestartCount,
				LastAt:    last,
				Reason:    reason,
				ExitCode:  exitCode,
			})
		}
	}
	return out
}

func printRestartTable(cmd *cobra.Command, records []restartRecord) {
	printRestartTableTo(cmd.OutOrStdout(), records)
}

func printRestartTableTo(w io.Writer, records []restartRecord) {
	if len(records) == 0 {
		fmt.Fprintln(w, "No restarted pods found.")
		return
	}
	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn("POD")
	table.AddColumn(output.Column{
		Name:     "CONTAINER",
		Priority: output.PrioritySecondary,
		MinWidth: 10,
		MaxWidth: 25,
		Align:    output.Left,
	})
	table.AddColumn(output.Column{
		Name:      "COUNT",
		Priority:  output.PriorityCritical,
		MinWidth:  5,
		MaxWidth:  10,
		Align:     output.Right,
		ColorFunc: output.RestartColorFunc(),
	})
	table.AddColumn(output.Column{
		Name:      "REASON",
		Priority:  output.PrioritySecondary,
		MinWidth:  10,
		MaxWidth:  25,
		Align:     output.Left,
		ColorFunc: output.StatusColorFunc("pod"),
	})
	table.AddColumn(output.Column{
		Name:     "LAST RESTART",
		Priority: output.PrioritySecondary,
		MinWidth: 12,
		MaxWidth: 22,
		Align:    output.Left,
	})
	for _, r := range records {
		last := "-"
		if !r.LastAt.IsZero() {
			last = r.LastAt.Format("2006-01-02 15:04:05")
		}
		table.AddRow([]string{
			r.Namespace,
			r.Name,
			emptyDash(r.Container),
			fmt.Sprintf("%d", r.Restarts),
			emptyDash(r.Reason),
			last,
		})
	}
	table.PrintTo(w)
}

func newInstabilityCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "instability",
		Short: "Quick instability snapshot (restarts + warning events)",
		Long: `Show a combined instability snapshot: restart leaders and recent warning events.

This is a convenience command that combines 'kcli restarts' and 'kcli events --type=Warning'
into a single view for rapid triage.

Note: instability always checks all namespaces for a complete cluster view.

Examples:
  kcli instability          # restart leaders + recent warning events
  kcli instability pods     # pod-only instability (restart leaders only)`,
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), output.GetTheme().Header.Render("── Restart Leaders ──"))
			pods, err := fetchPods(cmd.Context(), a)
			if err != nil {
				return err
			}
			printRestartTable(cmd, buildRestartRecords(pods, 1, time.Time{}))

			fmt.Fprintln(cmd.OutOrStdout(), "\n"+output.GetTheme().Header.Render("── Recent Warning Events ──"))
			records, err := fetchEvents(cmd.Context(), a)
			if err != nil {
				return err
			}
			warnings := filterEventsByType(records, "Warning")
			sort.SliceStable(warnings, func(i, j int) bool { return warnings[i].Timestamp.After(warnings[j].Timestamp) })
			if len(warnings) > 25 {
				warnings = warnings[:25]
			}
			printEventTable(cmd, warnings)
			return nil
		},
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "pods",
		Short: "Pod-only instability summary (restart leaders)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			pods, err := fetchPods(cmd.Context(), a)
			if err != nil {
				return err
			}
			records := buildRestartRecords(pods, 1, time.Time{})
			sort.SliceStable(records, func(i, j int) bool { return records[i].Restarts > records[j].Restarts })
			printRestartTable(cmd, records)
			return nil
		},
	})
	return cmd
}

func newEventsCmd(a *app) *cobra.Command {
	var recent string
	var outputFlag string
	var includeAll bool
	var evType string
	var resource string
	var sortOrder string
	var watch bool
	cmd := &cobra.Command{
		Use:   "events",
		Short: "View cluster events",
		Long: `View Kubernetes cluster events with filtering, sorting, and watch support.

By default, shows events from the last hour. Use --all to remove the time filter.

Note: events always fetches across all namespaces; the -n flag has no effect here.

Examples:
  kcli events                          # events from last hour (newest first)
  kcli events --type=Warning           # only warning events
  kcli events --recent=30m             # events from last 30 minutes
  kcli events --watch                  # live-stream events (wraps kubectl --watch)
  kcli events --resource pod/nginx     # events for a specific resource
  kcli events --all                    # all events, no time filter
  kcli events --sort=oldest            # oldest events first
  kcli events -o json                  # machine-readable JSON output`,
		GroupID: "observability",
		RunE: func(c *cobra.Command, _ []string) error {
			if watch {
				args := []string{"get", "events", "-A", "--watch"}
				if strings.TrimSpace(evType) != "" {
					args = append(args, "--field-selector", "type="+strings.TrimSpace(evType))
				}
				return a.runKubectl(args)
			}
			ofmt, err := output.ParseFlag(outputFlag)
			if err != nil {
				return err
			}
			records, err := fetchEvents(c.Context(), a)
			if err != nil {
				return err
			}
			if !includeAll {
				window := 1 * time.Hour
				if strings.TrimSpace(recent) != "" {
					d, err := time.ParseDuration(strings.TrimSpace(recent))
					if err != nil {
						return fmt.Errorf("invalid --recent value %q: %w", recent, err)
					}
					window = d
				}
				records = filterEventsByRecent(records, window, time.Now())
			}
			if strings.TrimSpace(evType) != "" {
				records = filterEventsByType(records, evType)
			}
			if strings.TrimSpace(resource) != "" {
				records = filterEventsByResource(records, resource)
			}
			// Sort: newest first by default, oldest first if --sort=oldest
			if strings.EqualFold(strings.TrimSpace(sortOrder), "oldest") {
				sort.SliceStable(records, func(i, j int) bool { return records[i].Timestamp.Before(records[j].Timestamp) })
			} else {
				sort.SliceStable(records, func(i, j int) bool { return records[i].Timestamp.After(records[j].Timestamp) })
			}
			return output.Render(c.OutOrStdout(), ofmt, records, output.WithTable(func(w io.Writer, v any) error {
				printEventTableTo(w, v.([]eventRecord))
				return nil
			}))
		},
	}
	cmd.Flags().StringVar(&recent, "recent", "", "only show events within this duration window (e.g. 30m, 2h); defaults to 1h unless --all")
	cmd.Flags().StringVarP(&outputFlag, "output", "o", "table", "output format: table|json|yaml")
	cmd.Flags().BoolVar(&includeAll, "all", false, "show all events without recent time filter")
	cmd.Flags().StringVar(&evType, "type", "", "event type filter (e.g. Warning, Normal)")
	cmd.Flags().StringVar(&resource, "resource", "", "filter by involved object (e.g. pod/nginx, deployment/api-gateway)")
	cmd.Flags().StringVar(&sortOrder, "sort", "newest", "sort order: newest|oldest")
	cmd.Flags().BoolVarP(&watch, "watch", "w", false, "watch events stream")
	return cmd
}

func fetchPodHealthSummary(ctx context.Context, a *app) (podHealthSummary, error) {
	list, err := fetchPods(ctx, a)
	if err != nil {
		return podHealthSummary{}, err
	}
	s := podHealthSummary{Total: len(list.Items)}
	for _, p := range list.Items {
		switch strings.ToLower(strings.TrimSpace(p.Status.Phase)) {
		case "running":
			s.Running++
		case "pending":
			s.Pending++
		case "failed":
			s.Failed++
		case "succeeded":
			s.Succeeded++
		}
		totalRestarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			totalRestarts += cs.RestartCount
			if strings.EqualFold(cs.State.Waiting.Reason, "CrashLoopBackOff") {
				s.CrashLoop++
			}
		}
		s.TotalRestarts += totalRestarts
		if totalRestarts > 0 {
			s.RestartPods++
		}
	}
	return s, nil
}

func fetchNodeHealthSummary(ctx context.Context, a *app) (nodeHealthSummary, error) {
	list, err := fetchNodes(ctx, a)
	if err != nil {
		return nodeHealthSummary{}, err
	}
	s := nodeHealthSummary{Total: len(list.Items)}
	for _, n := range list.Items {
		ready := false
		for _, c := range n.Status.Conditions {
			t := strings.TrimSpace(c.Type)
			st := strings.EqualFold(strings.TrimSpace(c.Status), "True")
			switch t {
			case "Ready":
				ready = st
			case "MemoryPressure":
				if st {
					s.MemoryPress++
				}
			case "DiskPressure":
				if st {
					s.DiskPress++
				}
			case "PIDPressure":
				if st {
					s.PIDPress++
				}
			}
		}
		if ready {
			s.Ready++
		} else {
			s.NotReady++
		}
	}
	return s, nil
}

func healthScore(pods podHealthSummary, nodes nodeHealthSummary) int {
	score := 100

	// Subtract 5 per not-ready node (max -30)
	score -= minInt(30, nodes.NotReady*5)

	// Subtract 3 per CrashLoopBackOff pod (max -20)
	score -= minInt(20, pods.CrashLoop*3)

	// Subtract 1 per Pending pod (max -10)
	score -= minInt(10, pods.Pending)

	// Subtract 2 per Failed pod (max -10)
	score -= minInt(10, pods.Failed*2)

	// Subtract 2 per node with MemoryPressure (max -10)
	score -= minInt(10, nodes.MemoryPress*2)

	// Subtract 2 per node with DiskPressure (max -10)
	score -= minInt(10, nodes.DiskPress*2)

	// Subtract 1 per node with PIDPressure (max -5)
	score -= minInt(5, nodes.PIDPress)

	// Subtract 1 per restarting pod (max -10)
	score -= minInt(10, pods.RestartPods)

	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func printPodHealthSummary(cmd *cobra.Command, s podHealthSummary) {
	w := cmd.OutOrStdout()
	fmt.Fprintln(w)
	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "POD METRIC", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 25, Align: output.Left})
	table.AddColumn(output.Column{Name: "VALUE", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 15, Align: output.Right})
	table.AddRow([]string{"Total", fmt.Sprintf("%d", s.Total)})
	table.AddRow([]string{"Running", fmt.Sprintf("%d", s.Running)})
	table.AddRow([]string{"Pending", fmt.Sprintf("%d", s.Pending)})
	table.AddRow([]string{"Failed", fmt.Sprintf("%d", s.Failed)})
	table.AddRow([]string{"Succeeded", fmt.Sprintf("%d", s.Succeeded)})
	table.AddRow([]string{"Restart Pods", fmt.Sprintf("%d", s.RestartPods)})
	table.AddRow([]string{"Total Restarts", fmt.Sprintf("%d", s.TotalRestarts)})
	table.AddRow([]string{"CrashLoop", fmt.Sprintf("%d", s.CrashLoop)})
	table.PrintTo(w)
}

func printNodeHealthSummary(cmd *cobra.Command, s nodeHealthSummary) {
	w := cmd.OutOrStdout()
	fmt.Fprintln(w)
	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "NODE METRIC", Priority: output.PriorityAlways, MinWidth: 18, MaxWidth: 25, Align: output.Left})
	table.AddColumn(output.Column{Name: "VALUE", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 15, Align: output.Right})
	table.AddRow([]string{"Total", fmt.Sprintf("%d", s.Total)})
	table.AddRow([]string{"Ready", fmt.Sprintf("%d", s.Ready)})
	table.AddRow([]string{"Not Ready", fmt.Sprintf("%d", s.NotReady)})
	table.AddRow([]string{"Memory Pressure", fmt.Sprintf("%d", s.MemoryPress)})
	table.AddRow([]string{"Disk Pressure", fmt.Sprintf("%d", s.DiskPress)})
	table.AddRow([]string{"PID Pressure", fmt.Sprintf("%d", s.PIDPress)})
	table.PrintTo(w)
}

func fetchEvents(ctx context.Context, a *app) ([]eventRecord, error) {
	out, err := a.captureKubectlCtx(ctx, []string{"get", "events", "-A", "-o", "json"})
	if err != nil {
		return nil, err
	}
	var list k8sEventList
	if err := json.Unmarshal([]byte(out), &list); err != nil {
		return nil, fmt.Errorf("failed to parse events JSON: %w", err)
	}
	records := make([]eventRecord, 0, len(list.Items))
	for _, item := range list.Items {
		ts := parseEventTime(item)
		ns := strings.TrimSpace(item.InvolvedObject.Namespace)
		if ns == "" {
			ns = strings.TrimSpace(item.Metadata.Namespace)
		}
		obj := strings.TrimSpace(item.InvolvedObject.Kind + "/" + item.InvolvedObject.Name)
		if obj == "/" {
			obj = "-"
		}
		source := strings.TrimSpace(item.Source.Component)
		records = append(records, eventRecord{
			Timestamp: ts,
			Type:      strings.TrimSpace(item.Type),
			Namespace: ns,
			Object:    obj,
			Reason:    strings.TrimSpace(item.Reason),
			Message:   strings.TrimSpace(item.Message),
			Count:     item.Count,
			Source:    source,
		})
	}
	return records, nil
}

func parseEventTime(e k8sEvent) time.Time {
	candidates := []string{e.LastTimestamp, e.EventTime, e.FirstTimestamp, e.Metadata.CreationTimestamp}
	for _, raw := range candidates {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			return t
		}
	}
	return time.Time{}
}

func filterEventsByRecent(records []eventRecord, window time.Duration, now time.Time) []eventRecord {
	if window <= 0 {
		return records
	}
	cutoff := now.Add(-window)
	out := make([]eventRecord, 0, len(records))
	for _, r := range records {
		if !r.Timestamp.IsZero() && r.Timestamp.Before(cutoff) {
			continue
		}
		out = append(out, r)
	}
	return out
}

func filterEventsByType(records []eventRecord, evType string) []eventRecord {
	t := strings.ToLower(strings.TrimSpace(evType))
	if t == "" {
		return records
	}
	out := make([]eventRecord, 0, len(records))
	for _, r := range records {
		if strings.EqualFold(strings.TrimSpace(r.Type), t) {
			out = append(out, r)
		}
	}
	return out
}

func filterEventsByResource(records []eventRecord, resource string) []eventRecord {
	resource = strings.ToLower(strings.TrimSpace(resource))
	if resource == "" {
		return records
	}
	out := make([]eventRecord, 0, len(records))
	for _, r := range records {
		if strings.EqualFold(r.Object, resource) || strings.Contains(strings.ToLower(r.Object), resource) {
			out = append(out, r)
		}
	}
	return out
}

func parseRFC3339(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, raw)
	return t
}

func printEventTable(cmd *cobra.Command, records []eventRecord) {
	printEventTableTo(cmd.OutOrStdout(), records)
}

func printEventTableTo(w io.Writer, records []eventRecord) {
	if len(records) == 0 {
		fmt.Fprintln(w, "No events found.")
		return
	}
	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddColumn(output.Column{
		Name:     "TIME",
		Priority: output.PriorityCritical,
		MinWidth: 12,
		MaxWidth: 22,
		Align:    output.Left,
	})
	table.AddColumn(output.Column{
		Name:     "TYPE",
		Priority: output.PriorityCritical,
		MinWidth: 7,
		MaxWidth: 10,
		Align:    output.Left,
		ColorFunc: func(value string) lipgloss.Style {
			return output.EventTypeStyle(value)
		},
	})
	table.AddColumn(output.Column{
		Name:     "OBJECT",
		Priority: output.PriorityCritical,
		MinWidth: 15,
		MaxWidth: 40,
		Align:    output.Left,
	})
	table.AddColumn(output.Column{
		Name:     "REASON",
		Priority: output.PrioritySecondary,
		MinWidth: 10,
		MaxWidth: 25,
		Align:    output.Left,
	})
	table.AddColumn(output.Column{
		Name:     "MESSAGE",
		Priority: output.PriorityExtended,
		MinWidth: 20,
		MaxWidth: 80,
		Align:    output.Left,
	})
	for _, r := range records {
		ts := "-"
		if !r.Timestamp.IsZero() {
			ts = r.Timestamp.Format("2006-01-02 15:04:05")
		}
		msg := r.Message
		if len(msg) > 120 {
			msg = msg[:117] + "..."
		}
		table.AddRow([]string{
			r.Namespace,
			ts,
			emptyDash(r.Type),
			r.Object,
			emptyDash(r.Reason),
			msg,
		})
	}
	table.PrintTo(w)
}

func truncateCell(v string, limit int) string {
	if len(v) <= limit {
		return emptyDash(v)
	}
	if limit <= 3 {
		return v[:limit]
	}
	return v[:limit-3] + "..."
}

func emptyDash(v string) string {
	if strings.TrimSpace(v) == "" {
		return "-"
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
