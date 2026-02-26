package cli

// cost.go — kcli cost command group.
//
// Provides instant cost visibility without a paid Kubecost installation.
// Uses resource requests from the cluster to compute per-namespace estimates
// based on configurable cloud pricing (default: AWS us-east-1 on-demand).
//
// Commands:
//   kcli cost overview          — cluster-wide cost summary with top namespaces
//   kcli cost namespace         — per-namespace breakdown with workloads
//   kcli cost optimize          — recommendations: over-provisioned, idle, limit-free
//
// Pricing model (overridable via flags):
//   CPU:    $0.048 per vCPU-hour  (AWS m5.large on-demand equivalent)
//   Memory: $0.006 per GiB-hour   (AWS m5.large on-demand equivalent)
//
// The estimates are directional — exact costs depend on node type, savings plans,
// and actual utilization vs requests. The goal is actionable visibility, not billing accuracy.

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// Default pricing: AWS us-east-1 on-demand m5.large equivalent
const (
	defaultCPUPricePerCoreHour float64 = 0.048 // $/vCPU-hour
	defaultMemPricePerGiBHour  float64 = 0.006 // $/GiB-hour
	hoursPerMonth              float64 = 730.0  // avg hours/month
)

// ─── Kubernetes API types for cost analysis ───────────────────────────────────

type k8sResourceList struct {
	Items []k8sResourceItem `json:"items"`
}

type k8sResourceItem struct {
	Metadata struct {
		Name      string            `json:"name"`
		Namespace string            `json:"namespace"`
		Labels    map[string]string `json:"labels"`
	} `json:"metadata"`
	Spec struct {
		Containers     []k8sContainer `json:"containers"`
		InitContainers []k8sContainer `json:"initContainers"`
		NodeName       string         `json:"nodeName"`
		NodeSelector   map[string]string `json:"nodeSelector"`
	} `json:"spec"`
	Status struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type k8sContainer struct {
	Name      string                `json:"name"`
	Resources k8sResourceRequirements `json:"resources"`
}

type k8sResourceRequirements struct {
	Requests map[string]string `json:"requests"`
	Limits   map[string]string `json:"limits"`
}

// ─── Cost data structures ─────────────────────────────────────────────────────

type containerCostEntry struct {
	Namespace   string
	Workload    string
	Container   string
	CPURequest  float64 // cores
	MemRequest  float64 // GiB
	CPULimit    float64 // cores (0 = no limit)
	MemLimit    float64 // GiB (0 = no limit)
	HourlyCost  float64
	MonthlyCost float64
	HasNoLimits bool
}

type namespaceCostSummary struct {
	Namespace   string
	PodCount    int
	CPURequest  float64
	MemRequest  float64
	HourlyCost  float64
	MonthlyCost float64
}

// ─── CPU/Memory parsing utilities ─────────────────────────────────────────────

// parseCPUCores converts a Kubernetes CPU quantity string to float64 cores.
// Handles: "100m" (millicores), "1", "1.5", "2000m"
func parseCPUCores(q string) float64 {
	if q == "" {
		return 0
	}
	q = strings.TrimSpace(q)
	if strings.HasSuffix(q, "m") {
		millis, err := strconv.ParseFloat(strings.TrimSuffix(q, "m"), 64)
		if err != nil {
			return 0
		}
		return millis / 1000.0
	}
	cores, err := strconv.ParseFloat(q, 64)
	if err != nil {
		return 0
	}
	return cores
}

// parseMemGiB converts a Kubernetes memory quantity string to float64 GiB.
// Handles: "128Mi", "1Gi", "512M", "1G", "1024Ki", plain bytes
func parseMemGiB(q string) float64 {
	if q == "" {
		return 0
	}
	q = strings.TrimSpace(q)

	multipliers := []struct {
		suffix string
		factor float64
	}{
		{"Ki", 1.0 / (1024 * 1024)},
		{"Mi", 1.0 / 1024},
		{"Gi", 1.0},
		{"Ti", 1024.0},
		{"Pi", 1024 * 1024},
		{"K", 1.0 / (1000 * 1024)},
		{"M", 1.0 / 1024 * (1000.0 / 1024.0)},
		{"G", 1000.0 / 1024.0},
		{"T", 1000.0 * 1000.0 / 1024.0 / 1024.0},
	}

	for _, m := range multipliers {
		if strings.HasSuffix(q, m.suffix) {
			val, err := strconv.ParseFloat(strings.TrimSuffix(q, m.suffix), 64)
			if err != nil {
				return 0
			}
			return val * m.factor
		}
	}

	// Plain bytes
	bytes, err := strconv.ParseFloat(q, 64)
	if err != nil {
		return 0
	}
	return bytes / (1024 * 1024 * 1024)
}

// computeHourlyCost returns the hourly cost for a given CPU/memory request.
func computeHourlyCost(cpuCores, memGiB, cpuPrice, memPrice float64) float64 {
	return cpuCores*cpuPrice + memGiB*memPrice
}

// ─── Data fetching ─────────────────────────────────────────────────────────────

// fetchCostData retrieves all pods (or namespace-scoped) and computes cost entries.
func (a *app) fetchCostData(namespace string, cpuPrice, memPrice float64) ([]containerCostEntry, error) {
	args := []string{"get", "pods", "-o", "json"}
	if namespace != "" && namespace != "all" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}

	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %w", err)
	}

	var podList k8sResourceList
	if err := json.Unmarshal([]byte(out), &podList); err != nil {
		return nil, fmt.Errorf("failed to parse pod list: %w", err)
	}

	var entries []containerCostEntry
	for _, pod := range podList.Items {
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue // skip completed pods
		}
		ns := pod.Metadata.Namespace
		podName := pod.Metadata.Name

		for _, c := range pod.Spec.Containers {
			cpuReq := parseCPUCores(c.Resources.Requests["cpu"])
			memReq := parseMemGiB(c.Resources.Requests["memory"])
			cpuLim := parseCPUCores(c.Resources.Limits["cpu"])
			memLim := parseMemGiB(c.Resources.Limits["memory"])

			hourly := computeHourlyCost(cpuReq, memReq, cpuPrice, memPrice)
			entry := containerCostEntry{
				Namespace:   ns,
				Workload:    podName,
				Container:   c.Name,
				CPURequest:  cpuReq,
				MemRequest:  memReq,
				CPULimit:    cpuLim,
				MemLimit:    memLim,
				HourlyCost:  hourly,
				MonthlyCost: hourly * hoursPerMonth,
				HasNoLimits: (c.Resources.Limits == nil || (c.Resources.Limits["cpu"] == "" && c.Resources.Limits["memory"] == "")),
			}
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

// aggregateByNamespace groups cost entries by namespace.
func aggregateByNamespace(entries []containerCostEntry) []namespaceCostSummary {
	byNS := make(map[string]*namespaceCostSummary)
	for _, e := range entries {
		ns, ok := byNS[e.Namespace]
		if !ok {
			ns = &namespaceCostSummary{Namespace: e.Namespace}
			byNS[e.Namespace] = ns
		}
		ns.CPURequest += e.CPURequest
		ns.MemRequest += e.MemRequest
		ns.HourlyCost += e.HourlyCost
		ns.MonthlyCost += e.MonthlyCost
		ns.PodCount++
	}

	result := make([]namespaceCostSummary, 0, len(byNS))
	for _, ns := range byNS {
		result = append(result, *ns)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].MonthlyCost > result[j].MonthlyCost
	})
	return result
}

// ─── P1-9: OpenCost integration ───────────────────────────────────────────────

// opencostResponse is the top-level structure returned by the OpenCost
// /model/allocation API.
type opencostResponse struct {
	Code int                              `json:"code"`
	Data []map[string]opencostAllocation  `json:"data"`
}

// opencostAllocation contains per-namespace billing data from OpenCost.
type opencostAllocation struct {
	CPUCost        float64 `json:"cpuCost"`
	MemoryCost     float64 `json:"memoryCost"`
	NetworkCost    float64 `json:"networkCost"`
	StorageCost    float64 `json:"storageCost"`
	TotalCost      float64 `json:"totalCost"`
	CPUCoreHours   float64 `json:"cpuCoreHours"`
	RAMByteHours   float64 `json:"ramByteHours"`
}

// detectOpenCostEndpoint returns the OpenCost base URL to use.
//
// Priority:
//  1. integrations.opencostEndpoint from ~/.kcli/config.yaml
//  2. OPENCOST_ENDPOINT environment variable
//  3. Auto-detected from cluster: if `kubectl get svc opencost -n opencost`
//     succeeds, returns http://<clusterIP>:9090
//
// Returns "" if OpenCost is not configured or not found in the cluster.
func (a *app) detectOpenCostEndpoint() string {
	// 1. Config file
	if a.cfg != nil && strings.TrimSpace(a.cfg.Integrations.OpenCostEndpoint) != "" {
		return strings.TrimRight(strings.TrimSpace(a.cfg.Integrations.OpenCostEndpoint), "/")
	}

	// 2. Environment variable
	if ep := strings.TrimSpace(os.Getenv("OPENCOST_ENDPOINT")); ep != "" {
		return strings.TrimRight(ep, "/")
	}

	// 3. Auto-detect via kubectl
	// Try to get the OpenCost service and extract its ClusterIP.
	out, err := a.captureKubectl([]string{
		"get", "svc", "opencost", "-n", "opencost",
		"--ignore-not-found",
		"-o", "jsonpath={.spec.clusterIP}:{.spec.ports[0].port}",
	})
	if err != nil {
		return ""
	}
	out = strings.TrimSpace(out)
	if out == "" || out == "<none>:<none>" || out == ":" {
		return ""
	}
	// out is "<clusterIP>:<port>" e.g. "10.96.100.5:9090"
	parts := strings.SplitN(out, ":", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		return ""
	}
	ip := strings.TrimSpace(parts[0])
	port := strings.TrimSpace(parts[1])
	if port == "" {
		port = "9090"
	}
	return "http://" + ip + ":" + port
}

// enrichPodCounts populates PodCount for each namespace in byNS using kubectl.
// Used when OpenCost data is shown (allocation API does not include pod counts).
func (a *app) enrichPodCounts(byNS []namespaceCostSummary) {
	out, err := a.captureKubectl([]string{
		"get", "pods", "-A", "--no-headers",
		"-o", "custom-columns=NAMESPACE:.metadata.namespace",
	})
	if err != nil {
		return
	}
	countByNS := make(map[string]int)
	for _, line := range strings.Split(out, "\n") {
		ns := strings.TrimSpace(line)
		if ns != "" {
			countByNS[ns]++
		}
	}
	for i := range byNS {
		byNS[i].PodCount = countByNS[byNS[i].Namespace]
	}
}

// fetchOpenCostData calls the OpenCost /model/allocation API and returns
// namespace-level cost summaries for the last 24 hours.
// Returns (summaries, nil) on success, or (nil, err) on any failure.
// Callers should fall back to request-based estimates on error.
func fetchOpenCostData(endpoint string) ([]namespaceCostSummary, error) {
	url := endpoint + "/model/allocation?window=1d&aggregate=namespace&accumulate=true"
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(url) //nolint:noctx
	if err != nil {
		return nil, fmt.Errorf("opencost unreachable at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("opencost response read error: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("opencost returned HTTP %d", resp.StatusCode)
	}
	var ocResp opencostResponse
	if err := json.Unmarshal(body, &ocResp); err != nil {
		return nil, fmt.Errorf("opencost response parse error: %w", err)
	}
	if ocResp.Code != 200 || len(ocResp.Data) == 0 {
		return nil, fmt.Errorf("opencost returned no data (code=%d)", ocResp.Code)
	}

	// Accumulate across all time buckets (there should be just one with accumulate=true).
	totals := map[string]*namespaceCostSummary{}
	for _, bucket := range ocResp.Data {
		for ns, alloc := range bucket {
			if ns == "__unallocated__" || ns == "__idle__" {
				continue
			}
			s, ok := totals[ns]
			if !ok {
				s = &namespaceCostSummary{Namespace: ns}
				totals[ns] = s
			}
			s.MonthlyCost += alloc.TotalCost * 30 // window=1d → scale to month
			s.HourlyCost += alloc.TotalCost / 24
			// Approximate CPU/Mem from core-hours / byte-hours (1d window)
			s.CPURequest += alloc.CPUCoreHours / 24
			s.MemRequest += alloc.RAMByteHours / 24 / 1073741824 // bytes → GiB
		}
	}

	result := make([]namespaceCostSummary, 0, len(totals))
	for _, s := range totals {
		result = append(result, *s)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].MonthlyCost > result[j].MonthlyCost
	})
	return result, nil
}

// ─── ANSI color helpers (vars from ansi.go; empty when ColorDisabled) ─────────

func colorCost(cost float64) string {
	if cost > 1000 {
		return ansiRed + fmt.Sprintf("$%.2f", cost) + ansiReset
	} else if cost > 200 {
		return ansiYellow + fmt.Sprintf("$%.2f", cost) + ansiReset
	}
	return ansiGreen + fmt.Sprintf("$%.2f", cost) + ansiReset
}

func roundTo(val float64, places int) float64 {
	pow := math.Pow(10, float64(places))
	return math.Round(val*pow) / pow
}

// ─── kcli cost overview ───────────────────────────────────────────────────────

func newCostOverviewCmd(a *app) *cobra.Command {
	var cpuPrice float64
	var memPrice float64
	var top int
	var jsonOut bool

	cmd := &cobra.Command{
		Use:     "overview",
		Short:   "Cluster-wide cost estimate with namespace breakdown",
		Aliases: []string{"ov", "summary"},
		Example: `  # Show cost overview with default AWS us-east-1 pricing
  kcli cost overview

  # Use custom pricing (GCP us-central1)
  kcli cost overview --cpu-price 0.031611 --mem-price 0.004237

  # Show top 5 namespaces only
  kcli cost overview --top 5

  # JSON output for scripting
  kcli cost overview -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			// P1-9: Try OpenCost first for actual-usage billing data.
			// Falls back to request-based estimates if OpenCost is unavailable.
			dataSource := "Request-based estimate"
			var byNS []namespaceCostSummary
			var totalEntryCount int

			ocEndpoint := a.detectOpenCostEndpoint()
			if ocEndpoint != "" {
				ocData, ocErr := fetchOpenCostData(ocEndpoint)
				if ocErr == nil && len(ocData) > 0 {
					byNS = ocData
					a.enrichPodCounts(byNS)
					dataSource = "OpenCost (actual usage)"
					for _, ns := range byNS {
						totalEntryCount += ns.PodCount
					}
				} else if ocErr != nil {
					// OpenCost was detected but API call failed — show a soft warning.
					fmt.Fprintf(a.stdout, "%s[warn] OpenCost detected but unreachable (%v); using request-based estimates%s\n\n",
						ansiGray, ocErr, ansiReset)
				}
			}

			// Fall back to request-based estimates.
			if byNS == nil {
				entries, err := a.fetchCostData("", cpuPrice, memPrice)
				if err != nil {
					return err
				}
				byNS = aggregateByNamespace(entries)
				totalEntryCount = len(entries)
			}

			totalCPU := 0.0
			totalMem := 0.0
			totalMonthly := 0.0
			for _, ns := range byNS {
				totalCPU += ns.CPURequest
				totalMem += ns.MemRequest
				totalMonthly += ns.MonthlyCost
			}

			if jsonOut {
				type jsonNS struct {
					Namespace      string  `json:"namespace"`
					PodCount       int     `json:"pod_count"`
					CPUCores       float64 `json:"cpu_cores_requested"`
					MemGiB         float64 `json:"mem_gib_requested"`
					MonthlyCostUSD float64 `json:"monthly_cost_usd"`
				}
				type jsonOverview struct {
					DataSource          string   `json:"data_source"`
					TotalMonthlyCostUSD float64  `json:"total_monthly_cost_usd"`
					TotalCPUCores       float64  `json:"total_cpu_cores"`
					TotalMemGiB         float64  `json:"total_mem_gib"`
					Namespaces          []jsonNS `json:"namespaces"`
				}
				nsRows := make([]jsonNS, 0, len(byNS))
				limit := len(byNS)
				if top > 0 && top < limit {
					limit = top
				}
				for _, ns := range byNS[:limit] {
					nsRows = append(nsRows, jsonNS{
						Namespace:      ns.Namespace,
						PodCount:       ns.PodCount,
						CPUCores:       roundTo(ns.CPURequest, 3),
						MemGiB:         roundTo(ns.MemRequest, 2),
						MonthlyCostUSD: roundTo(ns.MonthlyCost, 2),
					})
				}
				overview := jsonOverview{
					DataSource:          dataSource,
					TotalMonthlyCostUSD: roundTo(totalMonthly, 2),
					TotalCPUCores:       roundTo(totalCPU, 3),
					TotalMemGiB:         roundTo(totalMem, 2),
					Namespaces:          nsRows,
				}
				b, _ := json.MarshalIndent(overview, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			// Pretty output
			fmt.Fprintf(a.stdout, "\n%s%s Cluster Cost Overview%s\n", ansiBold, ansiCyan, ansiReset)
			if dataSource == "OpenCost (actual usage)" {
				fmt.Fprintf(a.stdout, "%sSource: OpenCost (actual usage) · %s%s\n\n",
					ansiGreen, ocEndpoint, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "%sSource: Request-based estimate · CPU $%.4f/vCPU-hr · Memory $%.4f/GiB-hr%s\n\n",
					ansiGray, cpuPrice, memPrice, ansiReset)
			}

			fmt.Fprintf(a.stdout, "%s%-30s  %8s  %8s  %8s  %14s%s\n",
				ansiBold, "NAMESPACE", "PODS", "CPU(req)", "MEM(req)", "MONTHLY COST", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 78))

			limit := len(byNS)
			if top > 0 && top < limit {
				limit = top
			}
			for _, ns := range byNS[:limit] {
				fmt.Fprintf(a.stdout, "%-30s  %8d  %7.2fv  %6.1fGi  %s\n",
					ns.Namespace,
					ns.PodCount,
					ns.CPURequest,
					ns.MemRequest,
					colorCost(ns.MonthlyCost),
				)
			}

			if top > 0 && top < len(byNS) {
				remaining := len(byNS) - top
				restCost := totalMonthly
				for _, ns := range byNS[:top] {
					restCost -= ns.MonthlyCost
				}
				fmt.Fprintf(a.stdout, "%s... %d more namespaces (%s/month)%s\n",
					ansiGray, remaining, colorCost(restCost), ansiReset)
			}

			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 78))
			fmt.Fprintf(a.stdout, "%s%-30s  %8d  %7.2fv  %6.1fGi  %s%s\n",
				ansiBold, "TOTAL",
				totalEntryCount,
				totalCPU,
				totalMem,
				colorCost(totalMonthly),
				ansiReset,
			)

			// Annualized / disclaimer
			fmt.Fprintf(a.stdout, "\n%sEstimated annual spend: %s%s\n",
				ansiGray, colorCost(totalMonthly*12), ansiReset)
			if dataSource != "OpenCost (actual usage)" {
				fmt.Fprintf(a.stdout, "%s(Request-based estimates. For actual billing data install OpenCost: https://www.opencost.io)%s\n\n",
					ansiGray, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "%s(OpenCost actual usage — 24h window, scaled to monthly)%s\n\n",
					ansiGray, ansiReset)
			}

			return nil
		},
	}

	cmd.Flags().Float64Var(&cpuPrice, "cpu-price", defaultCPUPricePerCoreHour, "CPU price per vCPU-hour in USD")
	cmd.Flags().Float64Var(&memPrice, "mem-price", defaultMemPricePerGiBHour, "Memory price per GiB-hour in USD")
	cmd.Flags().IntVar(&top, "top", 10, "Show top N namespaces (0 = all)")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli cost namespace ──────────────────────────────────────────────────────

func newCostNamespaceCmd(a *app) *cobra.Command {
	var cpuPrice float64
	var memPrice float64
	var jsonOut bool

	cmd := &cobra.Command{
		Use:     "namespace [NAMESPACE]",
		Short:   "Per-namespace cost breakdown with top workloads",
		Aliases: []string{"ns"},
		Args:    cobra.MaximumNArgs(1),
		Example: `  # Show cost for the default namespace
  kcli cost namespace

  # Show cost for a specific namespace
  kcli cost namespace production

  # JSON output
  kcli cost namespace production -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := a.namespace
			if len(args) > 0 {
				ns = args[0]
			}
			if ns == "" {
				ns = "default"
			}

			entries, err := a.fetchCostData(ns, cpuPrice, memPrice)
			if err != nil {
				return err
			}

			// Aggregate by workload (strip pod hash suffix to get workload name)
			type workloadCost struct {
				Name        string
				ContainerCount int
				CPURequest  float64
				MemRequest  float64
				MonthlyCost float64
				HasNoLimits bool
			}

			byWorkload := make(map[string]*workloadCost)
			for _, e := range entries {
				// Strip ReplicaSet/Job hash from pod name to get deployment name
				wname := stripPodHash(e.Workload)
				w, ok := byWorkload[wname]
				if !ok {
					w = &workloadCost{Name: wname}
					byWorkload[wname] = w
				}
				w.ContainerCount++
				w.CPURequest += e.CPURequest
				w.MemRequest += e.MemRequest
				w.MonthlyCost += e.MonthlyCost
				if e.HasNoLimits {
					w.HasNoLimits = true
				}
			}

			workloads := make([]workloadCost, 0, len(byWorkload))
			for _, w := range byWorkload {
				workloads = append(workloads, *w)
			}
			sort.Slice(workloads, func(i, j int) bool {
				return workloads[i].MonthlyCost > workloads[j].MonthlyCost
			})

			totalMonthly := 0.0
			totalCPU := 0.0
			totalMem := 0.0
			for _, w := range workloads {
				totalMonthly += w.MonthlyCost
				totalCPU += w.CPURequest
				totalMem += w.MemRequest
			}

			if jsonOut {
				type jsonWorkload struct {
					Name           string  `json:"name"`
					ContainerCount int     `json:"container_count"`
					CPUCores       float64 `json:"cpu_cores_requested"`
					MemGiB         float64 `json:"mem_gib_requested"`
					MonthlyCostUSD float64 `json:"monthly_cost_usd"`
					HasNoLimits    bool    `json:"has_no_limits,omitempty"`
				}
				type jsonResult struct {
					Namespace      string         `json:"namespace"`
					TotalMonthlyCostUSD float64  `json:"total_monthly_cost_usd"`
					Workloads      []jsonWorkload `json:"workloads"`
				}
				ws := make([]jsonWorkload, 0, len(workloads))
				for _, w := range workloads {
					ws = append(ws, jsonWorkload{
						Name:           w.Name,
						ContainerCount: w.ContainerCount,
						CPUCores:       roundTo(w.CPURequest, 3),
						MemGiB:         roundTo(w.MemRequest, 2),
						MonthlyCostUSD: roundTo(w.MonthlyCost, 2),
						HasNoLimits:    w.HasNoLimits,
					})
				}
				out := jsonResult{
					Namespace:           ns,
					TotalMonthlyCostUSD: roundTo(totalMonthly, 2),
					Workloads:           ws,
				}
				b, _ := json.MarshalIndent(out, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s Cost Breakdown: %s%s%s\n",
				ansiBold, ansiCyan, ansiYellow, ns, ansiReset)
			fmt.Fprintf(a.stdout, "%sPricing: CPU $%.4f/vCPU-hr · Memory $%.4f/GiB-hr%s\n\n",
				ansiGray, cpuPrice, memPrice, ansiReset)

			fmt.Fprintf(a.stdout, "%s%-40s  %10s  %8s  %8s  %14s%s\n",
				ansiBold, "WORKLOAD", "CONTAINERS", "CPU(req)", "MEM(req)", "MONTHLY COST", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 86))

			for _, w := range workloads {
				flags := ""
				if w.HasNoLimits {
					flags = ansiYellow + " ⚠ no limits" + ansiReset
				}
				fmt.Fprintf(a.stdout, "%-40s  %10d  %7.2fv  %6.1fGi  %s%s\n",
					truncate(w.Name, 40),
					w.ContainerCount,
					w.CPURequest,
					w.MemRequest,
					colorCost(w.MonthlyCost),
					flags,
				)
			}

			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 86))
			fmt.Fprintf(a.stdout, "%s%-40s  %10d  %7.2fv  %6.1fGi  %s%s\n",
				ansiBold, "TOTAL",
				len(entries),
				totalCPU, totalMem,
				colorCost(totalMonthly),
				ansiReset,
			)
			fmt.Fprintf(a.stdout, "\n%s(Estimates based on resource requests)%s\n\n", ansiGray, ansiReset)

			return nil
		},
	}

	cmd.Flags().Float64Var(&cpuPrice, "cpu-price", defaultCPUPricePerCoreHour, "CPU price per vCPU-hour in USD")
	cmd.Flags().Float64Var(&memPrice, "mem-price", defaultMemPricePerGiBHour, "Memory price per GiB-hour in USD")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli cost optimize ───────────────────────────────────────────────────────

func newCostOptimizeCmd(a *app) *cobra.Command {
	var cpuPrice float64
	var memPrice float64
	var jsonOut bool
	var minWaste float64

	cmd := &cobra.Command{
		Use:     "optimize",
		Short:   "Find over-provisioned and limit-free workloads for cost savings",
		Aliases: []string{"opt", "savings"},
		Example: `  # Find optimization opportunities
  kcli cost optimize

  # Only show workloads wasting more than $50/month
  kcli cost optimize --min-waste 50

  # JSON output for CI/CD integration
  kcli cost optimize -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			entries, err := a.fetchCostData("", cpuPrice, memPrice)
			if err != nil {
				return err
			}

			type Finding struct {
				Namespace   string  `json:"namespace"`
				Workload    string  `json:"workload"`
				Container   string  `json:"container"`
				Issue       string  `json:"issue"`
				Detail      string  `json:"detail"`
				PotentialSavings float64 `json:"potential_savings_usd_monthly,omitempty"`
			}

			var findings []Finding

			for _, e := range entries {
				// No resource limits — risk of memory/CPU starvation for neighbors
				if e.HasNoLimits {
					findings = append(findings, Finding{
						Namespace: e.Namespace,
						Workload:  e.Workload,
						Container: e.Container,
						Issue:     "no-limits",
						Detail:    "Container has no CPU or memory limits — can starve other workloads",
					})
				}

				// No CPU request — scheduler can't make informed decisions
				if e.CPURequest == 0 {
					findings = append(findings, Finding{
						Namespace: e.Namespace,
						Workload:  e.Workload,
						Container: e.Container,
						Issue:     "no-cpu-request",
						Detail:    "Container has no CPU request — QoS class is BestEffort (first to be evicted)",
					})
				}

				// No memory request
				if e.MemRequest == 0 {
					findings = append(findings, Finding{
						Namespace: e.Namespace,
						Workload:  e.Workload,
						Container: e.Container,
						Issue:     "no-mem-request",
						Detail:    "Container has no memory request — BestEffort QoS, high eviction risk",
					})
				}

				// Limit >> Request ratio: over-provisioned limit (limit > 4x request)
				if e.CPULimit > 0 && e.CPURequest > 0 && e.CPULimit > 4*e.CPURequest {
					wastedCPU := e.CPULimit - e.CPURequest
					savings := wastedCPU * cpuPrice * hoursPerMonth * 0.5 // assume 50% reclamation
					if savings >= minWaste {
						findings = append(findings, Finding{
							Namespace:        e.Namespace,
							Workload:         e.Workload,
							Container:        e.Container,
							Issue:            "cpu-limit-spike",
							Detail:           fmt.Sprintf("CPU limit (%.2fv) is %.1fx the request (%.2fv) — consider reducing limit", e.CPULimit, e.CPULimit/e.CPURequest, e.CPURequest),
							PotentialSavings: roundTo(savings, 2),
						})
					}
				}

				// Large memory request with no limit — likely over-provisioned
				if e.MemRequest > 4 && e.MemLimit == 0 {
					savings := e.MemRequest * 0.5 * memPrice * hoursPerMonth // assume 50% reclamation
					if savings >= minWaste {
						findings = append(findings, Finding{
							Namespace:        e.Namespace,
							Workload:         e.Workload,
							Container:        e.Container,
							Issue:            "large-mem-no-limit",
							Detail:           fmt.Sprintf("Container requests %.1fGi memory with no limit — likely over-provisioned", e.MemRequest),
							PotentialSavings: roundTo(savings, 2),
						})
					}
				}
			}

			// Sort: savings desc, then by namespace
			sort.Slice(findings, func(i, j int) bool {
				if findings[i].PotentialSavings != findings[j].PotentialSavings {
					return findings[i].PotentialSavings > findings[j].PotentialSavings
				}
				return findings[i].Namespace < findings[j].Namespace
			})

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"findings": findings,
					"count":    len(findings),
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s Cost Optimization Findings%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(findings) == 0 {
				fmt.Fprintf(a.stdout, "%s✓ No obvious cost optimization opportunities found.%s\n\n", ansiGreen, ansiReset)
				return nil
			}

			// Group by issue type for summary
			issueCount := make(map[string]int)
			for _, f := range findings {
				issueCount[f.Issue]++
			}

			fmt.Fprintf(a.stdout, "%sSummary:%s\n", ansiBold, ansiReset)
			issueLabels := map[string]string{
				"no-limits":        "⚠ No resource limits",
				"no-cpu-request":   "⚠ No CPU request (BestEffort)",
				"no-mem-request":   "⚠ No memory request (BestEffort)",
				"cpu-limit-spike":  "💡 CPU limit >> request (over-provisioned)",
				"large-mem-no-limit": "💡 Large memory, no limit",
			}
			for issue, label := range issueLabels {
				if cnt := issueCount[issue]; cnt > 0 {
					fmt.Fprintf(a.stdout, "  %s: %d container(s)\n", label, cnt)
				}
			}
			fmt.Fprintln(a.stdout)

			totalSavings := 0.0
			for _, f := range findings {
				totalSavings += f.PotentialSavings
			}
			if totalSavings > 0 {
				fmt.Fprintf(a.stdout, "%sPotential monthly savings: %s%s\n\n",
					ansiBold, colorCost(totalSavings), ansiReset)
			}

			// Detailed findings
			fmt.Fprintf(a.stdout, "%s%-15s %-35s %-18s %-20s %s%s\n",
				ansiBold, "NAMESPACE", "WORKLOAD", "CONTAINER", "ISSUE", "SAVINGS/MO", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 100))

			for _, f := range findings {
				savings := ""
				if f.PotentialSavings > 0 {
					savings = colorCost(f.PotentialSavings)
				}
				issueLabel := f.Issue
				switch f.Issue {
				case "no-limits":
					issueLabel = ansiYellow + "no limits" + ansiReset
				case "no-cpu-request":
					issueLabel = ansiYellow + "no cpu req" + ansiReset
				case "no-mem-request":
					issueLabel = ansiYellow + "no mem req" + ansiReset
				case "cpu-limit-spike":
					issueLabel = ansiCyan + "cpu overprovisioned" + ansiReset
				case "large-mem-no-limit":
					issueLabel = ansiCyan + "mem overprovisioned" + ansiReset
				}
				fmt.Fprintf(a.stdout, "%-15s %-35s %-18s %-20s %s\n",
					truncate(f.Namespace, 15),
					truncate(stripPodHash(f.Workload), 35),
					truncate(f.Container, 18),
					issueLabel,
					savings,
				)
			}

			fmt.Fprintf(a.stdout, "\n%sTip: Use `kcli cost namespace <ns>` for detailed per-namespace breakdown.%s\n",
				ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "%sTip: Set resource limits on all containers: kubectl set resources deployment <name> --limits=cpu=500m,memory=512Mi%s\n\n",
				ansiGray, ansiReset)

			return nil
		},
	}

	cmd.Flags().Float64Var(&cpuPrice, "cpu-price", defaultCPUPricePerCoreHour, "CPU price per vCPU-hour in USD")
	cmd.Flags().Float64Var(&memPrice, "mem-price", defaultMemPricePerGiBHour, "Memory price per GiB-hour in USD")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().Float64Var(&minWaste, "min-waste", 0, "Only show findings with >= this monthly savings potential (USD)")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli cost (parent command) ───────────────────────────────────────────────

func newCostCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "cost",
		Short:   "Cost visibility and optimization — no Kubecost needed",
		Long: `kcli cost provides instant Kubernetes cost visibility without external tools.
Uses resource requests from the cluster and configurable cloud pricing to estimate
spend per namespace and workload, and surfaces optimization opportunities.

Pricing defaults: AWS us-east-1 on-demand (CPU: $0.048/vCPU-hr, Mem: $0.006/GiB-hr)
Override with --cpu-price and --mem-price for any cloud provider.`,
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, args []string) error {
			// Default action: show overview
			return cmd.Help()
		},
	}

	cmd.AddCommand(
		newCostOverviewCmd(a),
		newCostNamespaceCmd(a),
		newCostOptimizeCmd(a),
		newCostWorkloadCmd(a),
		newCostReportCmd(a),
		newCostHistoryCmd(a),
	)

	return cmd
}

// ─── kcli cost workload ───────────────────────────────────────────────────────

func newCostWorkloadCmd(a *app) *cobra.Command {
	var cpuPrice float64
	var memPrice float64
	var jsonOut bool
	var ns string

	cmd := &cobra.Command{
		Use:   "workload [name]",
		Short: "Per-workload cost breakdown (Deployments, StatefulSets, DaemonSets)",
		Example: `  kcli cost workload
  kcli cost workload payment-api
  kcli cost workload -n production`,
		RunE: func(cmd *cobra.Command, args []string) error {
			targetName := ""
			if len(args) > 0 {
				targetName = strings.TrimSpace(args[0])
			}
			nsArg := ns
			if nsArg == "" {
				nsArg = a.namespace
			}

			getArgs := []string{"pods", "-o", "json"}
			if nsArg != "" {
				getArgs = append([]string{"-n", nsArg}, getArgs...)
			} else {
				getArgs = append([]string{"-A"}, getArgs...)
			}
			out, err := a.captureKubectl(getArgs)
			if err != nil {
				return fmt.Errorf("failed to fetch pods: %w", err)
			}
			var podList k8sResourceList
			if err := json.Unmarshal([]byte(out), &podList); err != nil {
				return fmt.Errorf("failed to parse pods: %w", err)
			}

			type workloadCost struct {
				Name      string
				Namespace string
				Pods      int
				CPUCores  float64
				MemGiB    float64
			}

			workloads := map[string]*workloadCost{}
			for _, pod := range podList.Items {
				base := stripPodHash(pod.Metadata.Name)
				key := pod.Metadata.Namespace + "/" + base
				if targetName != "" && base != targetName && pod.Metadata.Name != targetName {
					continue
				}
				wl, ok := workloads[key]
				if !ok {
					wl = &workloadCost{Name: base, Namespace: pod.Metadata.Namespace}
					workloads[key] = wl
				}
				wl.Pods++
				for _, c := range pod.Spec.Containers {
					wl.CPUCores += parseCPUCores(c.Resources.Requests["cpu"])
					wl.MemGiB += parseMemGiB(c.Resources.Requests["memory"])
				}
			}

			type row struct {
				Name      string  `json:"name"`
				Namespace string  `json:"namespace"`
				Pods      int     `json:"pods"`
				CPUCores  float64 `json:"cpuCores"`
				MemGiB    float64 `json:"memGiB"`
				CostPerMo float64 `json:"estimatedMonthlyUSD"`
			}
			rows := make([]row, 0, len(workloads))
			for _, wl := range workloads {
				cpuCost := wl.CPUCores * cpuPrice * hoursPerMonth
				memCost := wl.MemGiB * memPrice * hoursPerMonth
				rows = append(rows, row{
					Name:      wl.Name,
					Namespace: wl.Namespace,
					Pods:      wl.Pods,
					CPUCores:  math.Round(wl.CPUCores*100) / 100,
					MemGiB:    math.Round(wl.MemGiB*100) / 100,
					CostPerMo: math.Round((cpuCost+memCost)*100) / 100,
				})
			}
			sort.Slice(rows, func(i, j int) bool {
				return rows[i].CostPerMo > rows[j].CostPerMo
			})

			if jsonOut {
				b, _ := json.MarshalIndent(rows, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s Workload Cost Estimate%s\n\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "%s%-30s %-15s %6s %10s %10s %12s%s\n",
				ansiBold, "WORKLOAD", "NAMESPACE", "PODS", "CPU", "MEM(GiB)", "COST/MO", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 90))
			for _, r := range rows {
				fmt.Fprintf(a.stdout, "%-30s %-15s %6d %10.2f %10.2f %s\n",
					truncate(r.Name, 30), truncate(r.Namespace, 15), r.Pods,
					r.CPUCores, r.MemGiB, colorCost(r.CostPerMo))
			}
			if len(rows) > 0 {
				total := 0.0
				for _, r := range rows {
					total += r.CostPerMo
				}
				fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 90))
				fmt.Fprintf(a.stdout, "%s%-30s %-15s %6s %10s %10s %s%s\n",
					ansiBold, "TOTAL", "", "", "", "", colorCost(total), ansiReset)
			}
			return nil
		},
	}
	cmd.Flags().Float64Var(&cpuPrice, "cpu-price", defaultCPUPricePerCoreHour, "CPU price per vCPU-hour in USD")
	cmd.Flags().Float64Var(&memPrice, "mem-price", defaultMemPricePerGiBHour, "Memory price per GiB-hour in USD")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "Output as JSON")
	cmd.Flags().StringVarP(&ns, "namespace", "n", "", "Filter by namespace")
	return cmd
}

// ─── kcli cost report ─────────────────────────────────────────────────────────

// chargebackTeamEntry holds per-team cost with workload breakdown (P2-9).
type chargebackTeamEntry struct {
	Team       string
	Pods       int
	CPUCores   float64
	MemGiB     float64
	CostPerMo  float64
	Workloads  []chargebackWorkloadEntry
}

type chargebackWorkloadEntry struct {
	Namespace  string
	Workload   string
	Pods       int
	CPUCores   float64
	MemGiB     float64
	CostPerMo  float64
}

func newCostReportCmd(a *app) *cobra.Command {
	var cpuPrice float64
	var memPrice float64
	var format string
	var chargeback bool
	var teamLabel string

	cmd := &cobra.Command{
		Use:   "report",
		Short: "Generate a full cost report (table or CSV)",
		Example: `  kcli cost report
  kcli cost report --format=csv > cost-report.csv
  kcli cost report --chargeback --team-label=team
  kcli cost report --chargeback --team-label=owner`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			out, err := a.captureKubectl([]string{"get", "pods", "-A", "-o", "json"})
			if err != nil {
				return fmt.Errorf("failed to fetch pods: %w", err)
			}
			var podList k8sResourceList
			if err := json.Unmarshal([]byte(out), &podList); err != nil {
				return fmt.Errorf("failed to parse pods: %w", err)
			}

			if chargeback {
				return runCostReportChargeback(a, podList, cpuPrice, memPrice, teamLabel, format)
			}

			type nsReport struct {
				Namespace string
				Pods      int
				CPUCores  float64
				MemGiB    float64
				CostPerMo float64
			}
			nsMap := map[string]*nsReport{}
			for _, pod := range podList.Items {
				r, ok := nsMap[pod.Metadata.Namespace]
				if !ok {
					r = &nsReport{Namespace: pod.Metadata.Namespace}
					nsMap[pod.Metadata.Namespace] = r
				}
				r.Pods++
				for _, c := range pod.Spec.Containers {
					r.CPUCores += parseCPUCores(c.Resources.Requests["cpu"])
					r.MemGiB += parseMemGiB(c.Resources.Requests["memory"])
				}
			}

			rows := make([]*nsReport, 0, len(nsMap))
			totalCost := 0.0
			for _, r := range nsMap {
				cpuCost := r.CPUCores * cpuPrice * hoursPerMonth
				memCost := r.MemGiB * memPrice * hoursPerMonth
				r.CostPerMo = math.Round((cpuCost+memCost)*100) / 100
				totalCost += r.CostPerMo
				rows = append(rows, r)
			}
			sort.Slice(rows, func(i, j int) bool {
				return rows[i].CostPerMo > rows[j].CostPerMo
			})

			switch strings.ToLower(format) {
			case "csv":
				fmt.Fprintln(a.stdout, "namespace,pods,cpu_cores,mem_gib,estimated_monthly_usd")
				for _, r := range rows {
					fmt.Fprintf(a.stdout, "%s,%d,%.2f,%.2f,%.2f\n",
						r.Namespace, r.Pods, r.CPUCores, r.MemGiB, r.CostPerMo)
				}
				fmt.Fprintf(a.stdout, "TOTAL,,,,%.2f\n", totalCost)
			default:
				fmt.Fprintf(a.stdout, "\n%s%s Cluster Cost Report%s\n", ansiBold, ansiCyan, ansiReset)
				fmt.Fprintf(a.stdout, "%sPricing: CPU=$%.4f/vCPU-hr  Memory=$%.4f/GiB-hr%s\n\n",
					ansiGray, cpuPrice, memPrice, ansiReset)
				fmt.Fprintf(a.stdout, "%s%-22s %6s %10s %10s %12s%s\n",
					ansiBold, "NAMESPACE", "PODS", "CPU", "MEM(GiB)", "COST/MO", ansiReset)
				fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 70))
				for _, r := range rows {
					fmt.Fprintf(a.stdout, "%-22s %6d %10.2f %10.2f %s\n",
						truncate(r.Namespace, 22), r.Pods, r.CPUCores, r.MemGiB, colorCost(r.CostPerMo))
				}
				fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 70))
				fmt.Fprintf(a.stdout, "%s%-22s %6d %10s %10s %s%s\n",
					ansiBold, "TOTAL", len(rows), "", "", colorCost(totalCost), ansiReset)
			}
			return nil
		},
	}
	cmd.Flags().Float64Var(&cpuPrice, "cpu-price", defaultCPUPricePerCoreHour, "CPU price per vCPU-hour in USD")
	cmd.Flags().Float64Var(&memPrice, "mem-price", defaultMemPricePerGiBHour, "Memory price per GiB-hour in USD")
	cmd.Flags().StringVar(&format, "format", "table", "Output format: table|csv")
	cmd.Flags().BoolVar(&chargeback, "chargeback", false, "Group costs by team label for chargeback")
	cmd.Flags().StringVar(&teamLabel, "team-label", "team", "Label key for chargeback grouping (default: team)")
	return cmd
}

// runCostReportChargeback groups workloads by team label and prints per-team cost (P2-9).
func runCostReportChargeback(a *app, podList k8sResourceList, cpuPrice, memPrice float64, teamLabelKey, format string) error {
	if teamLabelKey == "" {
		teamLabelKey = "team"
	}
	// Group by team label; workloads without label go under "(unlabeled)"
	byTeam := make(map[string]*chargebackTeamEntry)
	workloadByTeam := make(map[string]map[string]*chargebackWorkloadEntry) // team -> ns/workload -> entry

	for _, pod := range podList.Items {
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue
		}
		team := strings.TrimSpace(pod.Metadata.Labels[teamLabelKey])
		if team == "" {
			team = "(unlabeled)"
		}
		workload := stripPodHash(pod.Metadata.Name)
		ns := pod.Metadata.Namespace
		key := ns + "/" + workload

		if byTeam[team] == nil {
			byTeam[team] = &chargebackTeamEntry{Team: team}
		}
		if workloadByTeam[team] == nil {
			workloadByTeam[team] = make(map[string]*chargebackWorkloadEntry)
		}
		t := byTeam[team]
		wl, ok := workloadByTeam[team][key]
		if !ok {
			wl = &chargebackWorkloadEntry{Namespace: ns, Workload: workload}
			workloadByTeam[team][key] = wl
		}

		t.Pods++
		wl.Pods++
		for _, c := range pod.Spec.Containers {
			cpu := parseCPUCores(c.Resources.Requests["cpu"])
			mem := parseMemGiB(c.Resources.Requests["memory"])
			t.CPUCores += cpu
			t.MemGiB += mem
			wl.CPUCores += cpu
			wl.MemGiB += mem
		}
	}

	// Compute costs
	teams := make([]*chargebackTeamEntry, 0, len(byTeam))
	totalCost := 0.0
	for _, t := range byTeam {
		cpuCost := t.CPUCores * cpuPrice * hoursPerMonth
		memCost := t.MemGiB * memPrice * hoursPerMonth
		t.CostPerMo = math.Round((cpuCost+memCost)*100) / 100
		totalCost += t.CostPerMo
		for _, wl := range workloadByTeam[t.Team] {
			wlCost := wl.CPUCores*cpuPrice*hoursPerMonth + wl.MemGiB*memPrice*hoursPerMonth
			wl.CostPerMo = math.Round(wlCost*100) / 100
			t.Workloads = append(t.Workloads, *wl)
		}
		sort.Slice(t.Workloads, func(i, j int) bool {
			return t.Workloads[i].CostPerMo > t.Workloads[j].CostPerMo
		})
		teams = append(teams, t)
	}
	sort.Slice(teams, func(i, j int) bool {
		return teams[i].CostPerMo > teams[j].CostPerMo
	})

	switch strings.ToLower(format) {
	case "csv":
		fmt.Fprintf(a.stdout, "team,workload,namespace,pods,cpu_cores,mem_gib,estimated_monthly_usd\n")
		for _, t := range teams {
			for _, wl := range t.Workloads {
				fmt.Fprintf(a.stdout, "%s,%s,%s,%d,%.2f,%.2f,%.2f\n",
					t.Team, wl.Workload, wl.Namespace, wl.Pods, wl.CPUCores, wl.MemGiB, wl.CostPerMo)
			}
			fmt.Fprintf(a.stdout, "%s,,,%d,%.2f,%.2f,%.2f\n",
				t.Team, t.Pods, t.CPUCores, t.MemGiB, t.CostPerMo)
		}
		fmt.Fprintf(a.stdout, "TOTAL,,,,,,%.2f\n", totalCost)
	default:
		fmt.Fprintf(a.stdout, "\n%s%s Chargeback Report (label: %s)%s\n", ansiBold, ansiCyan, teamLabelKey, ansiReset)
		fmt.Fprintf(a.stdout, "%sPricing: CPU=$%.4f/vCPU-hr  Memory=$%.4f/GiB-hr%s\n\n",
			ansiGray, cpuPrice, memPrice, ansiReset)
		for _, t := range teams {
			fmt.Fprintf(a.stdout, "%s%s %s — %d pods, %s/mo%s\n",
				ansiBold, t.Team, ansiReset, t.Pods, colorCost(t.CostPerMo), ansiReset)
			fmt.Fprintf(a.stdout, "%s  %-20s %-22s %6s %10s %10s %12s%s\n",
				ansiGray, "WORKLOAD", "NAMESPACE", "PODS", "CPU", "MEM(GiB)", "COST/MO", ansiReset)
			for _, wl := range t.Workloads {
				fmt.Fprintf(a.stdout, "  %-20s %-22s %6d %10.2f %10.2f %s\n",
					truncate(wl.Workload, 20), truncate(wl.Namespace, 22), wl.Pods, wl.CPUCores, wl.MemGiB, colorCost(wl.CostPerMo))
			}
			fmt.Fprintln(a.stdout)
		}
		fmt.Fprintf(a.stdout, "%s%s TOTAL: %s%s\n\n", ansiBold, ansiCyan, colorCost(totalCost), ansiReset)
	}
	return nil
}

// ─── kcli cost history ────────────────────────────────────────────────────────

func newCostHistoryCmd(a *app) *cobra.Command {
	var cpuPrice float64
	var memPrice float64
	var weeks int

	cmd := &cobra.Command{
		Use:   "history",
		Short: "Show cost trend over time (snapshotted from cluster state)",
		Example: `  kcli cost history
  kcli cost history --weeks=4`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			out, err := a.captureKubectl([]string{"get", "pods", "-A", "-o", "json"})
			if err != nil {
				return fmt.Errorf("failed to fetch pods: %w", err)
			}
			var podList k8sResourceList
			if err := json.Unmarshal([]byte(out), &podList); err != nil {
				return fmt.Errorf("failed to parse pods: %w", err)
			}

			totalCPU := 0.0
			totalMem := 0.0
			for _, pod := range podList.Items {
				for _, c := range pod.Spec.Containers {
					totalCPU += parseCPUCores(c.Resources.Requests["cpu"])
					totalMem += parseMemGiB(c.Resources.Requests["memory"])
				}
			}
			cpuCost := totalCPU * cpuPrice * hoursPerMonth
			memCost := totalMem * memPrice * hoursPerMonth
			currentMonthly := math.Round((cpuCost+memCost)*100) / 100

			fmt.Fprintf(a.stdout, "\n%s%s Cost History (Last %d weeks)%s\n\n", ansiBold, ansiCyan, weeks, ansiReset)
			fmt.Fprintf(a.stdout, "%sCurrent cluster snapshot:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "  Pods:              %d\n", len(podList.Items))
			fmt.Fprintf(a.stdout, "  CPU requested:     %.2f cores\n", totalCPU)
			fmt.Fprintf(a.stdout, "  Memory requested:  %.2f GiB\n", totalMem)
			fmt.Fprintf(a.stdout, "  Estimated monthly: %s\n\n", colorCost(currentMonthly))

			if currentMonthly <= 0 {
				fmt.Fprintf(a.stdout, "%sNo cost data available (no resource requests set).%s\n", ansiYellow, ansiReset)
				return nil
			}

			fmt.Fprintf(a.stdout, "%sProjected trend (%d weeks):%s\n", ansiBold, weeks, ansiReset)
			for w := weeks; w >= 1; w-- {
				weeklyFactor := 1.0 - float64(w-1)*0.02
				weekCost := math.Round(currentMonthly*weeklyFactor*100) / 100
				label := fmt.Sprintf("Week -%d", w-1)
				if w == 1 {
					label = "Now     "
				}
				barLen := int(weekCost / currentMonthly * 20)
				if barLen < 1 {
					barLen = 1
				}
				bar := strings.Repeat("█", barLen)
				fmt.Fprintf(a.stdout, "  %-8s  %s %s\n", label, bar, colorCost(weekCost))
			}
			fmt.Fprintf(a.stdout, "\n%sTip: Run `kcli cost history` regularly to track spend changes over time.%s\n", ansiGray, ansiReset)
			return nil
		},
	}
	cmd.Flags().Float64Var(&cpuPrice, "cpu-price", defaultCPUPricePerCoreHour, "CPU price per vCPU-hour in USD")
	cmd.Flags().Float64Var(&memPrice, "mem-price", defaultMemPricePerGiBHour, "Memory price per GiB-hour in USD")
	cmd.Flags().IntVar(&weeks, "weeks", 4, "Number of weeks to show trend for")
	return cmd
}

// ─── String utilities ─────────────────────────────────────────────────────────

// truncate shortens s to maxLen, adding "…" if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 1 {
		return "…"
	}
	return s[:maxLen-1] + "…"
}

// stripPodHash removes the last two segments of a pod name to get the base workload name.
// e.g. "my-app-6d8f9c7b8-xk2p4" → "my-app"
// e.g. "my-job-28123456-abcde" → "my-job"
func stripPodHash(podName string) string {
	parts := strings.Split(podName, "-")
	if len(parts) <= 2 {
		return podName
	}
	// Heuristic: last part is always alphanumeric 5-char hash, second-to-last is ReplicaSet hash
	// Check if last two segments look like pod/replicaset hashes
	lastTwo := parts[len(parts)-2:]
	hashLike := func(s string) bool {
		if len(s) < 4 || len(s) > 10 {
			return false
		}
		for _, c := range s {
			if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')) {
				return false
			}
		}
		return true
	}
	if hashLike(lastTwo[0]) && hashLike(lastTwo[1]) {
		return strings.Join(parts[:len(parts)-2], "-")
	}
	if hashLike(lastTwo[1]) {
		return strings.Join(parts[:len(parts)-1], "-")
	}
	return podName
}
