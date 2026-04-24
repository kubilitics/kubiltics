package cost

// ─── CloudProvider aliases (tests expect CloudProviderXXX naming) ─────────────

const (
	CloudProviderAWS     = ProviderAWS
	CloudProviderGCP     = ProviderGCP
	CloudProviderAzure   = ProviderAzure
	CloudProviderGeneric = ProviderGeneric
)

// ─── OptimizationType aliases (tests expect different names) ─────────────────

const (
	OptimizationRightsizing   = OptimizationOverprovisioned // Rightsizing = overprovisioning fix
	OptimizationIdleResources = OptimizationIdleResource
)

// ─── PodResources holds pod resource requests and actual usage ────────────────

// PodResources holds pod resource metrics for optimization analysis.
type PodResources struct {
	RequestedCPU    float64 // CPU cores requested
	RequestedMemory float64 // Memory in MB
	UsedCPU         float64 // Actual CPU cores used
	UsedMemory      float64 // Actual memory used in MB
}

// NodeResources holds node resource totals and allocation.
type NodeResources struct {
	TotalCPU        float64 // Total node CPU cores
	TotalMemory     float64 // Total memory in MB
	AllocatedCPU    float64 // Allocated CPU cores
	AllocatedMemory float64 // Allocated memory in MB
}

// ─── Extended types for test compatibility ────────────────────────────────────

// ClusterCostExt extends ClusterCost with the ResourceCosts field expected by tests.
type ClusterCostExt struct {
	ClusterCost
	ResourceCosts []ResourceCost
	TotalCost     float64
}

// ResourceCostExt is ResourceCost with a TotalCost alias.
type ResourceCostExt struct {
	ResourceCost
	TotalCost float64
}

// OptimizationExt extends Optimization with a PotentialSavings alias.
type OptimizationExt struct {
	Optimization
	PotentialSavings float64
}

// ─── Extended CostCalculator methods ─────────────────────────────────────────

// CalculatePodCostV2 is a compatibility wrapper returning ResourceCostExt.
// Used by integration tests that access TotalCost directly.
func (c *CostCalculator) CalculatePodCostV2(
	name, namespace string,
	cpuCores, memoryMB float64, // memory in MB (not GB)
	hoursRunning float64,
) ResourceCostExt {
	memoryGB := memoryMB / 1024
	rc := c.CalculatePodCost(name, namespace, cpuCores, memoryGB, hoursRunning)
	return ResourceCostExt{
		ResourceCost: rc,
		TotalCost:    rc.TotalCostMonth,
	}
}

// AggregateClusterCostExt aggregates resource costs and returns ClusterCostExt.
func (c *CostCalculator) AggregateClusterCostExt(resources []ResourceCostExt) ClusterCostExt {
	rcs := make([]ResourceCost, len(resources))
	for i, r := range resources {
		rcs[i] = r.ResourceCost
	}
	base := c.AggregateClusterCost(rcs)
	total := 0.0
	for _, r := range resources {
		total += r.TotalCost
	}
	return ClusterCostExt{
		ClusterCost:   base,
		ResourceCosts: rcs,
		TotalCost:     total,
	}
}

// ─── Extended CostOptimizer methods ──────────────────────────────────────────

// AnalyzePodOptimizationV2 accepts PodResources struct instead of individual args.
func (o *CostOptimizer) AnalyzePodOptimizationV2(
	name, namespace string,
	resources PodResources,
	currentCostMonthly float64,
) []OptimizationExt {
	var result []OptimizationExt

	memGB := resources.RequestedMemory / 1024
	actualMemGB := resources.UsedMemory / 1024
	hoursPerMonth := 720.0

	inner := o.AnalyzePodOptimization(
		name, namespace,
		resources.RequestedCPU, resources.UsedCPU,
		memGB, actualMemGB,
		hoursPerMonth,
	)

	for _, opt := range inner {
		result = append(result, OptimizationExt{
			Optimization:     opt,
			PotentialSavings: opt.Savings,
		})
	}

	// Check for idle resource (<= 2% CPU and <= 10% memory)
	if resources.UsedCPU <= resources.RequestedCPU*0.02 &&
		resources.UsedMemory <= resources.RequestedMemory*0.10 {
		result = append(result, OptimizationExt{
			Optimization: Optimization{
				Type:           OptimizationIdleResource,
				ResourceType:   ResourceTypePod,
				ResourceName:   name,
				Namespace:      namespace,
				CurrentCost:    currentCostMonthly,
				OptimizedCost:  0,
				Savings:        currentCostMonthly,
				SavingsPercent: 100,
				Priority:       "high",
				Description:    "Resource appears idle — very low CPU and memory utilization",
				Action:         "Consider terminating or scaling down this resource",
				Confidence:     0.9,
			},
			PotentialSavings: currentCostMonthly,
		})
	}

	return result
}

// AnalyzeNodeOptimizationV2 accepts NodeResources struct.
func (o *CostOptimizer) AnalyzeNodeOptimizationV2(
	name string,
	resources NodeResources,
	currentCostMonthly float64,
) []OptimizationExt {
	allocatedCPUPct := 0.0
	if resources.TotalCPU > 0 {
		allocatedCPUPct = resources.AllocatedCPU / resources.TotalCPU * 100
	}
	allocatedMemPct := 0.0
	if resources.TotalMemory > 0 {
		allocatedMemPct = resources.AllocatedMemory / resources.TotalMemory * 100
	}

	var result []OptimizationExt

	if allocatedCPUPct < 50 && allocatedMemPct < 50 {
		savings := currentCostMonthly * 0.3
		result = append(result, OptimizationExt{
			Optimization: Optimization{
				Type:           OptimizationUnderutil,
				ResourceType:   ResourceTypeNode,
				ResourceName:   name,
				CurrentCost:    currentCostMonthly,
				OptimizedCost:  currentCostMonthly - savings,
				Savings:        savings,
				SavingsPercent: 30,
				Priority:       "medium",
				Description: "Node is underutilized — " +
					"CPU allocation is " + pctStr(allocatedCPUPct) + "%, memory allocation is " + pctStr(allocatedMemPct) + "%",
				Action:     "Consider consolidating workloads or downsizing the node",
				Confidence: 0.8,
			},
			PotentialSavings: savings,
		})
	}

	return result
}

func pctStr(v float64) string {
	if v == 0 {
		return "0"
	}
	s := ""
	i := int(v)
	if float64(i) == v {
		s = intStr(i)
	} else {
		s = intStr(int(v * 10)) // 1 decimal place
		s = s[:len(s)-1] + "." + s[len(s)-1:]
	}
	return s
}

func intStr(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}
