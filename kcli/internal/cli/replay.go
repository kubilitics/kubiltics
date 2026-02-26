// replay.go — kcli replay: time-travel debug (P3-1).
//
// Reconstructs the state of a resource at a specific point in time using
// Kubernetes event history. Events have firstTimestamp/lastTimestamp; we filter
// to those that occurred at or before the target time and sort chronologically.
//
// Usage:
//   kcli replay pod/crashed-payment --at=2026-02-24T10:00:00Z
//   kcli replay pod/crashed-payment --minutes-ago=30
//   kcli replay deployment/api -n prod --at=2026-02-24T10:00:00Z

package cli

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

type replayEvent struct {
	Timestamp time.Time
	Type      string
	Reason    string
	Message   string
	Count     int
}

func newReplayCmd(a *app) *cobra.Command {
	var atStr string
	var minutesAgo int
	var withProm bool

	cmd := &cobra.Command{
		Use:   "replay (TYPE/NAME | TYPE NAME)",
		Short: "Reconstruct resource state at a point in time from event history",
		Long: `Reconstruct the state of a resource at a specific point in time using Kubernetes event history.

Events have firstTimestamp and lastTimestamp; replay filters to events that occurred
at or before the target time and sorts them chronologically to show the timeline
leading to that state.

Examples:
  kcli replay pod/crashed-payment --at=2026-02-24T10:00:00Z
  kcli replay pod/crashed-payment --minutes-ago=30
  kcli replay deployment/api -n prod --at=2026-02-24T10:00:00Z`,
		GroupID: "observability",
		Args:    cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			resource := args[0]
			if len(args) == 2 {
				resource = args[0] + "/" + args[1]
			}
			kind, name, err := parseResourceRef(resource)
			if err != nil {
				return err
			}

			// Resolve target time
			var target time.Time
			if atStr != "" {
				t, err := time.Parse(time.RFC3339, strings.TrimSpace(atStr))
				if err != nil {
					return fmt.Errorf("invalid --at value %q: %w (use RFC3339, e.g. 2026-02-24T10:00:00Z)", atStr, err)
				}
				target = t
			} else if minutesAgo > 0 {
				target = time.Now().Add(-time.Duration(minutesAgo) * time.Minute)
			} else {
				return fmt.Errorf("specify --at or --minutes-ago")
			}

			events, err := fetchReplayEvents(a, kind, name, target)
			if err != nil {
				return err
			}

			if err := printReplayTimeline(cmd, a, kind, name, target, events); err != nil {
				return err
			}
			if withProm {
				printReplayPrometheus(a, kind, name, target)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&atStr, "at", "", "Target time (RFC3339, e.g. 2026-02-24T10:00:00Z)")
	cmd.Flags().IntVar(&minutesAgo, "minutes-ago", 0, "Target time as N minutes ago")
	cmd.Flags().BoolVar(&withProm, "prom", false, "Include Prometheus metrics at target time (requires Prometheus)")
	return cmd
}

func parseResourceRef(resource string) (kind, name string, err error) {
	resource = strings.TrimSpace(resource)
	if resource == "" {
		return "", "", fmt.Errorf("resource cannot be empty")
	}
	parts := strings.SplitN(resource, "/", 2)
	if len(parts) == 1 {
		return "", "", fmt.Errorf("resource must be TYPE/NAME (e.g. pod/my-pod, deployment/api)")
	}
	kind = strings.TrimSpace(parts[0])
	name = strings.TrimSpace(parts[1])
	if kind == "" || name == "" {
		return "", "", fmt.Errorf("resource must be TYPE/NAME (e.g. pod/my-pod)")
	}
	// Normalize kind to canonical form (Pod, Deployment, etc.)
	lower := strings.ToLower(kind)
	switch lower {
	case "po", "pod", "pods":
		kind = "Pod"
	case "deploy", "deployment", "deployments":
		kind = "Deployment"
	case "rs", "replicaset", "replicasets":
		kind = "ReplicaSet"
	case "svc", "service", "services":
		kind = "Service"
	case "no", "node", "nodes":
		kind = "Node"
	case "ss", "statefulset", "statefulsets":
		kind = "StatefulSet"
	case "ds", "daemonset", "daemonsets":
		kind = "DaemonSet"
	case "job", "jobs":
		kind = "Job"
	case "cj", "cronjob", "cronjobs":
		kind = "CronJob"
	default:
		if len(kind) > 0 {
			kind = strings.ToUpper(kind[:1]) + strings.ToLower(kind[1:])
		}
	}
	return kind, name, nil
}

func fetchReplayEvents(a *app, kind, name string, target time.Time) ([]replayEvent, error) {
	fieldSel := fmt.Sprintf("involvedObject.kind=%s,involvedObject.name=%s", kind, name)
	if a.namespace != "" {
		fieldSel += ",involvedObject.namespace=" + a.namespace
	}
	args := []string{"get", "events", "-o", "json", "--field-selector", fieldSel}
	if a.namespace != "" {
		args = append(args, "-n", a.namespace)
	} else {
		args = append(args, "-A")
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch events: %w", err)
	}

	var list k8sEventList
	if err := json.Unmarshal([]byte(out), &list); err != nil {
		return nil, fmt.Errorf("failed to parse events: %w", err)
	}

	var events []replayEvent
	for _, item := range list.Items {
		ts := parseEventTime(item)
		if ts.IsZero() {
			continue
		}
		// Only include events that occurred at or before the target time
		if !ts.After(target) {
			events = append(events, replayEvent{
				Timestamp: ts,
				Type:      strings.TrimSpace(item.Type),
				Reason:    strings.TrimSpace(item.Reason),
				Message:   strings.TrimSpace(item.Message),
				Count:     item.Count,
			})
		}
	}
	return events, nil
}

func printReplayTimeline(cmd *cobra.Command, a *app, kind, name string, target time.Time, events []replayEvent) error {
	ns := a.namespace
	if ns == "" {
		ns = "default"
	}

	fmt.Fprintf(a.stdout, "\n%s%s Replay: %s/%s at %s%s\n\n",
		ansiBold, ansiCyan, kind, name, target.Format("2006-01-02 15:04:05 UTC"), ansiReset)
	fmt.Fprintf(a.stdout, "%sNamespace: %s%s\n", ansiGray, ns, ansiReset)
	fmt.Fprintf(a.stdout, "%sEvents at or before target: %d%s\n\n", ansiGray, len(events), ansiReset)

	if len(events) == 0 {
		fmt.Fprintf(a.stdout, "%sNo events found for %s/%s in namespace %s at or before %s.%s\n",
			ansiYellow, kind, name, ns, target.Format("2006-01-02 15:04:05"), ansiReset)
		fmt.Fprintf(a.stdout, "%sTip: Run `kcli events --recent 1h` to see recent cluster events.%s\n\n", ansiGray, ansiReset)
		return nil
	}

	// Sort chronologically (oldest first)
	sort.Slice(events, func(i, j int) bool {
		return events[i].Timestamp.Before(events[j].Timestamp)
	})

	fmt.Fprintf(a.stdout, "%s%-22s %-8s %-18s %s%s\n", ansiBold, "TIME", "TYPE", "REASON", "MESSAGE", ansiReset)
	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 78))

	for _, e := range events {
		tsStr := e.Timestamp.Format("2006-01-02 15:04:05")
		typeColor := ansiGreen
		if e.Type == "Warning" {
			typeColor = ansiYellow
		}
		msg := e.Message
		if len(msg) > 80 {
			msg = msg[:77] + "..."
		}
		countStr := ""
		if e.Count > 1 {
			countStr = fmt.Sprintf(" (x%d)", e.Count)
		}
		fmt.Fprintf(a.stdout, "%-22s %s%-8s%s %-18s %s%s\n",
			tsStr, typeColor, e.Type, ansiReset, e.Reason+countStr, msg, ansiReset)
	}

	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 78))
	fmt.Fprintf(a.stdout, "%s%d events leading to state at %s%s\n\n",
		ansiGray, len(events), target.Format("2006-01-02 15:04:05"), ansiReset)
	return nil
}

// printReplayPrometheus queries Prometheus for resource metrics at the target time. Non-fatal.
func printReplayPrometheus(a *app, kind, name string, target time.Time) {
	ep, err := a.resolvePromEndpoint()
	if err != nil {
		return
	}
	client := newPromClient(ep)
	ns := a.namespace
	if ns == "" {
		ns = "default"
	}

	// Only support Pod metrics for now; other kinds need different PromQL
	if kind != "Pod" {
		return
	}

	queries := []struct {
		label string
		expr  string
	}{
		{"Memory (bytes)", fmt.Sprintf("container_memory_usage_bytes{pod=%q,namespace=%q}", name, ns)},
		{"Memory (working set)", fmt.Sprintf("container_memory_working_set_bytes{pod=%q,namespace=%q}", name, ns)},
	}
	params := url.Values{"time": {fmt.Sprintf("%d", target.Unix())}}

	fmt.Fprintf(a.stdout, "%s%s Prometheus metrics at %s%s\n\n", ansiBold, ansiCyan, target.Format("2006-01-02 15:04:05"), ansiReset)
	any := false
	for _, q := range queries {
		params.Set("query", q.expr)
		body, err := client.get("/api/v1/query", params)
		if err != nil {
			fmt.Fprintf(a.stderr, "%sWARN: Prometheus unreachable: %v%s\n", ansiYellow, err, ansiReset)
			return
		}
		var resp promResponse
		if err := json.Unmarshal(body, &resp); err != nil || resp.Status != "success" {
			continue
		}
		for _, r := range resp.Data.Result {
			val := ""
			if len(r.Value) == 2 {
				val = fmt.Sprintf("%v", r.Value[1])
			}
			container := r.Metric["container"]
			if container == "" {
				container = "-"
			}
			fmt.Fprintf(a.stdout, "  %s%s%s: %s (container=%s)\n", ansiGray, q.label, ansiReset, val, container)
			any = true
		}
	}
	if !any {
		fmt.Fprintf(a.stdout, "%s(no Prometheus metrics found; ensure metrics-server or cAdvisor is scraping)%s\n", ansiGray, ansiReset)
		fmt.Fprintf(a.stdout, "%sTip: kubectl port-forward svc/prometheus-operated 9090:9090 -n monitoring%s\n\n", ansiGray, ansiReset)
	} else {
		fmt.Fprintln(a.stdout)
	}
}
