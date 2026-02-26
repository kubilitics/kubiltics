package cli

// prom.go — kcli prom command group.
//
// Native Prometheus and Loki integration for CLI-based observability.
// Queries Prometheus via HTTP API (auto-detects or uses configured endpoint).
//
// Commands:
//   kcli prom query '<promql>'         — instant PromQL query
//   kcli prom query --graph '<promql>' — query with ASCII sparkline
//   kcli prom alert list [--firing]    — list alerting rules and state
//   kcli prom alert silence <name>     — silence an alert
//   kcli prom targets                  — list scrape targets and health
//   kcli prom rules [--failing]        — show recording/alerting rules

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Prometheus HTTP client ───────────────────────────────────────────────────

type promClient struct {
	baseURL    string
	httpClient *http.Client
}

func newPromClient(baseURL string) *promClient {
	return &promClient{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *promClient) get(path string, params url.Values) ([]byte, error) {
	u := p.baseURL + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	resp, err := p.httpClient.Get(u)
	if err != nil {
		return nil, fmt.Errorf("prometheus request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("prometheus returned %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// ─── Prometheus response types ────────────────────────────────────────────────

type promResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  []interface{}     `json:"value"`
			Values [][]interface{}   `json:"values"`
		} `json:"result"`
	} `json:"data"`
	Error string `json:"error"`
}

type promTargetsResponse struct {
	Status string `json:"status"`
	Data   struct {
		ActiveTargets []struct {
			Labels     map[string]string `json:"labels"`
			ScrapeURL  string            `json:"scrapeUrl"`
			Health     string            `json:"health"`
			LastError  string            `json:"lastError"`
			LastScrape time.Time         `json:"lastScrape"`
		} `json:"activeTargets"`
	} `json:"data"`
}

type promRulesResponse struct {
	Status string `json:"status"`
	Data   struct {
		Groups []struct {
			Name  string `json:"name"`
			Rules []struct {
				Name   string `json:"name"`
				Type   string `json:"type"`
				State  string `json:"state"`
				Health string `json:"health"`
				Query  string `json:"query"`
				Labels map[string]string `json:"labels"`
				Alerts []struct {
					Labels      map[string]string `json:"labels"`
					State       string            `json:"state"`
					ActiveAt    time.Time         `json:"activeAt"`
					Value       string            `json:"value"`
					Annotations map[string]string `json:"annotations"`
				} `json:"alerts"`
			} `json:"rules"`
		} `json:"groups"`
	} `json:"data"`
}

// ─── Prometheus endpoint discovery ────────────────────────────────────────────

// resolvePromEndpoint finds the Prometheus endpoint via config or env or fallback.
func (a *app) resolvePromEndpoint() (string, error) {
	if a.cfg != nil && a.cfg.Integrations.PrometheusEndpoint != "" {
		return a.cfg.Integrations.PrometheusEndpoint, nil
	}
	// Check PROMETHEUS_ENDPOINT env
	if ep := os.Getenv("PROMETHEUS_ENDPOINT"); ep != "" {
		return ep, nil
	}
	// Default: assume localhost:9090 (user may have port-forwarded)
	return "http://localhost:9090", nil
}

// ─── ASCII sparkline ──────────────────────────────────────────────────────────

func asciiSparkline(values []float64, width int) string {
	if len(values) == 0 {
		return ""
	}
	blocks := []string{"▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"}
	minVal, maxVal := values[0], values[0]
	for _, v := range values {
		if v < minVal {
			minVal = v
		}
		if v > maxVal {
			maxVal = v
		}
	}
	diff := maxVal - minVal
	if diff == 0 {
		diff = 1
	}

	// Sample to width
	step := len(values) / width
	if step < 1 {
		step = 1
	}
	var sb strings.Builder
	for i := 0; i < len(values) && sb.Len()/3 < width; i += step {
		idx := int(math.Floor((values[i] - minVal) / diff * float64(len(blocks)-1)))
		if idx < 0 {
			idx = 0
		}
		if idx >= len(blocks) {
			idx = len(blocks) - 1
		}
		sb.WriteString(blocks[idx])
	}
	return sb.String()
}

// ─── kcli prom query ──────────────────────────────────────────────────────────

func newPromQueryCmd(a *app) *cobra.Command {
	var graph bool
	var last string
	var step string

	cmd := &cobra.Command{
		Use:   "query '<promql>'",
		Short: "Execute a PromQL query against Prometheus",
		Args:  cobra.ExactArgs(1),
		Example: `  kcli prom query 'up'
  kcli prom query 'sum(rate(http_requests_total[5m])) by (service)'
  kcli prom query --graph 'node_memory_MemAvailable_bytes' --last=1h
  kcli prom query 'kube_pod_container_resource_requests{resource="cpu"}' | head`,
		RunE: func(cmd *cobra.Command, args []string) error {
			query := args[0]
			endpoint, err := a.resolvePromEndpoint()
			if err != nil {
				return err
			}
			client := newPromClient(endpoint)

			if graph {
				return a.promRangeQuery(client, query, last, step)
			}
			return a.promInstantQuery(client, query)
		},
	}
	cmd.Flags().BoolVar(&graph, "graph", false, "Render ASCII sparkline graph (range query)")
	cmd.Flags().StringVar(&last, "last", "1h", "Time range for --graph (e.g. 15m, 2h, 1d)")
	cmd.Flags().StringVar(&step, "step", "1m", "Step interval for --graph")
	return cmd
}

func (a *app) promInstantQuery(client *promClient, query string) error {
	params := url.Values{"query": {query}, "time": {fmt.Sprintf("%d", time.Now().Unix())}}
	body, err := client.get("/api/v1/query", params)
	if err != nil {
		return fmt.Errorf("prometheus query failed: %w\n\nMake sure Prometheus is reachable at %s\nOr run: kubectl port-forward svc/prometheus-operated 9090:9090 -n monitoring", err, client.baseURL)
	}

	var resp promResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("failed to parse prometheus response: %w", err)
	}
	if resp.Status != "success" {
		return fmt.Errorf("prometheus error: %s", resp.Error)
	}

	fmt.Fprintf(a.stdout, "\n%s%s PromQL Result%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%sQuery: %s%s\n", ansiGray, query, ansiReset)
	fmt.Fprintf(a.stdout, "%sTime: %s%s\n\n", ansiGray, time.Now().Format("2006-01-02 15:04:05 UTC"), ansiReset)

	if len(resp.Data.Result) == 0 {
		fmt.Fprintf(a.stdout, "%s(no results)%s\n\n", ansiGray, ansiReset)
		return nil
	}

	for _, r := range resp.Data.Result {
		// Format labels
		labels := make([]string, 0, len(r.Metric))
		for k, v := range r.Metric {
			if k != "__name__" {
				labels = append(labels, fmt.Sprintf("%s=%q", k, v))
			}
		}
		sort.Strings(labels)

		labelStr := ""
		if len(labels) > 0 {
			labelStr = "{" + strings.Join(labels, ", ") + "}"
		}
		name := r.Metric["__name__"]

		// Value is [timestamp, value_string]
		val := ""
		if len(r.Value) == 2 {
			val = fmt.Sprintf("%v", r.Value[1])
		}

		fmt.Fprintf(a.stdout, "%s%s%s%s\n  %s%s%s\n",
			ansiBold, name, ansiReset,
			ansiGray+labelStr+ansiReset,
			ansiYellow, val, ansiReset,
		)
	}
	fmt.Fprintln(a.stdout)
	return nil
}

func (a *app) promRangeQuery(client *promClient, query, last, step string) error {
	dur, err := time.ParseDuration(last)
	if err != nil {
		return fmt.Errorf("invalid --last duration %q: %w", last, err)
	}
	now := time.Now()
	start := now.Add(-dur)

	params := url.Values{
		"query": {query},
		"start": {fmt.Sprintf("%d", start.Unix())},
		"end":   {fmt.Sprintf("%d", now.Unix())},
		"step":  {step},
	}
	body, err := client.get("/api/v1/query_range", params)
	if err != nil {
		return fmt.Errorf("prometheus range query failed: %w", err)
	}

	var resp promResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("failed to parse prometheus response: %w", err)
	}
	if resp.Status != "success" {
		return fmt.Errorf("prometheus error: %s", resp.Error)
	}

	fmt.Fprintf(a.stdout, "\n%s%s PromQL Trend (last %s)%s\n", ansiBold, ansiCyan, last, ansiReset)
	fmt.Fprintf(a.stdout, "%sQuery: %s%s\n\n", ansiGray, query, ansiReset)

	for _, r := range resp.Data.Result {
		labels := make([]string, 0, len(r.Metric))
		for k, v := range r.Metric {
			if k != "__name__" {
				labels = append(labels, fmt.Sprintf("%s=%s", k, v))
			}
		}
		sort.Strings(labels)
		name := r.Metric["__name__"]
		labelStr := strings.Join(labels, ", ")
		if len(labels) > 0 {
			labelStr = "{" + labelStr + "}"
		}

		// Extract float values for sparkline
		vals := make([]float64, 0, len(r.Values))
		for _, v := range r.Values {
			if len(v) == 2 {
				var f float64
				if s, ok := v[1].(string); ok {
					fmt.Sscanf(s, "%f", &f)
					vals = append(vals, f)
				}
			}
		}

		spark := asciiSparkline(vals, 60)
		minV, maxV := math.MaxFloat64, -math.MaxFloat64
		for _, v := range vals {
			if v < minV {
				minV = v
			}
			if v > maxV {
				maxV = v
			}
		}

		fmt.Fprintf(a.stdout, "%s%s%s%s%s\n",
			ansiBold, name, ansiReset, ansiGray, labelStr+ansiReset)
		fmt.Fprintf(a.stdout, "  %s%s%s\n", ansiCyan, spark, ansiReset)
		if len(vals) > 0 {
			lastVal := vals[len(vals)-1]
			fmt.Fprintf(a.stdout, "  %smin: %.4g  max: %.4g  current: %.4g%s\n\n",
				ansiGray, minV, maxV, lastVal, ansiReset)
		}
	}
	return nil
}

// ─── kcli prom alert ──────────────────────────────────────────────────────────

func newPromAlertCmd(a *app) *cobra.Command {
	alert := &cobra.Command{
		Use:   "alert",
		Short: "Manage Prometheus alerts",
	}

	var firingOnly bool
	list := &cobra.Command{
		Use:   "list",
		Short: "List alerting rules and their current state",
		RunE: func(cmd *cobra.Command, args []string) error {
			endpoint, err := a.resolvePromEndpoint()
			if err != nil {
				return err
			}
			client := newPromClient(endpoint)
			body, err := client.get("/api/v1/rules", url.Values{"type": {"alert"}})
			if err != nil {
				return fmt.Errorf("prometheus rules failed: %w", err)
			}

			var resp promRulesResponse
			if err := json.Unmarshal(body, &resp); err != nil {
				return fmt.Errorf("failed to parse rules: %w", err)
			}

			fmt.Fprintf(a.stdout, "\n%s%s Prometheus Alert Rules%s\n\n", ansiBold, ansiCyan, ansiReset)

			firing := 0
			for _, group := range resp.Data.Groups {
				for _, rule := range group.Rules {
					if rule.Type != "alerting" {
						continue
					}
					if firingOnly && rule.State != "firing" {
						continue
					}
					stateColor := ansiGreen
					stateSymbol := "●"
					switch rule.State {
					case "firing":
						stateColor = ansiRed
						stateSymbol = "🔴"
						firing++
					case "pending":
						stateColor = ansiYellow
						stateSymbol = "🟡"
					}
					fmt.Fprintf(a.stdout, "%s%s%s %-40s  %s[%s]%s\n",
						stateColor, stateSymbol, ansiReset,
						rule.Name,
						stateColor, strings.ToUpper(rule.State), ansiReset,
					)
					for _, al := range rule.Alerts {
						if al.State == "firing" {
							fmt.Fprintf(a.stdout, "   %s↳ %v%s\n", ansiRed, al.Labels, ansiReset)
						}
					}
				}
			}
			if firing > 0 {
				fmt.Fprintf(a.stdout, "\n%s%d alert(s) firing%s\n", ansiRed+ansiBold, firing, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "\n%s✓ No alerts firing%s\n", ansiGreen, ansiReset)
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}
	list.Flags().BoolVar(&firingOnly, "firing", false, "Show only firing alerts")

	silence := &cobra.Command{
		Use:   "silence <alert-name>",
		Short: "Silence a Prometheus alert via Alertmanager",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintf(a.stdout, "%s⚠ Alert silencing requires Alertmanager access.%s\n\n", ansiYellow, ansiReset)
			fmt.Fprintf(a.stdout, "To silence via Alertmanager API:\n")
			fmt.Fprintf(a.stdout, "  kubectl port-forward svc/alertmanager 9093:9093 -n monitoring\n")
			fmt.Fprintf(a.stdout, "  Then run:\n")
			fmt.Fprintf(a.stdout, "  curl -X POST http://localhost:9093/api/v1/silences \\\n")
			fmt.Fprintf(a.stdout, "    -H 'Content-Type: application/json' \\\n")
			fmt.Fprintf(a.stdout, "    -d '{\"matchers\":[{\"name\":\"alertname\",\"value\":\"%s\",\"isRegex\":false}],\"startsAt\":\"now\",\"endsAt\":\"now+2h\",\"comment\":\"silenced by kcli\",\"createdBy\":\"kcli\"}'\n\n",
				args[0])
			return nil
		},
	}

	alert.AddCommand(list, silence)
	return alert
}

// ─── kcli prom targets ────────────────────────────────────────────────────────

func newPromTargetsCmd(a *app) *cobra.Command {
	var unhealthyOnly bool
	cmd := &cobra.Command{
		Use:   "targets",
		Short: "List Prometheus scrape targets and their health",
		RunE: func(cmd *cobra.Command, args []string) error {
			endpoint, err := a.resolvePromEndpoint()
			if err != nil {
				return err
			}
			client := newPromClient(endpoint)
			body, err := client.get("/api/v1/targets", nil)
			if err != nil {
				return fmt.Errorf("prometheus targets failed: %w", err)
			}

			var resp promTargetsResponse
			if err := json.Unmarshal(body, &resp); err != nil {
				return fmt.Errorf("failed to parse targets: %w", err)
			}

			fmt.Fprintf(a.stdout, "\n%s%s Prometheus Scrape Targets%s\n\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "%s%-50s %-10s %-20s %s%s\n",
				ansiBold, "TARGET", "HEALTH", "LAST SCRAPE", "JOB", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 90))

			healthy, unhealthy := 0, 0
			for _, t := range resp.Data.ActiveTargets {
				if unhealthyOnly && t.Health == "up" {
					continue
				}
				hColor := ansiGreen
				if t.Health != "up" {
					hColor = ansiRed
					unhealthy++
				} else {
					healthy++
				}
				age := time.Since(t.LastScrape).Truncate(time.Second)
				job := t.Labels["job"]
				fmt.Fprintf(a.stdout, "%-50s %s%-10s%s %-20s %s\n",
					truncate(t.ScrapeURL, 50),
					hColor, t.Health, ansiReset,
					age.String(),
					job,
				)
				if t.Health != "up" && t.LastError != "" {
					fmt.Fprintf(a.stdout, "  %s↳ Error: %s%s\n", ansiRed, truncate(t.LastError, 70), ansiReset)
				}
			}
			fmt.Fprintf(a.stdout, "\n%sTargets: %s%d up%s  %s%d down%s%s\n\n",
				ansiGray,
				ansiGreen, healthy, ansiReset,
				ansiRed, unhealthy, ansiReset, ansiGray+ansiReset,
			)
			return nil
		},
	}
	cmd.Flags().BoolVar(&unhealthyOnly, "unhealthy", false, "Show only unhealthy targets")
	return cmd
}

// ─── kcli prom rules ──────────────────────────────────────────────────────────

func newPromRulesCmd(a *app) *cobra.Command {
	var failingOnly bool
	var ruleType string
	cmd := &cobra.Command{
		Use:   "rules",
		Short: "List Prometheus recording and alerting rules",
		RunE: func(cmd *cobra.Command, args []string) error {
			endpoint, err := a.resolvePromEndpoint()
			if err != nil {
				return err
			}
			client := newPromClient(endpoint)
			params := url.Values{}
			if ruleType != "" {
				params.Set("type", ruleType)
			}
			body, err := client.get("/api/v1/rules", params)
			if err != nil {
				return fmt.Errorf("prometheus rules failed: %w", err)
			}

			var resp promRulesResponse
			if err := json.Unmarshal(body, &resp); err != nil {
				return fmt.Errorf("failed to parse rules: %w", err)
			}

			fmt.Fprintf(a.stdout, "\n%s%s Prometheus Rules%s\n\n", ansiBold, ansiCyan, ansiReset)

			for _, group := range resp.Data.Groups {
				groupPrinted := false
				for _, rule := range group.Rules {
					if failingOnly && rule.Health == "ok" {
						continue
					}
					if !groupPrinted {
						fmt.Fprintf(a.stdout, "%s[Group: %s]%s\n", ansiBold, group.Name, ansiReset)
						groupPrinted = true
					}
					typeColor := ansiCyan
					if rule.Type == "alerting" {
						typeColor = ansiYellow
					}
					healthColor := ansiGreen
					if rule.Health != "ok" {
						healthColor = ansiRed
					}
					fmt.Fprintf(a.stdout, "  %s%-12s%s %-40s  %s%s%s\n",
						typeColor, rule.Type, ansiReset,
						rule.Name,
						healthColor, rule.Health, ansiReset,
					)
					if rule.Health != "ok" {
						fmt.Fprintf(a.stdout, "    %sQuery: %s%s\n", ansiGray, truncate(rule.Query, 70), ansiReset)
					}
				}
				if groupPrinted {
					fmt.Fprintln(a.stdout)
				}
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&failingOnly, "failing", false, "Show only failing rules")
	cmd.Flags().StringVar(&ruleType, "type", "", "Filter by rule type (alert|record)")
	return cmd
}

// ─── kcli prom (parent) ───────────────────────────────────────────────────────

func newPromCmd(a *app) *cobra.Command {
	var endpoint string

	cmd := &cobra.Command{
		Use:   "prom",
		Short: "Prometheus PromQL queries, alerts, and targets from the CLI",
		Long: `kcli prom lets you query Prometheus, inspect alerts, and view scrape targets
directly from the terminal without opening Grafana.

Auto-discovers Prometheus at localhost:9090. Configure with:
  kcli config set prometheus.endpoint http://prometheus.monitoring.svc:9090
  export PROMETHEUS_ENDPOINT=http://localhost:9090

For in-cluster access, port-forward first:
  kubectl port-forward svc/prometheus-operated 9090:9090 -n monitoring`,
		GroupID: "observability",
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if endpoint != "" && a.cfg != nil {
				a.cfg.Integrations.PrometheusEndpoint = endpoint
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}
	cmd.PersistentFlags().StringVar(&endpoint, "endpoint", "", "Prometheus endpoint URL (overrides config)")

	cmd.AddCommand(
		newPromQueryCmd(a),
		newPromAlertCmd(a),
		newPromTargetsCmd(a),
		newPromRulesCmd(a),
	)
	return cmd
}
