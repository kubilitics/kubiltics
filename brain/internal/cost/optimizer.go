package cost

import (
	"fmt"
	"sort"
	"time"
)

// OptimizationType represents different types of optimization recommendations
type OptimizationType string

const (
	OptimizationRightsize       OptimizationType = "rightsize"
	OptimizationIdleResource    OptimizationType = "idle_resource"
	OptimizationOverprovisioned OptimizationType = "overprovisioned"
	OptimizationUnderutil       OptimizationType = "underutilized"
	OptimizationSpot            OptimizationType = "spot_instance"
	OptimizationCommitment      OptimizationType = "commitment_discount"
)

// Optimization represents a cost optimization recommendation
type Optimization struct {
	Type           OptimizationType
	ResourceType   ResourceType
	ResourceName   string
	Namespace      string
	CurrentCost    float64
	OptimizedCost  float64
	Savings        float64
	SavingsPercent float64
	Priority       string // "critical", "high", "medium", "low"
	Description    string
	Action         string
	Impact         string
	Confidence     float64 // 0.0 to 1.0
	Timestamp      time.Time
}

// CostOptimizer provides cost optimization recommendations
type CostOptimizer struct {
	calculator *CostCalculator
}

// NewCostOptimizer creates a new cost optimizer
func NewCostOptimizer(calculator *CostCalculator) *CostOptimizer {
	return &CostOptimizer{
		calculator: calculator,
	}
}

// AnalyzePodOptimization analyzes a pod for optimization opportunities
func (o *CostOptimizer) AnalyzePodOptimization(
	name, namespace string,
	requestedCPU, actualCPU float64,
	requestedMemory, actualMemory float64,
	hoursRunning float64,
) []Optimization {
	optimizations := make([]Optimization, 0)

	// Calculate current cost
	currentCost := o.calculator.CalculatePodCost(name, namespace, requestedCPU, requestedMemory, hoursRunning)

	// Check for overprovisioned CPU
	if actualCPU > 0 && actualCPU < requestedCPU*0.3 {
		// Using less than 30% of requested CPU
		optimizedCPU := actualCPU * 1.2 // Add 20% buffer
		optimizedCost := o.calculator.CalculatePodCost(name, namespace, optimizedCPU, requestedMemory, hoursRunning)

		savings := currentCost.TotalCostMonth - optimizedCost.TotalCostMonth
		savingsPercent := (savings / currentCost.TotalCostMonth) * 100

		optimizations = append(optimizations, Optimization{
			Type:           OptimizationOverprovisioned,
			ResourceType:   ResourceTypePod,
			ResourceName:   name,
			Namespace:      namespace,
			CurrentCost:    currentCost.TotalCostMonth,
			OptimizedCost:  optimizedCost.TotalCostMonth,
			Savings:        savings,
			SavingsPercent: savingsPercent,
			Priority:       getPriority(savingsPercent),
			Description:    fmt.Sprintf("CPU is overprovisioned. Requested: %.2f cores, Actual usage: %.2f cores (%.1f%%)", requestedCPU, actualCPU, (actualCPU/requestedCPU)*100),
			Action:         fmt.Sprintf("Reduce CPU request from %.2f to %.2f cores", requestedCPU, optimizedCPU),
			Impact:         fmt.Sprintf("Save $%.2f/month (%.1f%% reduction)", savings, savingsPercent),
			Confidence:     0.85,
			Timestamp:      time.Now(),
		})
	}

	// Check for overprovisioned Memory
	if actualMemory > 0 && actualMemory < requestedMemory*0.3 {
		optimizedMemory := actualMemory * 1.2
		optimizedCost := o.calculator.CalculatePodCost(name, namespace, requestedCPU, optimizedMemory, hoursRunning)

		savings := currentCost.TotalCostMonth - optimizedCost.TotalCostMonth
		savingsPercent := (savings / currentCost.TotalCostMonth) * 100

		optimizations = append(optimizations, Optimization{
			Type:           OptimizationOverprovisioned,
			ResourceType:   ResourceTypePod,
			ResourceName:   name,
			Namespace:      namespace,
			CurrentCost:    currentCost.TotalCostMonth,
			OptimizedCost:  optimizedCost.TotalCostMonth,
			Savings:        savings,
			SavingsPercent: savingsPercent,
			Priority:       getPriority(savingsPercent),
			Description:    fmt.Sprintf("Memory is overprovisioned. Requested: %.2f GB, Actual usage: %.2f GB (%.1f%%)", requestedMemory, actualMemory, (actualMemory/requestedMemory)*100),
			Action:         fmt.Sprintf("Reduce memory request from %.2f to %.2f GB", requestedMemory, optimizedMemory),
			Impact:         fmt.Sprintf("Save $%.2f/month (%.1f%% reduction)", savings, savingsPercent),
			Confidence:     0.85,
			Timestamp:      time.Now(),
		})
	}

	// Check for idle resources
	if actualCPU == 0 && actualMemory == 0 && hoursRunning > 24 {
		optimizations = append(optimizations, Optimization{
			Type:           OptimizationIdleResource,
			ResourceType:   ResourceTypePod,
			ResourceName:   name,
			Namespace:      namespace,
			CurrentCost:    currentCost.TotalCostMonth,
			OptimizedCost:  0,
			Savings:        currentCost.TotalCostMonth,
			SavingsPercent: 100,
			Priority:       "high",
			Description:    fmt.Sprintf("Pod appears to be idle (no CPU/memory usage for %.1f hours)", hoursRunning),
			Action:         "Investigate and consider deleting this pod",
			Impact:         fmt.Sprintf("Save $%.2f/month (100%% reduction)", currentCost.TotalCostMonth),
			Confidence:     0.7,
			Timestamp:      time.Now(),
		})
	}

	return optimizations
}

// AnalyzeNodeOptimization analyzes node utilization
func (o *CostOptimizer) AnalyzeNodeOptimization(
	name string,
	totalCPU, usedCPU float64,
	totalMemory, usedMemory float64,
) []Optimization {
	optimizations := make([]Optimization, 0)

	cpuUtil := usedCPU / totalCPU
	memUtil := usedMemory / totalMemory
	avgUtil := (cpuUtil + memUtil) / 2

	currentCost := o.calculator.CalculateNodeCost(name, totalCPU, totalMemory)

	// Underutilized node (< 30% average utilization)
	if avgUtil < 0.3 {
		optimizations = append(optimizations, Optimization{
			Type:           OptimizationUnderutil,
			ResourceType:   ResourceTypeNode,
			ResourceName:   name,
			Namespace:      "",
			CurrentCost:    currentCost.TotalCostMonth,
			OptimizedCost:  0, // Could be consolidated
			Savings:        currentCost.TotalCostMonth,
			SavingsPercent: 100,
			Priority:       "high",
			Description:    fmt.Sprintf("Node is underutilized. CPU: %.1f%%, Memory: %.1f%%, Average: %.1f%%", cpuUtil*100, memUtil*100, avgUtil*100),
			Action:         "Consider draining and removing this node, or consolidating workloads",
			Impact:         fmt.Sprintf("Potential to save $%.2f/month", currentCost.TotalCostMonth),
			Confidence:     0.75,
			Timestamp:      time.Now(),
		})
	}

	return optimizations
}

// AnalyzePVCOptimization analyzes PVC for unused storage
func (o *CostOptimizer) AnalyzePVCOptimization(
	name, namespace string,
	sizeGB, usedGB float64,
) []Optimization {
	optimizations := make([]Optimization, 0)

	utilization := usedGB / sizeGB
	currentCost := o.calculator.CalculatePVCCost(name, namespace, sizeGB)

	// Overprovisioned storage (< 20% used)
	if utilization < 0.2 {
		optimizedSize := usedGB * 1.5 // 50% buffer
		optimizedCost := o.calculator.CalculatePVCCost(name, namespace, optimizedSize)

		savings := currentCost.TotalCostMonth - optimizedCost.TotalCostMonth
		savingsPercent := (savings / currentCost.TotalCostMonth) * 100

		optimizations = append(optimizations, Optimization{
			Type:           OptimizationOverprovisioned,
			ResourceType:   ResourceTypePVC,
			ResourceName:   name,
			Namespace:      namespace,
			CurrentCost:    currentCost.TotalCostMonth,
			OptimizedCost:  optimizedCost.TotalCostMonth,
			Savings:        savings,
			SavingsPercent: savingsPercent,
			Priority:       getPriority(savingsPercent),
			Description:    fmt.Sprintf("PVC is overprovisioned. Size: %.2f GB, Used: %.2f GB (%.1f%%)", sizeGB, usedGB, utilization*100),
			Action:         fmt.Sprintf("Resize PVC from %.2f GB to %.2f GB", sizeGB, optimizedSize),
			Impact:         fmt.Sprintf("Save $%.2f/month (%.1f%% reduction)", savings, savingsPercent),
			Confidence:     0.8,
			Timestamp:      time.Now(),
		})
	}

	return optimizations
}

// GetTopOptimizations returns the top N optimizations by potential savings
func (o *CostOptimizer) GetTopOptimizations(optimizations []Optimization, limit int) []Optimization {
	// Sort by savings descending
	sorted := make([]Optimization, len(optimizations))
	copy(sorted, optimizations)

	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Savings > sorted[j].Savings
	})

	if limit > 0 && limit < len(sorted) {
		return sorted[:limit]
	}

	return sorted
}

// CalculateTotalSavings calculates total potential savings
func (o *CostOptimizer) CalculateTotalSavings(optimizations []Optimization) float64 {
	total := 0.0
	for _, opt := range optimizations {
		total += opt.Savings
	}
	return total
}

// GroupByType groups optimizations by type
func (o *CostOptimizer) GroupByType(optimizations []Optimization) map[OptimizationType][]Optimization {
	grouped := make(map[OptimizationType][]Optimization)

	for _, opt := range optimizations {
		grouped[opt.Type] = append(grouped[opt.Type], opt)
	}

	return grouped
}

// getPriority determines priority based on savings percentage
func getPriority(savingsPercent float64) string {
	if savingsPercent >= 50 {
		return "critical"
	} else if savingsPercent >= 30 {
		return "high"
	} else if savingsPercent >= 10 {
		return "medium"
	}
	return "low"
}

// GenerateOptimizationReport generates a summary report
func (o *CostOptimizer) GenerateOptimizationReport(optimizations []Optimization) map[string]interface{} {
	totalSavings := o.CalculateTotalSavings(optimizations)
	grouped := o.GroupByType(optimizations)

	byPriority := make(map[string]int)
	for _, opt := range optimizations {
		byPriority[opt.Priority]++
	}

	return map[string]interface{}{
		"total_optimizations": len(optimizations),
		"total_savings_month": totalSavings,
		"total_savings_year":  totalSavings * 12,
		"by_type": map[string]int{
			"rightsize":       len(grouped[OptimizationRightsize]),
			"overprovisioned": len(grouped[OptimizationOverprovisioned]),
			"underutilized":   len(grouped[OptimizationUnderutil]),
			"idle":            len(grouped[OptimizationIdleResource]),
			"spot":            len(grouped[OptimizationSpot]),
			"commitment":      len(grouped[OptimizationCommitment]),
		},
		"by_priority":  byPriority,
		"top_10":       o.GetTopOptimizations(optimizations, 10),
		"generated_at": time.Now(),
	}
}
