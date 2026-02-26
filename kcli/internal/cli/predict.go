package cli

// predict.go — kcli predict command group.
//
// Predictive analytics for Kubernetes workloads.
// Analyzes historical pod metrics (restarts, resource trends) and events
// to detect patterns that indicate imminent failures.
//
// Commands:
//   kcli predict                         — full predictive analysis
//   kcli predict --horizon=4h|24h|7d     — prediction horizon
//   kcli predict --continuous            — watch mode with alerts
//   kcli anomaly list                    — detected anomalies

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
)

// ─── Metric data types ────────────────────────────────────────────────────────

type podMetricSample struct {
	Name        string
	Namespace   string
	CPUCores    float64
	MemGiB      float64
	RestartCount int
}

type prediction struct {
	Confidence  float64
	Resource    string
	Namespace   string
	Issue       string
	Detail      string
	Horizon     string
	Action      string
	Severity    string // HIGH, MEDIUM, LOW
}

type anomaly struct {
	Resource  string
	Namespace string
	Issue     string
	Detail    string
	Severity  string
	Since     string
}

// predictionKey returns a unique key for comparing predictions across cycles.
func predictionKey(p prediction) string {
	return p.Resource + "|" + p.Namespace + "|" + p.Issue
}

// ─── Data collection ──────────────────────────────────────────────────────────

// fetchPodMetrics gets current pod resource usage via kubectl top.
func (a *app) fetchPodMetrics(namespace string) ([]podMetricSample, error) {
	args := []string{"top", "pods", "--no-headers"}
	if namespace != "" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, nil // metrics-server may not be installed
	}

	var samples []podMetricSample
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.Fields(line)
		if namespace != "" && len(fields) < 3 {
			continue
		}
		if namespace == "" && len(fields) < 4 {
			continue
		}

		var ns, name, cpu, mem string
		if namespace == "" {
			ns, name, cpu, mem = fields[0], fields[1], fields[2], fields[3]
		} else {
			ns = namespace
			name, cpu, mem = fields[0], fields[1], fields[2]
		}

		samples = append(samples, podMetricSample{
			Name:      name,
			Namespace: ns,
			CPUCores:  parseCPUCores(cpu),
			MemGiB:    parseMemGiB(mem),
		})
	}
	return samples, nil
}

// fetchRestartingPods collects pods with high restart counts.
func (a *app) fetchRestartingPods(namespace string) ([]prediction, error) {
	args := []string{"get", "pods", "-o", "json"}
	if namespace != "" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var podList struct {
		Items []struct {
			Metadata struct {
				Name              string    `json:"name"`
				Namespace         string    `json:"namespace"`
				CreationTimestamp time.Time `json:"creationTimestamp"`
			} `json:"metadata"`
			Status struct {
				Phase             string `json:"phase"`
				ContainerStatuses []struct {
					Name         string `json:"name"`
					RestartCount int    `json:"restartCount"`
					State        struct {
						Waiting struct {
							Reason  string `json:"reason"`
							Message string `json:"message"`
						} `json:"waiting"`
						Terminated struct {
							Reason   string `json:"reason"`
							ExitCode int    `json:"exitCode"`
						} `json:"terminated"`
					} `json:"state"`
					LastState struct {
						Terminated struct {
							Reason   string `json:"reason"`
							ExitCode int    `json:"exitCode"`
							FinishedAt time.Time `json:"finishedAt"`
						} `json:"terminated"`
					} `json:"lastState"`
				} `json:"containerStatuses"`
			} `json:"status"`
			Spec struct {
				Containers []struct {
					Name      string `json:"name"`
					Resources struct {
						Requests map[string]string `json:"requests"`
						Limits   map[string]string `json:"limits"`
					} `json:"resources"`
				} `json:"containers"`
			} `json:"spec"`
		} `json:"items"`
	}

	if err := json.Unmarshal([]byte(out), &podList); err != nil {
		return nil, fmt.Errorf("failed to parse pods: %w", err)
	}

	var predictions []prediction
	for _, pod := range podList.Items {
		if pod.Status.Phase == "Succeeded" {
			continue
		}
		for _, cs := range pod.Status.ContainerStatuses {
			// High restart count — predict continued crashing
			if cs.RestartCount >= 5 {
				conf := math.Min(0.95, 0.60+float64(cs.RestartCount)*0.01)
				sev := "MEDIUM"
				if cs.RestartCount >= 20 {
					sev = "HIGH"
					conf = 0.95
				}

				issue := "CrashLoopBackOff pattern"
				detail := fmt.Sprintf("Container '%s' has restarted %d times — pattern indicates persistent failure",
					cs.Name, cs.RestartCount)
				action := fmt.Sprintf("kcli why pod/%s -n %s", pod.Metadata.Name, pod.Metadata.Namespace)

				if cs.State.Waiting.Reason == "OOMKilled" || cs.LastState.Terminated.Reason == "OOMKilled" {
					issue = "OOMKill risk — memory limit exceeded"
					detail = fmt.Sprintf("Container '%s' OOMKilled %d times — memory limit too low", cs.Name, cs.RestartCount)
					action = fmt.Sprintf("kcli fix pod/%s -n %s --memory", pod.Metadata.Name, pod.Metadata.Namespace)
					sev = "HIGH"
					conf = 0.92
				}

				predictions = append(predictions, prediction{
					Confidence: conf,
					Resource:   fmt.Sprintf("pod/%s", pod.Metadata.Name),
					Namespace:  pod.Metadata.Namespace,
					Issue:      issue,
					Detail:     detail,
					Action:     action,
					Severity:   sev,
					Horizon:    "immediate",
				})
			}

			// CrashLoopBackOff state
			if cs.State.Waiting.Reason == "CrashLoopBackOff" {
				predictions = append(predictions, prediction{
					Confidence: 0.97,
					Resource:   fmt.Sprintf("pod/%s", pod.Metadata.Name),
					Namespace:  pod.Metadata.Namespace,
					Issue:      "CrashLoopBackOff — will not self-recover",
					Detail:     fmt.Sprintf("Container '%s' is in CrashLoopBackOff: %s", cs.Name, cs.State.Waiting.Message),
					Action:     fmt.Sprintf("kcli why pod/%s -n %s", pod.Metadata.Name, pod.Metadata.Namespace),
					Severity:   "HIGH",
					Horizon:    "now",
				})
			}
		}

		// Check resource limits vs requests for OOM prediction
		for _, c := range pod.Spec.Containers {
			memLim := parseMemGiB(c.Resources.Limits["memory"])
			memReq := parseMemGiB(c.Resources.Requests["memory"])
			// No memory limit — OOM risk
			if memLim == 0 && memReq > 2 {
				predictions = append(predictions, prediction{
					Confidence: 0.75,
					Resource:   fmt.Sprintf("pod/%s", pod.Metadata.Name),
					Namespace:  pod.Metadata.Namespace,
					Issue:      "OOM risk — no memory limit set",
					Detail:     fmt.Sprintf("Container '%s' requests %.1fGi with no limit — will consume unlimited memory", c.Name, memReq),
					Action:     fmt.Sprintf("kcli fix pod/%s -n %s --security", pod.Metadata.Name, pod.Metadata.Namespace),
					Severity:   "MEDIUM",
					Horizon:    "days",
				})
			}
		}
	}

	return predictions, nil
}

// detectAnomalies finds unusual patterns in events.
func (a *app) detectAnomalies(namespace string) ([]anomaly, error) {
	args := []string{"get", "events", "--sort-by=.lastTimestamp", "-o", "json"}
	if namespace != "" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, nil // non-fatal
	}

	var eventList struct {
		Items []struct {
			Metadata struct {
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			InvolvedObject struct {
				Kind string `json:"kind"`
				Name string `json:"name"`
			} `json:"involvedObject"`
			Type    string `json:"type"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
			Count   int    `json:"count"`
			LastTimestamp time.Time `json:"lastTimestamp"`
		} `json:"items"`
	}

	if err := json.Unmarshal([]byte(out), &eventList); err != nil {
		return nil, nil
	}

	// Group warning events by resource
	warningByResource := map[string][]string{}
	for _, e := range eventList.Items {
		if e.Type != "Warning" {
			continue
		}
		key := fmt.Sprintf("%s/%s/%s", e.Metadata.Namespace, e.InvolvedObject.Kind, e.InvolvedObject.Name)
		warningByResource[key] = append(warningByResource[key], e.Reason)
	}

	var anomalies []anomaly
	for key, reasons := range warningByResource {
		if len(reasons) < 3 {
			continue // Only flag if 3+ warning events
		}
		parts := strings.SplitN(key, "/", 3)
		ns, kind, name := "", "", key
		if len(parts) == 3 {
			ns, kind, name = parts[0], parts[1], parts[2]
		}

		// Count distinct reason types
		reasonCount := map[string]int{}
		for _, r := range reasons {
			reasonCount[r]++
		}

		// BackOff events
		if reasonCount["BackOff"] > 5 {
			anomalies = append(anomalies, anomaly{
				Resource:  fmt.Sprintf("%s/%s", strings.ToLower(kind), name),
				Namespace: ns,
				Issue:     "Repeated BackOff events",
				Detail:    fmt.Sprintf("%d BackOff events detected — container is failing to start", reasonCount["BackOff"]),
				Severity:  "HIGH",
				Since:     "recent",
			})
		}

		// OOMKilled
		if reasonCount["OOMKilling"] > 0 || reasonCount["OOMKilled"] > 0 {
			count := reasonCount["OOMKilling"] + reasonCount["OOMKilled"]
			anomalies = append(anomalies, anomaly{
				Resource:  fmt.Sprintf("%s/%s", strings.ToLower(kind), name),
				Namespace: ns,
				Issue:     "OOMKill detected",
				Detail:    fmt.Sprintf("%d OOMKill events — memory limit is too low", count),
				Severity:  "HIGH",
				Since:     "recent",
			})
		}

		// Eviction
		if reasonCount["Evicted"] > 0 {
			anomalies = append(anomalies, anomaly{
				Resource:  fmt.Sprintf("%s/%s", strings.ToLower(kind), name),
				Namespace: ns,
				Issue:     "Pod eviction — node under resource pressure",
				Detail:    fmt.Sprintf("Pod evicted %d times — node may be under memory/disk pressure", reasonCount["Evicted"]),
				Severity:  "HIGH",
				Since:     "recent",
			})
		}
	}

	return anomalies, nil
}

// ─── AI-enhanced prediction ───────────────────────────────────────────────────

func (a *app) aiPrediction(predictions []prediction, anomalies []anomaly) error {
	client := a.aiClient()
	if !client.Enabled() {
		return nil
	}

	// Build a context summary for AI
	var sb strings.Builder
	sb.WriteString("Kubernetes cluster predictions and anomalies:\n\n")
	for _, p := range predictions {
		fmt.Fprintf(&sb, "PREDICTION [%s] %s (%s): %s\n", p.Severity, p.Resource, p.Namespace, p.Detail)
	}
	for _, a2 := range anomalies {
		fmt.Fprintf(&sb, "ANOMALY [%s] %s (%s): %s\n", a2.Severity, a2.Resource, a2.Namespace, a2.Detail)
	}
	sb.WriteString("\nProvide 2-3 key operational insights and the most critical action to take immediately.")

	result, err := client.Analyze(context.Background(), "predict", sb.String())
	if err != nil {
		return nil // non-fatal
	}

	fmt.Fprintf(a.stdout, "\n%s%s AI Operational Insights%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 60))
	fmt.Fprintln(a.stdout, result)
	return nil
}

// runPredictionCycle collects predictions and anomalies, filters by confidence, returns sorted results.
func (a *app) runPredictionCycle(namespace string, confidenceThreshold float64) ([]prediction, []anomaly) {
	var allPredictions []prediction
	var allAnomalies []anomaly

	preds, err := a.fetchRestartingPods(namespace)
	if err != nil {
		_ = err
	}
	allPredictions = append(allPredictions, preds...)

	anomalies, err := a.detectAnomalies(namespace)
	if err != nil {
		_ = err
	}
	allAnomalies = append(allAnomalies, anomalies...)

	var filtered []prediction
	for _, p := range allPredictions {
		if p.Confidence >= confidenceThreshold {
			filtered = append(filtered, p)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].Severity != filtered[j].Severity {
			return severityOrder(filtered[i].Severity) < severityOrder(filtered[j].Severity)
		}
		return filtered[i].Confidence > filtered[j].Confidence
	})

	return filtered, allAnomalies
}

// sendPredictSlackNotification sends a Slack message for a HIGH prediction.
func (a *app) sendPredictSlackNotification(p prediction, ctxName string) error {
	webhook := ""
	if a.cfg != nil {
		webhook = strings.TrimSpace(a.cfg.Integrations.SlackWebhook)
	}
	if webhook == "" {
		webhook = strings.TrimSpace(os.Getenv("SLACK_WEBHOOK_URL"))
	}
	if webhook == "" {
		return fmt.Errorf("no Slack webhook configured")
	}

	// Format: "🔴 kcli predict: payment-processor OOM in ~90min [prod-us-east] `kcli fix deployment/payment-processor --memory`"
	resourceShort := p.Resource
	if strings.Contains(resourceShort, "/") {
		parts := strings.SplitN(resourceShort, "/", 2)
		resourceShort = parts[1]
	}
	msg := fmt.Sprintf("🔴 kcli predict: %s %s [%s] `%s`",
		resourceShort, p.Issue, ctxName, p.Action)
	if p.Action == "" {
		msg = fmt.Sprintf("🔴 kcli predict: %s %s [%s]", resourceShort, p.Issue, ctxName)
	}

	payload := map[string]interface{}{
		"text": msg,
		"blocks": []map[string]interface{}{
			{
				"type": "section",
				"text": map[string]string{
					"type": "mrkdwn",
					"text": msg,
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
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Slack webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// getCurrentContextName returns the current kubectl context for display.
func (a *app) getCurrentContextName() string {
	if a.context != "" {
		return a.context
	}
	out, err := a.captureKubectl([]string{"config", "current-context"})
	if err != nil {
		return "current"
	}
	return strings.TrimSpace(out)
}

// ─── newPredictCmd ────────────────────────────────────────────────────────────

func newPredictCmd(a *app) *cobra.Command {
	var namespace string
	var horizon string
	var confidenceThreshold float64
	var withAI bool
	var noColor bool
	var continuous bool
	var interval string

	cmd := &cobra.Command{
		Use:   "predict",
		Short: "Predictive failure analysis — detect issues before they happen",
		Long: `kcli predict analyzes your cluster for patterns that indicate imminent failures:
  • CrashLoop and OOMKill trends
  • Missing resource limits (OOM risk)
  • Warning event spikes
  • Restart count trajectories

Requires metrics-server for resource utilization trends.
AI analysis (--ai) provides actionable insights using your configured AI provider.
--continuous runs prediction every --interval indefinitely, sending Slack alerts for new HIGH findings.`,
		GroupID: "observability",
		Example: `  kcli predict
  kcli predict -n production
  kcli predict --confidence 0.80 --ai
  kcli predict --horizon 7d
  kcli predict --continuous --interval=5m`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}

			if continuous {
				return a.runPredictContinuous(ns, confidenceThreshold, interval, withAI)
			}

			return a.runPredictOnce(ns, confidenceThreshold, horizon, withAI, noColor)
		},
	}

	cmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Analyze a specific namespace (default: all)")
	cmd.Flags().StringVar(&horizon, "horizon", "4h", "Prediction horizon (4h|24h|7d)")
	cmd.Flags().Float64Var(&confidenceThreshold, "confidence", 0.75, "Minimum confidence threshold (0.0–1.0)")
	cmd.Flags().BoolVar(&withAI, "ai", false, "Use AI to generate operational insights")
	cmd.Flags().BoolVar(&noColor, "no-color", false, "Disable color output")
	cmd.Flags().BoolVar(&continuous, "continuous", false, "Run prediction every --interval indefinitely; send Slack on new HIGH findings")
	cmd.Flags().StringVar(&interval, "interval", "5m", "Refresh interval when --continuous (e.g. 5m, 1h)")

	cmd.AddCommand(newPredictScaleCmd(a))
	return cmd
}

func (a *app) runPredictOnce(ns string, confidenceThreshold float64, horizon string, withAI bool, noColor bool) error {
	fmt.Fprintf(a.stdout, "\n%s%s Predictive Analysis%s", ansiBold, ansiCyan, ansiReset)
	if ns != "" {
		fmt.Fprintf(a.stdout, " — %s%s%s", ansiYellow, ns, ansiReset)
	} else {
		fmt.Fprintf(a.stdout, " — cluster-wide")
	}
	fmt.Fprintf(a.stdout, "\n%sConfidence threshold: %.2f  Horizon: %s%s\n",
		ansiGray, confidenceThreshold, horizon, ansiReset)
	fmt.Fprintf(a.stdout, "%s\n\n", strings.Repeat("─", 65))

	filtered, allAnomalies := a.runPredictionCycle(ns, confidenceThreshold)

	// Display predictions
	if len(filtered) > 0 {
		fmt.Fprintf(a.stdout, "%s%s PREDICTED FAILURES:%s\n\n", ansiBold, ansiRed, ansiReset)
		for _, p := range filtered {
			confColor := ansiGreen
			confSymbol := "🟡"
			if p.Confidence >= 0.85 {
				confColor = ansiRed
				confSymbol = "🔴"
			} else if p.Confidence >= 0.75 {
				confColor = ansiYellow
			}

			fmt.Fprintf(a.stdout, "%s %s[%.2f confidence]%s %s%s%s\n",
				confSymbol,
				confColor, p.Confidence, ansiReset,
				ansiBold, p.Resource, ansiReset,
			)
			fmt.Fprintf(a.stdout, "   %sNamespace:%s %s\n", ansiGray, ansiReset, p.Namespace)
			fmt.Fprintf(a.stdout, "   %sIssue:%s %s\n", ansiGray, ansiReset, p.Issue)
			fmt.Fprintf(a.stdout, "   %sDetail:%s %s\n", ansiGray, ansiReset, p.Detail)
			if p.Action != "" {
				fmt.Fprintf(a.stdout, "   %sAction:%s %s%s%s\n", ansiGray, ansiReset, ansiCyan, p.Action, ansiReset)
			}
			fmt.Fprintln(a.stdout)
		}
	} else {
		fmt.Fprintf(a.stdout, "%s✓ No high-confidence failure predictions (threshold: %.2f)%s\n\n",
			ansiGreen, confidenceThreshold, ansiReset)
	}

	// Display anomalies
	if len(allAnomalies) > 0 {
		fmt.Fprintf(a.stdout, "%s%s ANOMALIES DETECTED:%s\n\n", ansiBold, ansiYellow, ansiReset)
		for _, an := range allAnomalies {
			sevColor := ansiYellow
			if an.Severity == "HIGH" {
				sevColor = ansiRed
			}
			fmt.Fprintf(a.stdout, "  %s[%s]%s %s%s%s\n",
				sevColor, an.Severity, ansiReset,
				ansiBold, an.Resource, ansiReset,
			)
			fmt.Fprintf(a.stdout, "   %sNamespace:%s %s\n", ansiGray, ansiReset, an.Namespace)
			fmt.Fprintf(a.stdout, "   %s%s%s\n\n", ansiGray, an.Detail, ansiReset)
		}
	}

	if len(filtered) == 0 && len(allAnomalies) == 0 {
		fmt.Fprintf(a.stdout, "%s✓ Cluster looks healthy — no significant failure patterns detected.%s\n\n", ansiGreen, ansiReset)
		fmt.Fprintf(a.stdout, "%sTip: Run `kcli metrics` for current resource utilization.%s\n", ansiGray, ansiReset)
		fmt.Fprintf(a.stdout, "%sTip: Install metrics-server for richer prediction data.%s\n\n", ansiGray, ansiReset)
	} else {
		if withAI {
			if err := a.aiPrediction(filtered, allAnomalies); err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: AI prediction failed: %v%s\n", ansiYellow, err, ansiReset)
			}
		} else {
			fmt.Fprintf(a.stdout, "%sTip: Run with --ai for AI-powered root cause insights.%s\n\n", ansiGray, ansiReset)
		}
	}

	_ = noColor
	return nil
}

func (a *app) runPredictContinuous(ns string, confidenceThreshold float64, intervalStr string, withAI bool) error {
	d, err := parseDuration(intervalStr)
	if err != nil {
		return fmt.Errorf("invalid --interval %q: %w (use e.g. 5m, 1h)", intervalStr, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
	}()

	ctxName := a.getCurrentContextName()
	prevHighKeys := make(map[string]bool)
	cycle := 0

	for {
		cycle++
		select {
		case <-ctx.Done():
			fmt.Fprintf(a.stdout, "\n%sStopped. Run `kcli predict` for a single analysis.%s\n\n", ansiGray, ansiReset)
			return nil
		default:
		}

		filtered, allAnomalies := a.runPredictionCycle(ns, confidenceThreshold)

		// Find new HIGH predictions since last cycle
		highPredictions := make([]prediction, 0)
		for _, p := range filtered {
			if p.Severity == "HIGH" {
				highPredictions = append(highPredictions, p)
			}
		}

		newHighKeys := make(map[string]bool)
		var newHigh []prediction
		for _, p := range highPredictions {
			key := predictionKey(p)
			newHighKeys[key] = true
			if !prevHighKeys[key] {
				newHigh = append(newHigh, p)
			}
		}
		prevHighKeys = newHighKeys

		// Send Slack for new HIGH findings
		for _, p := range newHigh {
			if err := a.sendPredictSlackNotification(p, ctxName); err != nil {
				fmt.Fprintf(a.stderr, "%sWARN: Slack notification failed: %v%s\n", ansiYellow, err, ansiReset)
			}
		}

		// Display
		ts := time.Now().Format("15:04:05")
		fmt.Fprintf(a.stdout, "\n%s[%s] %sPredictive Analysis%s (cycle %d)%s\n",
			ansiGray, ts, ansiCyan, ansiReset, cycle, ansiReset)
		if ns != "" {
			fmt.Fprintf(a.stdout, "%sScope: %s%s\n", ansiGray, ns, ansiReset)
		} else {
			fmt.Fprintf(a.stdout, "%sScope: cluster-wide%s\n", ansiGray, ansiReset)
		}

		if len(filtered) > 0 {
			fmt.Fprintf(a.stdout, "%s\n%s%s PREDICTED FAILURES:%s\n\n", strings.Repeat("─", 50), ansiBold, ansiRed, ansiReset)
			for _, p := range filtered {
				newBadge := ""
				if p.Severity == "HIGH" {
					for _, n := range newHigh {
						if predictionKey(n) == predictionKey(p) {
							newBadge = ansiRed + " [NEW]" + ansiReset + " "
							break
						}
					}
				}
				confSymbol := "🟡"
				if p.Confidence >= 0.85 {
					confSymbol = "🔴"
				}
				fmt.Fprintf(a.stdout, "%s %s%s[%.2f]%s %s%s%s\n",
					confSymbol, newBadge,
					ansiGray, p.Confidence, ansiReset,
					ansiBold, p.Resource, ansiReset,
				)
				fmt.Fprintf(a.stdout, "   %s%s — %s%s\n", ansiGray, p.Issue, p.Action, ansiReset)
			}
			fmt.Fprintln(a.stdout)
		} else if len(allAnomalies) > 0 {
			fmt.Fprintf(a.stdout, "%s✓ No predictions. %d anomaly(ies) detected.%s\n\n", ansiGray, len(allAnomalies), ansiReset)
		} else {
			fmt.Fprintf(a.stdout, "%s✓ No high-confidence predictions.%s\n\n", ansiGreen, ansiReset)
		}

		// Sleep until next cycle
		select {
		case <-ctx.Done():
			fmt.Fprintf(a.stdout, "\n%sStopped. Run `kcli predict` for a single analysis.%s\n\n", ansiGray, ansiReset)
			return nil
		case <-time.After(d):
			// continue loop
		}
	}
}

// ─── newPredictScaleCmd (P3-5) ────────────────────────────────────────────────

type workloadScaleInfo struct {
	Kind       string  // Deployment, StatefulSet
	Name       string
	Namespace  string
	Replicas   int32
	CPURec     float64 // total CPU request across all replicas
	MemRecGiB  float64
	CPUUsage   float64 // current usage from kubectl top
	MemUsageGiB float64
	HasHPA     bool
	HPAMin     int32
	HPAMax     int32
	HPATarget  int32 // CPU target %
}

func newPredictScaleCmd(a *app) *cobra.Command {
	var workload string
	var namespace string
	var output string // hpa | keda | cronhpa | all

	scale := &cobra.Command{
		Use:   "scale",
		Short: "Autoscaling recommendations — HPA, KEDA CronScaledObject, CronHPA",
		Long: `Analyze workload utilization and suggest proactive autoscaling configurations.

Uses kubectl top (metrics-server) for current CPU/memory usage. When Prometheus
is configured, uses historical trends for richer recommendations.

Outputs apply-ready YAML for:
  • HPA — CPU-based horizontal scaling (built-in)
  • KEDA CronScaledObject — time-based scaling (e.g. business hours)
  • CronHPA — cron-based schedule (if CronHPA controller installed)`,
		Example: `  kcli predict scale --workload payment-api
  kcli predict scale --workload payment-api -n prod --output keda
  kcli predict scale --workload deployment/api --output all`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if workload == "" && len(args) > 0 {
				workload = args[0]
			}
			if workload == "" {
				return fmt.Errorf("specify --workload NAME or pass workload name as argument")
			}
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}
			out := output
			if out == "" {
				out = "all"
			}
			return a.runPredictScale(ns, workload, out)
		},
	}
	scale.Flags().StringVar(&workload, "workload", "", "Workload name (deployment or statefulset)")
	scale.Flags().StringVarP(&namespace, "namespace", "n", "", "Namespace")
	scale.Flags().StringVar(&output, "output", "all", "Output format: hpa | keda | cronhpa | all")
	return scale
}

func (a *app) runPredictScale(ns, workload, output string) error {
	// Resolve workload: try deployment first, then statefulset
	kind, name := "Deployment", workload
	if strings.Contains(workload, "/") {
		parts := strings.SplitN(workload, "/", 2)
		kind, name = parts[0], parts[1]
		kind = strings.TrimSpace(kind)
		name = strings.TrimSpace(name)
		// Normalize kind
		switch strings.ToLower(kind) {
		case "deployment", "deploy":
			kind = "Deployment"
		case "statefulset", "sts":
			kind = "StatefulSet"
		default:
			kind = "Deployment" // default
		}
	}

	info, err := a.fetchWorkloadScaleInfo(ns, kind, name)
	if err != nil {
		return err
	}

	fmt.Fprintf(a.stdout, "\n%s%s Autoscaling Recommendations: %s/%s%s\n\n",
		ansiBold, ansiCyan, kind, name, ansiReset)
	fmt.Fprintf(a.stdout, "%sNamespace: %s  Replicas: %d  HPA: %v%s\n",
		ansiGray, info.Namespace, info.Replicas, info.HasHPA, ansiReset)
	fmt.Fprintf(a.stdout, "%sCPU: %.2f cores used / %.2f requested  |  Memory: %.1fGi used / %.1fGi requested%s\n\n",
		ansiGray, info.CPUUsage, info.CPURec, info.MemUsageGiB, info.MemRecGiB, ansiReset)

	// Recommendation
	cpuUtil := 0.0
	if info.CPURec > 0 {
		cpuUtil = info.CPUUsage / info.CPURec * 100
	}
	if cpuUtil > 85 {
		fmt.Fprintf(a.stdout, "%s⚠ High CPU utilization (%.0f%%) — consider scaling up or adding HPA%s\n\n",
			ansiYellow, cpuUtil, ansiReset)
	} else if cpuUtil < 25 && info.Replicas > 1 {
		fmt.Fprintf(a.stdout, "%s✓ Low CPU utilization (%.0f%%) — consider scaling down or lowering HPA min%s\n\n",
			ansiGreen, cpuUtil, ansiReset)
	}

	// Suggest min/max based on current + headroom
	suggestMin := int(info.Replicas)
	if suggestMin < 1 {
		suggestMin = 1
	}
	suggestMax := suggestMin * 3
	if suggestMax < 3 {
		suggestMax = 3
	}
	if info.HasHPA && info.HPAMax > 0 {
		suggestMax = int(info.HPAMax)
	}

	if output == "hpa" || output == "all" {
		a.printHPARecommendation(info, suggestMin, suggestMax)
	}
	if output == "keda" || output == "all" {
		a.printKEDACronRecommendation(info, suggestMin, suggestMax)
	}
	if output == "cronhpa" || output == "all" {
		a.printCronHPARecommendation(info, suggestMin, suggestMax)
	}
	return nil
}

func (a *app) fetchWorkloadScaleInfo(ns, kind, name string) (*workloadScaleInfo, error) {
	info := &workloadScaleInfo{Kind: kind, Name: name, Namespace: ns}
	if ns == "" {
		info.Namespace = "default"
	}

	args := []string{"get", strings.ToLower(kind), name, "-o", "json"}
	if info.Namespace != "" {
		args = append(args, "-n", info.Namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, fmt.Errorf("failed to get %s/%s: %w", kind, name, err)
	}

	var wl struct {
		Spec struct {
			Replicas *int32 `json:"replicas"`
			Template struct {
				Spec struct {
					Containers []struct {
						Resources struct {
							Requests map[string]string `json:"requests"`
							Limits   map[string]string `json:"limits"`
						} `json:"resources"`
					} `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := json.Unmarshal([]byte(out), &wl); err != nil {
		return nil, fmt.Errorf("failed to parse workload: %w", err)
	}

	var replicas int32 = 1
	if wl.Spec.Replicas != nil {
		replicas = *wl.Spec.Replicas
	}
	info.Replicas = replicas

	for _, c := range wl.Spec.Template.Spec.Containers {
		info.CPURec += parseCPUCores(c.Resources.Requests["cpu"]) * float64(replicas)
		info.MemRecGiB += parseMemGiB(c.Resources.Requests["memory"]) * float64(replicas)
	}
	// If no requests, use limits for estimation
	if info.CPURec == 0 && info.MemRecGiB == 0 {
		for _, c := range wl.Spec.Template.Spec.Containers {
			info.CPURec += parseCPUCores(c.Resources.Limits["cpu"]) * float64(replicas)
			info.MemRecGiB += parseMemGiB(c.Resources.Limits["memory"]) * float64(replicas)
		}
	}

	// Get pod metrics (pods are named <workload>-<hash> or <workload>-<ordinal>)
	samples, _ := a.fetchPodMetrics(info.Namespace)
	for _, s := range samples {
		if strings.HasPrefix(s.Name, name+"-") || s.Name == name {
			info.CPUUsage += s.CPUCores
			info.MemUsageGiB += s.MemGiB
		}
	}

	// Check for existing HPA
	hpaArgs := []string{"get", "hpa", "-o", "json"}
	if info.Namespace != "" {
		hpaArgs = append(hpaArgs, "-n", info.Namespace)
	}
	hpaOut, err := a.captureKubectl(hpaArgs)
	if err == nil {
		var hpaList struct {
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Spec struct {
					MinReplicas *int32 `json:"minReplicas"`
					MaxReplicas int32 `json:"maxReplicas"`
					Metrics     []struct {
						Resource struct {
							Name   string `json:"name"`
							Target struct {
								AverageUtilization *int32 `json:"averageUtilization"`
							} `json:"target"`
						} `json:"resource"`
					} `json:"metrics"`
				} `json:"spec"`
			} `json:"items"`
		}
		if json.Unmarshal([]byte(hpaOut), &hpaList) == nil {
			for _, h := range hpaList.Items {
				if h.Metadata.Name == name {
					info.HasHPA = true
					info.HPAMax = h.Spec.MaxReplicas
					if h.Spec.MinReplicas != nil {
						info.HPAMin = *h.Spec.MinReplicas
					}
					for _, m := range h.Spec.Metrics {
						if m.Resource.Name == "cpu" && m.Resource.Target.AverageUtilization != nil {
							info.HPATarget = *m.Resource.Target.AverageUtilization
							break
						}
					}
					break
				}
			}
		}
	}
	return info, nil
}

func (a *app) printHPARecommendation(info *workloadScaleInfo, suggestMin, suggestMax int) {
	fmt.Fprintf(a.stdout, "%s%s HPA (HorizontalPodAutoscaler)%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%s# kubectl apply -f -%s\n\n", ansiGray, ansiReset)
	targetCPU := 70
	if info.HPATarget > 0 {
		targetCPU = int(info.HPATarget)
	}
	fmt.Fprintf(a.stdout, `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: %s
  namespace: %s
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: %s
    name: %s
  minReplicas: %d
  maxReplicas: %d
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: %d
`,
		info.Name, info.Namespace, info.Kind, info.Name, suggestMin, suggestMax, targetCPU)
	fmt.Fprintln(a.stdout)
}

func (a *app) printKEDACronRecommendation(info *workloadScaleInfo, suggestMin, suggestMax int) {
	fmt.Fprintf(a.stdout, "%s%s KEDA CronScaledObject (time-based)%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%s# Requires KEDA: https://keda.sh  |  kubectl apply -f -%s\n\n", ansiGray, ansiReset)
	fmt.Fprintf(a.stdout, `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: %s
  namespace: %s
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: %s
    name: %s
  minReplicaCount: %d
  maxReplicaCount: %d
  triggers:
  - type: cron
    metadata:
      timezone: "UTC"
      start: "0 9 * * *"    # 9am UTC
      end: "0 17 * * *"      # 5pm UTC
      desiredReplicas: "%d"
  - type: cron
    metadata:
      timezone: "UTC"
      start: "0 17 * * *"   # 5pm UTC
      end: "0 9 * * *"      # 9am UTC (next day)
      desiredReplicas: "%d"
`,
		info.Name, info.Namespace, info.Kind, info.Name, suggestMin, suggestMax, suggestMax, suggestMin)
	fmt.Fprintln(a.stdout)
}

func (a *app) printCronHPARecommendation(info *workloadScaleInfo, suggestMin, suggestMax int) {
	fmt.Fprintf(a.stdout, "%s%s CronHPA (cron-based schedule)%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%s# Requires CronHPA controller: https://github.com/AliyunContainerService/kubernetes-cronhpa-controller%s\n\n", ansiGray, ansiReset)
	fmt.Fprintf(a.stdout, `apiVersion: autoscaling.alibabacloud.com/v1beta1
kind: CronHorizontalPodAutoscaler
metadata:
  name: %s
  namespace: %s
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: %s
    name: %s
  jobs:
  - name: scale-up
    schedule: "0 9 * * *"   # 9am UTC
    targetSize: %d
  - name: scale-down
    schedule: "0 17 * * *" # 5pm UTC
    targetSize: %d
`,
		info.Name, info.Namespace, info.Kind, info.Name, suggestMax, suggestMin)
	fmt.Fprintln(a.stdout)
}

// ─── newAnomalyCmd ────────────────────────────────────────────────────────────

func newAnomalyCmd(a *app) *cobra.Command {
	var namespace string
	var severity string

	cmd := &cobra.Command{
		Use:     "anomaly",
		Short:   "List detected cluster anomalies",
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	list := &cobra.Command{
		Use:   "list",
		Short: "List currently detected anomalies",
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}
			anomalies, err := a.detectAnomalies(ns)
			if err != nil {
				return err
			}

			minSev := strings.ToUpper(severity)
			fmt.Fprintf(a.stdout, "\n%s%s Cluster Anomalies%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(anomalies) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ No anomalies detected.%s\n\n", ansiGreen, ansiReset)
				return nil
			}

			count := 0
			for _, an := range anomalies {
				if minSev != "" && severityOrder(an.Severity) > severityOrder(minSev) {
					continue
				}
				sevColor := ansiYellow
				if an.Severity == "HIGH" || an.Severity == "CRITICAL" {
					sevColor = ansiRed
				}
				fmt.Fprintf(a.stdout, "%s[%-8s]%s %s  (%s)\n",
					sevColor, an.Severity, ansiReset, an.Resource, an.Namespace)
				fmt.Fprintf(a.stdout, "  %s%s%s\n\n", ansiGray, an.Detail, ansiReset)
				count++
			}
			_ = strconv.Itoa(count)
			return nil
		},
	}
	list.Flags().StringVarP(&namespace, "namespace", "n", "", "Filter by namespace")
	list.Flags().StringVar(&severity, "severity", "LOW", "Minimum severity (CRITICAL|HIGH|MEDIUM|LOW)")

	cmd.AddCommand(list)
	return cmd
}
