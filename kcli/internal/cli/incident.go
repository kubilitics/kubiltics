package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

type k8sPodList struct {
	Items []k8sPod `json:"items"`
}

type k8sPod struct {
	Metadata struct {
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
	} `json:"metadata"`
	Spec struct {
		NodeName string `json:"nodeName"`
	} `json:"spec"`
	Status struct {
		Phase             string `json:"phase"`
		StartTime         string `json:"startTime"`
		ContainerStatuses []struct {
			Name         string `json:"name"`
			RestartCount int    `json:"restartCount"`
			State        struct {
				Waiting struct {
					Reason string `json:"reason"`
				} `json:"waiting"`
				Terminated struct {
					Reason string `json:"reason"`
				} `json:"terminated"`
			} `json:"state"`
			LastState struct {
				Terminated struct {
					Reason     string `json:"reason"`
					FinishedAt string `json:"finishedAt"`
				} `json:"terminated"`
			} `json:"lastState"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

type k8sNodeList struct {
	Items []k8sNode `json:"items"`
}

type k8sNode struct {
	Metadata struct {
		Name string `json:"name"`
	} `json:"metadata"`
	Status struct {
		Conditions []struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"conditions"`
	} `json:"status"`
}

type incidentReport struct {
	CrashLoopBackOff []incidentPodEntry  `json:"crashLoopBackOff"`
	OOMKilled        []incidentPodEntry  `json:"oomKilled"`
	HighRestarts     []incidentPodEntry  `json:"highRestarts"`
	NodePressure     []incidentNodeEntry `json:"nodePressure"`
	CriticalEvents   []eventRecord       `json:"criticalEvents"`
}

type incidentPodEntry struct {
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container,omitempty"`
	Restarts  int    `json:"restarts"`
	Phase     string `json:"phase,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type incidentNodeEntry struct {
	Node      string `json:"node"`
	Condition string `json:"condition"`
	Reason    string `json:"reason,omitempty"`
	Message   string `json:"message,omitempty"`
}

func newIncidentCmd(a *app) *cobra.Command {
	var recent string
	var output string
	var restartThreshold int
	var watch bool
	var interval time.Duration
	var noClear bool
	var escalate string // "pagerduty", "slack", "jira", or comma-separated

	cmd := &cobra.Command{
		Use:     "incident",
		Short:   "Incident mode summary (CrashLoop/OOM/restarts/node pressure/events)",
		GroupID: "incident",
		Example: `  kcli incident
  kcli incident --watch
  kcli incident --watch --interval=10s
  kcli incident --watch --no-clear >> incident.log
  kcli incident --escalate=slack
  kcli incident --escalate=pagerduty,slack,jira
  kcli incident --output=json`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			render := func() error {
				window := 2 * time.Hour
				if strings.TrimSpace(recent) != "" {
					d, err := time.ParseDuration(strings.TrimSpace(recent))
					if err != nil {
						return fmt.Errorf("invalid --recent value %q: %w", recent, err)
					}
					window = d
				}

				report, err := buildIncidentReport(a, window, restartThreshold)
				if err != nil {
					return err
				}

				switch strings.ToLower(strings.TrimSpace(output)) {
				case "table", "":
					printIncidentTable(cmd, report)
					fmt.Fprintln(cmd.OutOrStdout(), "\nQuick actions:")
					fmt.Fprintln(cmd.OutOrStdout(), "  kcli incident logs <namespace>/<pod> --tail=200")
					fmt.Fprintln(cmd.OutOrStdout(), "  kcli incident describe <namespace>/<pod>")
					fmt.Fprintln(cmd.OutOrStdout(), "  kcli incident restart <namespace>/<pod>")
					return nil
				case "json":
					b, err := json.MarshalIndent(report, "", "  ")
					if err != nil {
						return err
					}
					fmt.Fprintln(cmd.OutOrStdout(), string(b))
					return nil
				default:
					return fmt.Errorf("unsupported --output %q (supported: table, json)", output)
				}
			}

			if escalate != "" {
				window := 2 * time.Hour
				if strings.TrimSpace(recent) != "" {
					if d, err := time.ParseDuration(strings.TrimSpace(recent)); err == nil {
						window = d
					}
				}
				report, err := buildIncidentReport(a, window, restartThreshold)
				if err != nil {
					return err
				}
				return escalateIncident(a, report, escalate, cmd)
			}

			if !watch {
				return render()
			}
			if interval <= 0 {
				interval = 5 * time.Second
			}

			// Record the time the watch session started (for elapsed display).
			watchStart := time.Now()
			iteration := 0

			for {
				iteration++
				elapsed := time.Since(watchStart).Round(time.Second)

				if !noClear {
					// Use ANSI cursor positioning (not `clear` shell command)
					// to redraw in place without spawning a subprocess.
					fmt.Fprint(cmd.OutOrStdout(), "\033[2J\033[H")
				} else if iteration > 1 {
					// Append mode: print a divider so the log file is readable.
					fmt.Fprintf(cmd.OutOrStdout(), "\n%s\n", strings.Repeat("─", 80))
				}

				// Header with timestamp, elapsed time, and refresh cadence.
				now := time.Now().Format("2006-01-02 15:04:05")
				fmt.Fprintf(cmd.OutOrStdout(),
					"\033[1m\033[36m ⟳ Incident Watch\033[0m  %s  elapsed: %s  interval: %s  (Ctrl+C to stop)\n\n",
					now, elapsed, interval)

				if err := render(); err != nil {
					return err
				}

				select {
				case <-time.After(interval):
					// Continue to the next iteration.
				case <-cmd.Context().Done():
					// SIGINT or cancellation: print exit message and exit cleanly.
					fmt.Fprintf(cmd.OutOrStdout(),
						"\n\033[1mStopped watching.\033[0m Run \033[36mkcli incident\033[0m to see current state.\n")
					return nil
				}
			}
		},
	}
	cmd.Flags().StringVar(&recent, "recent", "2h", "duration window for critical events (e.g. 30m, 2h)")
	cmd.Flags().StringVar(&output, "output", "table", "output format: table|json")
	cmd.Flags().IntVar(&restartThreshold, "restarts-threshold", 5, "minimum restarts to classify as high-restart pod")
	cmd.Flags().BoolVar(&watch, "watch", false, "auto-refresh incident summary continuously")
	// --interval is the primary flag; --refresh is kept as a hidden alias for backward compat.
	cmd.Flags().DurationVar(&interval, "interval", 5*time.Second, "refresh interval for --watch mode (e.g. 5s, 10s, 1m)")
	cmd.Flags().DurationVar(&interval, "refresh", 5*time.Second, "refresh interval for --watch mode (alias for --interval)")
	if err := cmd.Flags().MarkHidden("refresh"); err == nil {
		_ = err // best-effort hide; non-fatal if flag doesn't exist
	}
	cmd.Flags().BoolVar(&noClear, "no-clear", false, "append output instead of clearing screen (useful for: --watch --no-clear >> incident.log)")
	cmd.Flags().StringVar(&escalate, "escalate", "", "escalate incident to: pagerduty, slack, jira (comma-separated)")
	cmd.AddCommand(newIncidentQuickActionCmd(a).Commands()...)
	cmd.AddCommand(newIncidentExportCmd(a))
	return cmd
}

// incidentExportIndex is the top-level index written to the export bundle.
type incidentExportIndex struct {
	ExportedAt string `json:"exportedAt"`
	Since      string `json:"since"`
	Context    string `json:"context,omitempty"`
	Summary    struct {
		CrashLoopBackOff int `json:"crashLoopBackOff"`
		OOMKilled        int `json:"oomKilled"`
		HighRestarts     int `json:"highRestarts"`
		NodePressure     int `json:"nodePressure"`
		CriticalEvents   int `json:"criticalEvents"`
	} `json:"summary"`
}

func newIncidentExportCmd(a *app) *cobra.Command {
	var since, output string
	var withLogs bool
	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export incident snapshot for postmortem (events + report + optional logs)",
		Long:  "Writes a directory (or .tar.gz) containing index.json, report.json, and optionally logs per problematic pod. Use for sharing incident context or postmortems.",
		RunE: func(cmd *cobra.Command, _ []string) error {
			window := 1 * time.Hour
			if strings.TrimSpace(since) != "" {
				d, err := time.ParseDuration(strings.TrimSpace(since))
				if err != nil {
					return fmt.Errorf("invalid --since: %w", err)
				}
				window = d
			}
			outPath := strings.TrimSpace(output)
			if outPath == "" {
				outPath = "incident-bundle"
			}
			return runIncidentExport(a, window, outPath, withLogs, cmd.OutOrStdout())
		},
	}
	cmd.Flags().StringVar(&since, "since", "1h", "time window for events and report")
	cmd.Flags().StringVar(&output, "output", "incident-bundle", "output directory or path ending in .tar.gz")
	cmd.Flags().BoolVar(&withLogs, "with-logs", false, "include tail of logs for each problematic pod")
	return cmd
}

func runIncidentExport(a *app, window time.Duration, outPath string, withLogs bool, stdout io.Writer) error {
	report, err := buildIncidentReport(a, window, 5)
	if err != nil {
		return err
	}

	outDir := outPath
	makeTar := strings.HasSuffix(strings.ToLower(outPath), ".tar.gz") || strings.HasSuffix(strings.ToLower(outPath), ".tar")
	if makeTar {
		var err error
		outDir, err = os.MkdirTemp("", "kcli-incident-export-*")
		if err != nil {
			return err
		}
		defer os.RemoveAll(outDir)
	}

	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	idx := incidentExportIndex{
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Since:      window.String(),
		Context:    a.context,
	}
	idx.Summary.CrashLoopBackOff = len(report.CrashLoopBackOff)
	idx.Summary.OOMKilled = len(report.OOMKilled)
	idx.Summary.HighRestarts = len(report.HighRestarts)
	idx.Summary.NodePressure = len(report.NodePressure)
	idx.Summary.CriticalEvents = len(report.CriticalEvents)

	idxBytes, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outDir, "index.json"), idxBytes, 0o644); err != nil {
		return err
	}

	reportBytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outDir, "report.json"), reportBytes, 0o644); err != nil {
		return err
	}

	if withLogs {
		logsDir := filepath.Join(outDir, "logs")
		if err := os.MkdirAll(logsDir, 0o755); err != nil {
			return err
		}
		seen := map[string]struct{}{}
		for _, list := range [][]incidentPodEntry{report.CrashLoopBackOff, report.OOMKilled, report.HighRestarts} {
			for _, p := range list {
				k := p.Namespace + "/" + p.Pod
				if _, ok := seen[k]; ok {
					continue
				}
				seen[k] = struct{}{}
				args := []string{"logs", p.Pod, "-n", p.Namespace, "--tail=100"}
				if p.Container != "" {
					args = append(args, "-c", p.Container)
				}
				out, runErr := a.captureKubectl(args)
				fname := filepath.Join(logsDir, p.Namespace+"-"+p.Pod+".txt")
				if runErr != nil {
					_ = os.WriteFile(fname, []byte(fmt.Sprintf("Failed to get logs: %v\n", runErr)), 0o644)
				} else {
					_ = os.WriteFile(fname, []byte(out), 0o644)
				}
			}
		}
	}

	if makeTar {
		if err := writeTarball(outPath, outDir); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "Exported to %s\n", outPath)
	} else {
		fmt.Fprintf(stdout, "Exported to %s (index.json, report.json)\n", outDir)
	}
	return nil
}

func writeTarball(dest, srcDir string) error {
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()

	const tarballRoot = "incident-bundle"
	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.Join(tarballRoot, rel)
		if info.IsDir() {
			return tw.WriteHeader(&tar.Header{Name: rel + "/", Mode: int64(info.Mode()), Typeflag: tar.TypeDir})
		}
		h, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		h.Name = rel
		if err := tw.WriteHeader(h); err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = io.Copy(tw, f)
		f.Close()
		return err
	})
}

// ─── Escalation helpers ───────────────────────────────────────────────────────

// escalateIncident sends the incident report to the configured escalation targets.
func escalateIncident(a *app, report *incidentReport, targets string, cmd *cobra.Command) error {
	summary := buildIncidentSummary(report)
	errs := []string{}

	for _, target := range strings.Split(targets, ",") {
		t := strings.TrimSpace(strings.ToLower(target))
		switch t {
		case "pagerduty", "pd":
			if err := escalatePagerDuty(a, summary); err != nil {
				errs = append(errs, fmt.Sprintf("pagerduty: %v", err))
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), ansiBold+ansiGreen+"[escalate] PagerDuty alert triggered"+ansiReset)
			}
		case "slack":
			if err := escalateSlack(a, summary); err != nil {
				errs = append(errs, fmt.Sprintf("slack: %v", err))
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), ansiBold+ansiGreen+"[escalate] Slack message sent"+ansiReset)
			}
		case "jira":
			if err := escalateJira(a, summary, report); err != nil {
				errs = append(errs, fmt.Sprintf("jira: %v", err))
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), ansiBold+ansiGreen+"[escalate] Jira issue created"+ansiReset)
			}
		default:
			errs = append(errs, fmt.Sprintf("unknown escalation target %q (supported: pagerduty, slack, jira)", t))
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("escalation errors:\n  %s", strings.Join(errs, "\n  "))
	}
	return nil
}

func buildIncidentSummary(report *incidentReport) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("*Kubernetes Incident Alert* — %s\n\n", time.Now().Format(time.RFC1123)))
	if len(report.CrashLoopBackOff) > 0 {
		b.WriteString(fmt.Sprintf("CrashLoopBackOff (%d): ", len(report.CrashLoopBackOff)))
		pods := make([]string, 0, len(report.CrashLoopBackOff))
		for _, p := range report.CrashLoopBackOff {
			pods = append(pods, fmt.Sprintf("%s/%s", p.Namespace, p.Pod))
		}
		b.WriteString(strings.Join(pods, ", ") + "\n")
	}
	if len(report.OOMKilled) > 0 {
		b.WriteString(fmt.Sprintf("OOMKilled (%d): ", len(report.OOMKilled)))
		pods := make([]string, 0, len(report.OOMKilled))
		for _, p := range report.OOMKilled {
			pods = append(pods, fmt.Sprintf("%s/%s", p.Namespace, p.Pod))
		}
		b.WriteString(strings.Join(pods, ", ") + "\n")
	}
	if len(report.NodePressure) > 0 {
		b.WriteString(fmt.Sprintf("Node Pressure (%d): ", len(report.NodePressure)))
		nodes := make([]string, 0, len(report.NodePressure))
		for _, n := range report.NodePressure {
			nodes = append(nodes, fmt.Sprintf("%s(%s)", n.Node, n.Condition))
		}
		b.WriteString(strings.Join(nodes, ", ") + "\n")
	}
	return b.String()
}

// escalatePagerDuty sends a PagerDuty Events v2 trigger.
func escalatePagerDuty(a *app, summary string) error {
	key := ""
	if a.cfg != nil {
		key = a.cfg.Integrations.PagerDutyKey
	}
	if key == "" {
		key = os.Getenv("PAGERDUTY_INTEGRATION_KEY")
	}
	if key == "" {
		return fmt.Errorf("no PagerDuty integration key configured — set integrations.pagerDutyKey or PAGERDUTY_INTEGRATION_KEY env")
	}

	payload := map[string]interface{}{
		"routing_key":  key,
		"event_action": "trigger",
		"payload": map[string]interface{}{
			"summary":   "Kubernetes Incident: " + strings.Split(summary, "\n")[0],
			"severity":  "critical",
			"source":    "kcli",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"custom_details": map[string]string{
				"details": summary,
			},
		},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := http.Post("https://events.pagerduty.com/v2/enqueue", "application/json", bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("PagerDuty returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// escalateSlack sends an incident message to Slack via incoming webhook.
func escalateSlack(a *app, summary string) error {
	webhook := ""
	if a.cfg != nil {
		webhook = a.cfg.Integrations.SlackWebhook
	}
	if webhook == "" {
		webhook = os.Getenv("SLACK_WEBHOOK_URL")
	}
	if webhook == "" {
		return fmt.Errorf("no Slack webhook configured — set integrations.slackWebhook or SLACK_WEBHOOK_URL env")
	}

	payload := map[string]interface{}{
		"text": summary,
		"blocks": []map[string]interface{}{
			{
				"type": "section",
				"text": map[string]string{
					"type": "mrkdwn",
					"text": summary,
				},
			},
		},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := http.Post(webhook, "application/json", bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Slack webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// escalateJira creates a Jira issue with incident details.
func escalateJira(a *app, summary string, report *incidentReport) error {
	jiraURL := ""
	token := ""
	project := ""
	if a.cfg != nil {
		jiraURL = a.cfg.Integrations.JiraURL
		token = a.cfg.Integrations.JiraToken
		project = a.cfg.Integrations.JiraProject
	}
	if jiraURL == "" {
		jiraURL = os.Getenv("JIRA_URL")
	}
	if token == "" {
		token = os.Getenv("JIRA_TOKEN")
	}
	if project == "" {
		project = os.Getenv("JIRA_PROJECT")
	}
	if jiraURL == "" || token == "" || project == "" {
		return fmt.Errorf("Jira not fully configured — need integrations.jiraUrl, integrations.jiraToken, integrations.jiraProject (or JIRA_URL, JIRA_TOKEN, JIRA_PROJECT env vars)")
	}

	title := fmt.Sprintf("[K8s Incident] CrashLoop=%d OOM=%d NodePressure=%d",
		len(report.CrashLoopBackOff), len(report.OOMKilled), len(report.NodePressure))

	payload := map[string]interface{}{
		"fields": map[string]interface{}{
			"project":     map[string]string{"key": project},
			"summary":     title,
			"description": summary,
			"issuetype":   map[string]string{"name": "Incident"},
			"priority":    map[string]string{"name": "Critical"},
		},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", strings.TrimRight(jiraURL, "/")+"/rest/api/2/issue", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Jira returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func newIncidentQuickActionCmd(a *app) *cobra.Command {
	root := &cobra.Command{
		Use:    "actions",
		Short:  "Incident quick actions",
		Hidden: true,
	}

	var tail int
	logs := &cobra.Command{
		Use:   "logs <namespace>/<pod>",
		Short: "Quick action: fetch pod logs",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, err := parseNamespacedPod(args[0])
			if err != nil {
				return err
			}
			return a.runKubectl([]string{"logs", pod, "-n", ns, fmt.Sprintf("--tail=%d", tail)})
		},
	}
	logs.Flags().IntVar(&tail, "tail", 200, "number of log lines to fetch")

	describe := &cobra.Command{
		Use:   "describe <namespace>/<pod>",
		Short: "Quick action: describe pod",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, err := parseNamespacedPod(args[0])
			if err != nil {
				return err
			}
			return a.runKubectl([]string{"describe", "pod", pod, "-n", ns})
		},
	}

	restart := &cobra.Command{
		Use:   "restart <namespace>/<pod>",
		Short: "Quick action: restart pod by deleting it (controller-managed pods)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, err := parseNamespacedPod(args[0])
			if err != nil {
				return err
			}
			return a.runKubectl([]string{"delete", "pod", pod, "-n", ns})
		},
	}

	root.AddCommand(logs, describe, restart)
	return root
}

func parseNamespacedPod(v string) (namespace, pod string, err error) {
	parts := strings.SplitN(strings.TrimSpace(v), "/", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", fmt.Errorf("expected namespace/pod format, got %q", v)
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), nil
}

func buildIncidentReport(a *app, recentWindow time.Duration, restartThreshold int) (*incidentReport, error) {
	pods, err := fetchPods(a)
	if err != nil {
		return nil, err
	}
	nodes, err := fetchNodes(a)
	if err != nil {
		return nil, err
	}
	events, err := fetchEvents(a)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	recentEvents := filterEventsByRecent(events, recentWindow, now)
	criticalEvents := make([]eventRecord, 0, len(recentEvents))
	for _, e := range recentEvents {
		if strings.EqualFold(e.Type, "Warning") {
			criticalEvents = append(criticalEvents, e)
		}
	}
	sort.SliceStable(criticalEvents, func(i, j int) bool {
		return criticalEvents[i].Timestamp.After(criticalEvents[j].Timestamp)
	})
	if len(criticalEvents) > 30 {
		criticalEvents = criticalEvents[:30]
	}

	report := &incidentReport{
		CrashLoopBackOff: make([]incidentPodEntry, 0),
		OOMKilled:        make([]incidentPodEntry, 0),
		HighRestarts:     make([]incidentPodEntry, 0),
		NodePressure:     make([]incidentNodeEntry, 0),
		CriticalEvents:   criticalEvents,
	}

	for _, p := range pods.Items {
		totalRestarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			totalRestarts += cs.RestartCount
			if strings.EqualFold(cs.State.Waiting.Reason, "CrashLoopBackOff") {
				report.CrashLoopBackOff = append(report.CrashLoopBackOff, incidentPodEntry{
					Namespace: p.Metadata.Namespace,
					Pod:       p.Metadata.Name,
					Container: cs.Name,
					Restarts:  cs.RestartCount,
					Phase:     p.Status.Phase,
					Reason:    cs.State.Waiting.Reason,
				})
			}
			if strings.EqualFold(cs.State.Terminated.Reason, "OOMKilled") || strings.EqualFold(cs.LastState.Terminated.Reason, "OOMKilled") {
				report.OOMKilled = append(report.OOMKilled, incidentPodEntry{
					Namespace: p.Metadata.Namespace,
					Pod:       p.Metadata.Name,
					Container: cs.Name,
					Restarts:  cs.RestartCount,
					Phase:     p.Status.Phase,
					Reason:    "OOMKilled",
				})
			}
		}
		if totalRestarts >= restartThreshold {
			report.HighRestarts = append(report.HighRestarts, incidentPodEntry{
				Namespace: p.Metadata.Namespace,
				Pod:       p.Metadata.Name,
				Restarts:  totalRestarts,
				Phase:     p.Status.Phase,
			})
		}
	}

	sort.SliceStable(report.HighRestarts, func(i, j int) bool {
		return report.HighRestarts[i].Restarts > report.HighRestarts[j].Restarts
	})
	if len(report.HighRestarts) > 30 {
		report.HighRestarts = report.HighRestarts[:30]
	}

	for _, n := range nodes.Items {
		for _, c := range n.Status.Conditions {
			if (c.Type == "MemoryPressure" || c.Type == "DiskPressure" || c.Type == "PIDPressure") && strings.EqualFold(c.Status, "True") {
				report.NodePressure = append(report.NodePressure, incidentNodeEntry{
					Node:      n.Metadata.Name,
					Condition: c.Type,
					Reason:    c.Reason,
					Message:   c.Message,
				})
			}
		}
	}

	return report, nil
}

func fetchPods(a *app) (*k8sPodList, error) {
	out, err := a.captureKubectl([]string{"get", "pods", "-A", "-o", "json"})
	if err != nil {
		return nil, err
	}
	var pods k8sPodList
	if err := json.Unmarshal([]byte(out), &pods); err != nil {
		return nil, fmt.Errorf("failed to parse pods JSON: %w", err)
	}
	return &pods, nil
}

func fetchNodes(a *app) (*k8sNodeList, error) {
	out, err := a.captureKubectl([]string{"get", "nodes", "-o", "json"})
	if err != nil {
		return nil, err
	}
	var nodes k8sNodeList
	if err := json.Unmarshal([]byte(out), &nodes); err != nil {
		return nil, fmt.Errorf("failed to parse nodes JSON: %w", err)
	}
	return &nodes, nil
}

func printIncidentTable(cmd *cobra.Command, report *incidentReport) {
	fmt.Fprintln(cmd.OutOrStdout(), "=== CrashLoopBackOff ===")
	if len(report.CrashLoopBackOff) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.CrashLoopBackOff {
			fmt.Fprintf(cmd.OutOrStdout(), "%s/%s container=%s restarts=%d\n", v.Namespace, v.Pod, v.Container, v.Restarts)
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== OOMKilled ===")
	if len(report.OOMKilled) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.OOMKilled {
			fmt.Fprintf(cmd.OutOrStdout(), "%s/%s container=%s restarts=%d\n", v.Namespace, v.Pod, v.Container, v.Restarts)
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== High Restart Pods ===")
	if len(report.HighRestarts) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.HighRestarts {
			fmt.Fprintf(cmd.OutOrStdout(), "%s/%s restarts=%d phase=%s\n", v.Namespace, v.Pod, v.Restarts, emptyDash(v.Phase))
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== Node Pressure ===")
	if len(report.NodePressure) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.NodePressure {
			fmt.Fprintf(cmd.OutOrStdout(), "%s condition=%s reason=%s\n", v.Node, v.Condition, emptyDash(v.Reason))
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== Recent Critical Events ===")
	printEventTable(cmd, report.CriticalEvents)
}
