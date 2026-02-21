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
	"math"
	"sort"
	"strconv"
	"strings"

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

// ─── ANSI color helpers ───────────────────────────────────────────────────────

const (
	ansiReset  = "\033[0m"
	ansiBold   = "\033[1m"
	ansiGreen  = "\033[32m"
	ansiYellow = "\033[33m"
	ansiRed    = "\033[31m"
	ansiCyan   = "\033[36m"
	ansiGray   = "\033[90m"
)

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
			entries, err := a.fetchCostData("", cpuPrice, memPrice)
			if err != nil {
				return err
			}

			byNS := aggregateByNamespace(entries)

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
					Namespace    string  `json:"namespace"`
					PodCount     int     `json:"pod_count"`
					CPUCores     float64 `json:"cpu_cores_requested"`
					MemGiB       float64 `json:"mem_gib_requested"`
					MonthlyCostUSD float64 `json:"monthly_cost_usd"`
				}
				type jsonOut struct {
					TotalMonthlyCostUSD float64  `json:"total_monthly_cost_usd"`
					TotalCPUCores       float64  `json:"total_cpu_cores"`
					TotalMemGiB         float64  `json:"total_mem_gib"`
					Namespaces          []jsonNS `json:"namespaces"`
				}
				namespaces := make([]jsonNS, 0, len(byNS))
				limit := len(byNS)
				if top > 0 && top < limit {
					limit = top
				}
				for _, ns := range byNS[:limit] {
					namespaces = append(namespaces, jsonNS{
						Namespace:      ns.Namespace,
						PodCount:       ns.PodCount,
						CPUCores:       roundTo(ns.CPURequest, 3),
						MemGiB:         roundTo(ns.MemRequest, 2),
						MonthlyCostUSD: roundTo(ns.MonthlyCost, 2),
					})
				}
				out := jsonOut{
					TotalMonthlyCostUSD: roundTo(totalMonthly, 2),
					TotalCPUCores:       roundTo(totalCPU, 3),
					TotalMemGiB:         roundTo(totalMem, 2),
					Namespaces:          namespaces,
				}
				b, _ := json.MarshalIndent(out, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			// Pretty output
			fmt.Fprintf(a.stdout, "\n%s%s Cluster Cost Overview%s\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "%sPricing: CPU $%.4f/vCPU-hr · Memory $%.4f/GiB-hr%s\n\n",
				ansiGray, cpuPrice, memPrice, ansiReset)

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
				len(entries),
				totalCPU,
				totalMem,
				colorCost(totalMonthly),
				ansiReset,
			)

			// Annualized
			fmt.Fprintf(a.stdout, "\n%sEstimated annual spend: %s%s\n",
				ansiGray, colorCost(totalMonthly*12), ansiReset)
			fmt.Fprintf(a.stdout, "%s(Estimates based on resource requests. Actual costs depend on node types and pricing plans.)%s\n\n",
				ansiGray, ansiReset)

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
	)

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
