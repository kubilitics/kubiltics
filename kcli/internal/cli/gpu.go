package cli

// gpu.go — kcli gpu command group.
//
// GPU resource management for ML/AI Kubernetes workloads.
// Discovers NVIDIA GPU nodes, shows allocation, utilization (via nvidia-smi
// or DCGM exporter), and estimates GPU costs.
//
// Commands:
//   kcli gpu status              — GPU nodes and allocation overview
//   kcli gpu top                 — real-time GPU utilization
//   kcli gpu workloads           — list GPU-requesting workloads
//   kcli gpu cost [--last=7d]    — GPU cost breakdown
//   kcli gpu logs <job>          — logs for a GPU job

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// ─── GPU pricing (defaults) ───────────────────────────────────────────────────

const (
	defaultA100PricePerHour float64 = 3.06  // AWS p4d.24xlarge / 8 GPUs ≈ $3.06/GPU-hr
	defaultV100PricePerHour float64 = 2.48  // AWS p3.2xlarge
	defaultT4PricePerHour   float64 = 0.526 // AWS g4dn.xlarge
	defaultGPUPricePerHour  float64 = 1.50  // Generic fallback
)

// ─── GPU node types ───────────────────────────────────────────────────────────

type gpuNode struct {
	Name         string
	GPUCount     int
	GPUAllocated int
	GPUType      string
	CPUCores     float64
	MemGiB       float64
	Pods         []gpuWorkload
}

type gpuWorkload struct {
	Name        string
	Namespace   string
	GPUCount    int
	ContainerName string
	Status      string
}

// ─── Data collection ──────────────────────────────────────────────────────────

func (a *app) fetchGPUNodes() ([]gpuNode, error) {
	// List nodes with GPU labels
	out, err := a.captureKubectl([]string{"get", "nodes", "-o", "json"})
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}

	var nodeList struct {
		Items []struct {
			Metadata struct {
				Name   string            `json:"name"`
				Labels map[string]string `json:"labels"`
			} `json:"metadata"`
			Status struct {
				Capacity    map[string]string `json:"capacity"`
				Allocatable map[string]string `json:"allocatable"`
			} `json:"status"`
		} `json:"items"`
	}

	if err := json.Unmarshal([]byte(out), &nodeList); err != nil {
		return nil, fmt.Errorf("failed to parse nodes: %w", err)
	}

	var gpuNodes []gpuNode
	for _, n := range nodeList.Items {
		// Check for nvidia GPU capacity
		gpuCap := n.Status.Capacity["nvidia.com/gpu"]
		if gpuCap == "" {
			gpuCap = n.Status.Capacity["amd.com/gpu"]
		}
		if gpuCap == "" {
			continue // not a GPU node
		}

		gpuCount := 0
		fmt.Sscanf(gpuCap, "%d", &gpuCount)
		if gpuCount == 0 {
			continue
		}

		// Detect GPU type from node labels
		gpuType := "GPU"
		for k, v := range n.Metadata.Labels {
			if strings.Contains(k, "gpu-type") || strings.Contains(k, "nvidia.com/gpu.product") {
				gpuType = v
				break
			}
			if strings.Contains(k, "instance-type") {
				if strings.Contains(v, "p4d") {
					gpuType = "A100"
				} else if strings.Contains(v, "p3") {
					gpuType = "V100"
				} else if strings.Contains(v, "g4dn") {
					gpuType = "T4"
				} else if strings.Contains(v, "g5") {
					gpuType = "A10G"
				}
			}
		}

		node := gpuNode{
			Name:     n.Metadata.Name,
			GPUCount: gpuCount,
			GPUType:  gpuType,
			CPUCores: parseCPUCores(n.Status.Capacity["cpu"]),
			MemGiB:   parseMemGiB(n.Status.Capacity["memory"]),
		}
		gpuNodes = append(gpuNodes, node)
	}

	if len(gpuNodes) == 0 {
		return nil, nil
	}

	// Now find GPU workloads (pods with nvidia.com/gpu requests)
	podsOut, err := a.captureKubectl([]string{"get", "pods", "--all-namespaces", "-o", "json"})
	if err != nil {
		return gpuNodes, nil
	}

	var podList struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Spec struct {
				NodeName   string `json:"nodeName"`
				Containers []struct {
					Name      string `json:"name"`
					Resources struct {
						Requests map[string]string `json:"requests"`
						Limits   map[string]string `json:"limits"`
					} `json:"resources"`
				} `json:"containers"`
			} `json:"spec"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}

	if err := json.Unmarshal([]byte(podsOut), &podList); err != nil {
		return gpuNodes, nil
	}

	// Build node name → index map
	nodeIdx := map[string]int{}
	for i, n := range gpuNodes {
		nodeIdx[n.Name] = i
	}

	for _, pod := range podList.Items {
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue
		}
		for _, c := range pod.Spec.Containers {
			gpuReqStr := c.Resources.Requests["nvidia.com/gpu"]
			if gpuReqStr == "" {
				gpuReqStr = c.Resources.Limits["nvidia.com/gpu"]
			}
			if gpuReqStr == "" {
				continue
			}
			gpuReq := 0
			fmt.Sscanf(gpuReqStr, "%d", &gpuReq)
			if gpuReq == 0 {
				continue
			}

			wl := gpuWorkload{
				Name:          pod.Metadata.Name,
				Namespace:     pod.Metadata.Namespace,
				GPUCount:      gpuReq,
				ContainerName: c.Name,
				Status:        pod.Status.Phase,
			}

			if idx, ok := nodeIdx[pod.Spec.NodeName]; ok {
				gpuNodes[idx].Pods = append(gpuNodes[idx].Pods, wl)
				gpuNodes[idx].GPUAllocated += gpuReq
			}
		}
	}

	return gpuNodes, nil
}

// ─── kcli gpu status ──────────────────────────────────────────────────────────

func newGPUStatusCmd(a *app) *cobra.Command {
	var jsonOut bool

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show GPU node allocation and workloads",
		RunE: func(cmd *cobra.Command, args []string) error {
			nodes, err := a.fetchGPUNodes()
			if err != nil {
				return err
			}

			if jsonOut {
				b, _ := json.MarshalIndent(nodes, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			if len(nodes) == 0 {
				fmt.Fprintf(a.stdout, "\n%sNo GPU nodes found in the cluster.%s\n\n", ansiYellow, ansiReset)
				fmt.Fprintf(a.stdout, "GPU nodes require 'nvidia.com/gpu' or 'amd.com/gpu' capacity.\n")
				fmt.Fprintf(a.stdout, "Install the NVIDIA GPU operator: https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/\n\n")
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s GPU Resources%s\n\n", ansiBold, ansiCyan, ansiReset)

			totalGPUs := 0
			totalAllocated := 0
			for _, n := range nodes {
				totalGPUs += n.GPUCount
				totalAllocated += n.GPUAllocated
			}

			fmt.Fprintf(a.stdout, "%sTotal GPUs: %d  Allocated: %d  Free: %d%s\n\n",
				ansiGray, totalGPUs, totalAllocated, totalGPUs-totalAllocated, ansiReset)

			fmt.Fprintf(a.stdout, "%s%-35s %-8s %-8s %-8s %-8s%s\n",
				ansiBold, "NODE", "TYPE", "GPUS", "ALLOC", "FREE", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 72))

			for _, n := range nodes {
				free := n.GPUCount - n.GPUAllocated
				freeColor := ansiGreen
				if free == 0 {
					freeColor = ansiRed
				} else if free < n.GPUCount/2 {
					freeColor = ansiYellow
				}
				fmt.Fprintf(a.stdout, "%-35s %-8s %-8d %-8d %s%-8d%s\n",
					truncate(n.Name, 35), n.GPUType, n.GPUCount, n.GPUAllocated,
					freeColor, free, ansiReset,
				)
			}

			fmt.Fprintf(a.stdout, "\n%sGPU Workloads:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "%s%-40s %-20s %-8s %-12s%s\n",
				ansiGray, "POD", "NAMESPACE", "GPUs", "STATUS", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 84))

			for _, n := range nodes {
				for _, wl := range n.Pods {
					statusColor := ansiGreen
					if wl.Status != "Running" {
						statusColor = ansiYellow
					}
					fmt.Fprintf(a.stdout, "%-40s %-20s %-8d %s%-12s%s\n",
						truncate(wl.Name, 40), wl.Namespace, wl.GPUCount,
						statusColor, wl.Status, ansiReset,
					)
				}
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "JSON output")
	return cmd
}

// ─── kcli gpu top ─────────────────────────────────────────────────────────────

func newGPUTopCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "top",
		Short: "Show real-time GPU utilization (requires DCGM exporter or nvidia-smi)",
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintf(a.stdout, "\n%s%s GPU Utilization%s\n\n", ansiBold, ansiCyan, ansiReset)

			// Try to get GPU metrics from DCGM exporter via prometheus
			endpoint, _ := a.resolvePromEndpoint()
			if endpoint != "" {
				client := newPromClient(endpoint)
				// DCGM GPU utilization metric
				body, err := client.get("/api/v1/query", map[string][]string{
					"query": {"DCGM_FI_DEV_GPU_UTIL"},
				})
				if err == nil {
					var resp promResponse
					if json.Unmarshal(body, &resp) == nil && resp.Status == "success" && len(resp.Data.Result) > 0 {
						fmt.Fprintf(a.stdout, "%s%-20s %-15s %-10s%s\n",
							ansiBold, "GPU", "NODE", "UTIL %", ansiReset)
						fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 50))
						for _, r := range resp.Data.Result {
							val := ""
							if len(r.Value) == 2 {
								val = fmt.Sprintf("%v%%", r.Value[1])
							}
							node := r.Metric["Hostname"]
							gpu := r.Metric["gpu"]
							utilColor := ansiGreen
							if strings.TrimRight(val, "%") > "70" {
								utilColor = ansiYellow
							}
							if strings.TrimRight(val, "%") > "90" {
								utilColor = ansiRed
							}
							fmt.Fprintf(a.stdout, "%-20s %-15s %s%-10s%s\n",
								gpu, node, utilColor, val, ansiReset)
						}
						fmt.Fprintln(a.stdout)
						return nil
					}
				}
			}

			// Fallback: exec nvidia-smi on GPU nodes
			nodes, err := a.fetchGPUNodes()
			if err != nil || len(nodes) == 0 {
				fmt.Fprintf(a.stdout, "%sNo GPU nodes found.%s\n\n", ansiYellow, ansiReset)
				return nil
			}

			fmt.Fprintf(a.stdout, "%sTo get real-time GPU utilization, install DCGM exporter or run:%s\n", ansiGray, ansiReset)
			fmt.Fprintf(a.stdout, "  kubectl exec -n <namespace> <pod> -- nvidia-smi\n\n")
			fmt.Fprintf(a.stdout, "Or install NVIDIA DCGM Exporter:\n")
			fmt.Fprintf(a.stdout, "  helm install dcgm-exporter gpu-helm-charts/dcgm-exporter -n gpu-operator\n\n")

			// Show allocation as proxy for utilization
			return newGPUStatusCmd(a).RunE(cmd, args)
		},
	}
}

// ─── kcli gpu cost ────────────────────────────────────────────────────────────

func newGPUCostCmd(a *app) *cobra.Command {
	var last string
	var gpuPrice float64

	cmd := &cobra.Command{
		Use:   "cost",
		Short: "Estimate GPU resource costs",
		RunE: func(cmd *cobra.Command, args []string) error {
			nodes, err := a.fetchGPUNodes()
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s GPU Cost Estimate%s\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "%sWindow: %s  GPU rate: $%.2f/hr%s\n\n", ansiGray, last, gpuPrice, ansiReset)

			if len(nodes) == 0 {
				fmt.Fprintf(a.stdout, "%sNo GPU nodes found.%s\n\n", ansiYellow, ansiReset)
				return nil
			}

			totalGPUs := 0
			totalAllocated := 0
			for _, n := range nodes {
				totalGPUs += n.GPUCount
				totalAllocated += n.GPUAllocated
			}

			hourlyTotal := float64(totalGPUs) * gpuPrice
			monthlyTotal := hourlyTotal * hoursPerMonth

			fmt.Fprintf(a.stdout, "  Total GPU nodes: %d\n", len(nodes))
			fmt.Fprintf(a.stdout, "  Total GPUs: %d (allocated: %d, idle: %d)\n",
				totalGPUs, totalAllocated, totalGPUs-totalAllocated)
			fmt.Fprintf(a.stdout, "  Estimated hourly cost:  %s\n", colorCost(hourlyTotal))
			fmt.Fprintf(a.stdout, "  Estimated monthly cost: %s\n\n", colorCost(monthlyTotal))

			if totalGPUs-totalAllocated > 0 {
				idleCost := float64(totalGPUs-totalAllocated) * gpuPrice * hoursPerMonth
				fmt.Fprintf(a.stdout, "%s💡 %d idle GPU(s) costing ~%s%s\n",
					ansiYellow, totalGPUs-totalAllocated, colorCost(idleCost), ansiReset)
				fmt.Fprintf(a.stdout, "%s   Consider cluster autoscaler or node pool scaling.%s\n\n",
					ansiGray, ansiReset)
			}

			// Per workload cost
			fmt.Fprintf(a.stdout, "%sGPU Workload Costs:%s\n", ansiBold, ansiReset)
			fmt.Fprintf(a.stdout, "%s%-40s %-10s %-15s %s%s\n",
				ansiGray, "WORKLOAD", "GPUs", "HOURLY", "MONTHLY", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 75))
			for _, n := range nodes {
				for _, wl := range n.Pods {
					wlHourly := float64(wl.GPUCount) * gpuPrice
					wlMonthly := wlHourly * hoursPerMonth
					fmt.Fprintf(a.stdout, "%-40s %-10d %s %s\n",
						truncate(wl.Name, 40), wl.GPUCount,
						colorCost(wlHourly), colorCost(wlMonthly))
				}
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}
	cmd.Flags().StringVar(&last, "last", "30d", "Time window for cost calculation")
	cmd.Flags().Float64Var(&gpuPrice, "gpu-price", defaultA100PricePerHour, "GPU price per hour USD (default: A100 equivalent)")
	return cmd
}

// ─── kcli gpu logs ────────────────────────────────────────────────────────────

func newGPULogsCmd(a *app) *cobra.Command {
	var namespace string
	var follow bool

	cmd := &cobra.Command{
		Use:   "logs <pod-or-job>",
		Short: "Stream logs from a GPU workload",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}
			if ns == "" {
				ns = "default"
			}
			logArgs := []string{"logs", args[0], "-n", ns}
			if follow {
				logArgs = append(logArgs, "-f")
			}
			return a.runKubectl(logArgs)
		},
	}
	cmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Namespace of the GPU workload")
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "Stream logs continuously")
	return cmd
}

// ─── newGPUCmd ────────────────────────────────────────────────────────────────

func newGPUCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "gpu",
		Short: "GPU resource management for ML/AI Kubernetes workloads",
		Long: `kcli gpu provides GPU resource visibility and cost analysis for ML teams.

Discovers NVIDIA and AMD GPU nodes, shows allocation, estimates costs,
and helps identify idle GPU resources.

Requires: nvidia.com/gpu or amd.com/gpu resource labels on nodes.
For utilization metrics: DCGM Exporter + Prometheus.`,
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, args []string) error {
			return newGPUStatusCmd(a).RunE(cmd, args)
		},
	}

	cmd.AddCommand(
		newGPUStatusCmd(a),
		newGPUTopCmd(a),
		newGPUCostCmd(a),
		newGPULogsCmd(a),
	)
	return cmd
}
