package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kcli/internal/output"
	"github.com/spf13/cobra"
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
	Context   string            `json:"context,omitempty"`
	Timestamp time.Time         `json:"timestamp"`
	Score     int               `json:"score"`
	Pods      podHealthSummary  `json:"pods"`
	Nodes     nodeHealthSummary `json:"nodes"`
	Issues    []HealthIssue     `json:"issues"`
}

func newMetricsCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "metrics [pods|nodes]",
		Short: "Resource usage metrics (wraps kubectl top)",
		Long: `Show resource usage metrics for pods or nodes.

Without arguments, shows a combined summary of both nodes and pods.
Use 'pods' or 'nodes' subcommand for specific view.

Examples:
  kcli metrics                # combined nodes + pods overview
  kcli metrics pods           # pod metrics, sorted by CPU
  kcli metrics nodes          # node metrics`,
		GroupID:   "observability",
		Args:      cobra.MaximumNArgs(1),
		ValidArgs: []string{"pods", "nodes"},
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				target := strings.ToLower(strings.TrimSpace(args[0]))
				switch target {
				case "pods", "pod":
					return a.runKubectl([]string{"top", "pods", "-A", "--sort-by=cpu"})
				case "nodes", "node":
					return a.runKubectl([]string{"top", "nodes"})
				default:
					return fmt.Errorf("unsupported metrics target %q (use pods|nodes)", args[0])
				}
			}
			// Combined view: nodes then pods
			fmt.Fprintln(cmd.OutOrStdout(), "=== Node Metrics ===")
			if err := a.runKubectl([]string{"top", "nodes"}); err != nil {
				fmt.Fprintf(cmd.ErrOrStderr(), "Warning: could not fetch node metrics: %v\n", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "\n=== Pod Metrics (top by CPU) ===")
			return a.runKubectl([]string{"top", "pods", "-A", "--sort-by=cpu"})
		},
	}
	return cmd
}

func newHealthCmd(a *app) *cobra.Command {
	var outputFlag string
	cmd := &cobra.Command{
		Use:       "health [pods|nodes]",
		Short:     "Cluster and resource health summary",
		GroupID:   "observability",
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
	issues := collectHealthIssues(cmd.Context(), a, pods, nodes)
	result := healthResult{
		Context:   a.context,
		Timestamp: time.Now().UTC(),
		Score:     score,
		Pods:      pods,
		Nodes:     nodes,
		Issues:    issues,
	}

	if ofmt == output.FormatJSON || ofmt == output.FormatYAML {
		return output.Render(cmd.OutOrStdout(), ofmt, result)
	}

	w := cmd.OutOrStdout()
	label := "HEALTHY"
	if score < 80 {
		label = "DEGRADED"
	}
	if score < 50 {
		label = "UNHEALTHY"
	}
	fmt.Fprintf(w, "Health Score: %d/100 (%s)\n", score, label)
	printPodHealthSummary(cmd, pods)
	printNodeHealthSummary(cmd, nodes)

	if len(issues) > 0 {
		fmt.Fprintln(w, "\nIssues:")
		for _, iss := range issues {
			fmt.Fprintf(w, "  [%s] %s: %s\n", iss.Severity, iss.Resource, iss.Message)
		}
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
		Use:     "restarts",
		Short:   "List pods sorted by restart count",
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
	fmt.Fprintf(w, "%-16s %-30s %-18s %-8s %-18s %-20s\n", "NAMESPACE", "POD", "CONTAINER", "COUNT", "REASON", "LAST RESTART")
	for _, r := range records {
		last := "-"
		if !r.LastAt.IsZero() {
			last = r.LastAt.Format("2006-01-02 15:04:05")
		}
		reason := emptyDash(r.Reason)
		fmt.Fprintf(w, "%-16s %-30s %-18s %-8d %-18s %-20s\n",
			truncateCell(r.Namespace, 16),
			truncateCell(r.Name, 30),
			truncateCell(r.Container, 18),
			r.Restarts,
			truncateCell(reason, 18),
			last,
		)
	}
}

func newInstabilityCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "instability",
		Short:   "Quick instability snapshot (restarts + warning events)",
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), "== Restart Leaders ==")
			pods, err := fetchPods(cmd.Context(), a)
			if err != nil {
				return err
			}
			printRestartTable(cmd, buildRestartRecords(pods, 1, time.Time{}))

			fmt.Fprintln(cmd.OutOrStdout(), "\n== Recent Warning Events ==")
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
		Use:     "events",
		Short:   "View cluster events",
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
	fmt.Fprintln(cmd.OutOrStdout(), "\nPods:")
	fmt.Fprintf(cmd.OutOrStdout(), "  total=%d running=%d pending=%d failed=%d succeeded=%d\n", s.Total, s.Running, s.Pending, s.Failed, s.Succeeded)
	fmt.Fprintf(cmd.OutOrStdout(), "  restartPods=%d totalRestarts=%d crashLoop=%d\n", s.RestartPods, s.TotalRestarts, s.CrashLoop)
}

func printNodeHealthSummary(cmd *cobra.Command, s nodeHealthSummary) {
	fmt.Fprintln(cmd.OutOrStdout(), "\nNodes:")
	fmt.Fprintf(cmd.OutOrStdout(), "  total=%d ready=%d notReady=%d\n", s.Total, s.Ready, s.NotReady)
	fmt.Fprintf(cmd.OutOrStdout(), "  pressure(memory=%d disk=%d pid=%d)\n", s.MemoryPress, s.DiskPress, s.PIDPress)
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
	fmt.Fprintf(w, "%-20s %-8s %-18s %-30s %-18s %s\n", "TIME", "TYPE", "NAMESPACE", "OBJECT", "REASON", "MESSAGE")
	for _, r := range records {
		ts := "-"
		if !r.Timestamp.IsZero() {
			ts = r.Timestamp.Format("2006-01-02 15:04:05")
		}
		msg := r.Message
		if len(msg) > 120 {
			msg = msg[:117] + "..."
		}
		fmt.Fprintf(
			w,
			"%-20s %-8s %-18s %-30s %-18s %s\n",
			ts,
			emptyDash(r.Type),
			emptyDash(r.Namespace),
			truncateCell(r.Object, 30),
			truncateCell(r.Reason, 18),
			msg,
		)
	}
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
