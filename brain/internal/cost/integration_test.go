package cost

import (
	"fmt"
	"testing"
	"time"
)

// TestCostCalculationPipeline tests the complete cost calculation workflow
func TestCostCalculationPipeline(t *testing.T) {
	t.Run("End-to-end pod cost calculation", func(t *testing.T) {
		calculator := NewCostCalculator(CloudProviderAWS)

		podCost := calculator.CalculatePodCost("nginx-pod", "production", 2.0, 4.0, 720.0)

		if podCost.TotalCostMonth <= 0 {
			t.Error("Expected positive total cost")
		}
		if podCost.CPUCost <= 0 {
			t.Error("Expected positive CPU cost")
		}
		if podCost.MemoryCost <= 0 {
			t.Error("Expected positive memory cost")
		}

		t.Logf("Pod cost breakdown: Month=$%.2f, CPU=$%.2f, Memory=$%.2f",
			podCost.TotalCostMonth, podCost.CPUCost, podCost.MemoryCost)
	})

	t.Run("Multi-cloud price comparison", func(t *testing.T) {
		providers := []CloudProvider{CloudProviderAWS, CloudProviderGCP, CloudProviderAzure}
		costs := make(map[CloudProvider]float64)

		for _, provider := range providers {
			calculator := NewCostCalculator(provider)
			podCost := calculator.CalculatePodCost("test-pod", "default", 1.0, 2.0, 720.0)
			costs[provider] = podCost.TotalCostMonth
		}

		for provider, cost := range costs {
			if cost <= 0 {
				t.Errorf("Provider %s has invalid cost: %f", provider, cost)
			}
		}

		t.Logf("Multi-cloud pricing: AWS=$%.2f, GCP=$%.2f, Azure=$%.2f",
			costs[CloudProviderAWS], costs[CloudProviderGCP], costs[CloudProviderAzure])
	})

	t.Run("Cluster cost aggregation", func(t *testing.T) {
		calculator := NewCostCalculator(CloudProviderAWS)

		resources := []ResourceCost{
			calculator.CalculatePodCost("pod-1", "prod", 2.0, 4.0, 720.0),
			calculator.CalculatePodCost("pod-2", "prod", 1.0, 2.0, 720.0),
			calculator.CalculatePodCost("pod-3", "staging", 0.5, 1.0, 720.0),
		}

		clusterCost := calculator.AggregateClusterCost(resources)

		if clusterCost.ResourceCount != len(resources) {
			t.Errorf("Expected %d resources, got %d", len(resources), clusterCost.ResourceCount)
		}
		if clusterCost.TotalCostMonth <= 0 {
			t.Error("Expected positive total cluster cost")
		}
		if clusterCost.ByNamespace["prod"] <= 0 {
			t.Error("Expected positive cost for prod namespace")
		}

		t.Logf("Cluster cost: Month=$%.2f, Namespaces=%+v",
			clusterCost.TotalCostMonth, clusterCost.ByNamespace)
	})
}

// TestCostOptimizationPipeline tests the optimization workflow
func TestCostOptimizationPipeline(t *testing.T) {
	calculator := NewCostCalculator(CloudProviderAWS)
	optimizer := NewCostOptimizer(calculator)

	t.Run("Pod rightsizing optimization", func(t *testing.T) {
		optimizations := optimizer.AnalyzePodOptimization(
			"overprovisioned-pod", "production",
			2.0, 0.5,
			4.0, 1.0,
			720.0,
		)

		found := false
		for _, opt := range optimizations {
			if opt.Type == OptimizationRightsizing {
				found = true
				if opt.Savings <= 0 {
					t.Error("Expected positive savings from rightsizing")
				}
				t.Logf("Rightsizing recommendation: save $%.2f/month", opt.Savings)
			}
		}
		if !found {
			t.Error("Expected rightsizing optimization for overprovisioned pod")
		}
	})

	t.Run("Idle resource detection", func(t *testing.T) {
		optimizations := optimizer.AnalyzePodOptimizationV2(
			"idle-pod", "development",
			PodResources{
				RequestedCPU:    1.0,
				RequestedMemory: 2048,
				UsedCPU:         0.01,
				UsedMemory:      100,
			},
			50.0,
		)

		found := false
		for _, opt := range optimizations {
			if opt.Type == OptimizationIdleResources {
				found = true
				t.Logf("Idle resource detected: save $%.2f/month", opt.PotentialSavings)
			}
		}
		if !found {
			t.Error("Expected idle resource detection")
		}
	})

	t.Run("Multiple optimization recommendations", func(t *testing.T) {
		optimizations := optimizer.AnalyzePodOptimizationV2(
			"multi-issue-pod", "staging",
			PodResources{
				RequestedCPU:    4.0,
				RequestedMemory: 8192,
				UsedCPU:         0.5,
				UsedMemory:      1024,
			},
			200.0,
		)

		if len(optimizations) == 0 {
			t.Error("Expected at least one optimization recommendation")
		}

		totalSavings := 0.0
		for _, opt := range optimizations {
			totalSavings += opt.PotentialSavings
			t.Logf("Optimization: %s - $%.2f/month", opt.Type, opt.PotentialSavings)
		}
		t.Logf("Total potential savings: $%.2f/month", totalSavings)
	})

	t.Run("Node optimization analysis", func(t *testing.T) {
		optimizations := optimizer.AnalyzeNodeOptimizationV2(
			"node-pool-1",
			NodeResources{
				TotalCPU:        8.0,
				TotalMemory:     16384,
				AllocatedCPU:    3.0,
				AllocatedMemory: 6000,
			},
			500.0,
		)

		if len(optimizations) == 0 {
			t.Error("Expected node optimization recommendations")
		}
		for _, opt := range optimizations {
			t.Logf("Node optimization: %s - $%.2f/month", opt.Type, opt.PotentialSavings)
		}
	})
}

// TestCostParsingFunctions tests resource parsing utilities
func TestCostParsingFunctions(t *testing.T) {
	t.Run("CPU parsing", func(t *testing.T) {
		testCases := []struct {
			input    string
			expected float64
		}{
			{"1", 1.0},
			{"2.5", 2.5},
			{"500m", 0.5},
			{"1000m", 1.0},
			{"250m", 0.25},
		}
		for _, tc := range testCases {
			result, err := ParseCPU(tc.input)
			if err != nil {
				t.Errorf("Failed to parse CPU '%s': %v", tc.input, err)
				continue
			}
			if result != tc.expected {
				t.Errorf("CPU parse mismatch for '%s': got %f, expected %f", tc.input, result, tc.expected)
			}
		}
	})

	t.Run("Memory parsing", func(t *testing.T) {
		testCases := []struct {
			input    string
			expected float64
		}{
			{"1Gi", 1.0},
			{"2Gi", 2.0},
			{"512Mi", 0.5},
			{"1024Mi", 1.0},
		}
		for _, tc := range testCases {
			result, err := ParseMemory(tc.input)
			if err != nil {
				t.Errorf("Failed to parse memory '%s': %v", tc.input, err)
				continue
			}
			if result != tc.expected {
				t.Errorf("Memory parse mismatch for '%s': got %f, expected %f", tc.input, result, tc.expected)
			}
		}
	})
}

// TestCostIntegrationPerformance tests performance with large datasets
func TestCostIntegrationPerformance(t *testing.T) {
	t.Run("Large cluster cost calculation", func(t *testing.T) {
		calculator := NewCostCalculator(CloudProviderAWS)

		resources := make([]ResourceCost, 1000)
		for i := 0; i < 1000; i++ {
			resources[i] = calculator.CalculatePodCost(
				fmt.Sprintf("pod-%d", i), "production",
				1.0+float64(i%4)*0.5, 2.0+float64(i%8)*0.5, 720.0,
			)
		}

		start := time.Now()
		clusterCost := calculator.AggregateClusterCost(resources)
		duration := time.Since(start)

		if duration > time.Second {
			t.Errorf("Aggregation too slow: %v", duration)
		}
		if clusterCost.TotalCostMonth <= 0 {
			t.Error("Expected positive total cost")
		}
		t.Logf("Aggregated 1000 pods in %v: total cost $%.2f", duration, clusterCost.TotalCostMonth)
	})

	t.Run("Concurrent cost calculations", func(t *testing.T) {
		calculator := NewCostCalculator(CloudProviderAWS)
		results := make(chan ResourceCost, 100)

		for i := 0; i < 100; i++ {
			go func(idx int) {
				cost := calculator.CalculatePodCost(
					fmt.Sprintf("pod-%d", idx), "production", 1.0, 2.0, 720.0)
				results <- cost
			}(i)
		}

		successCount := 0
		for i := 0; i < 100; i++ {
			select {
			case cost := <-results:
				if cost.TotalCostMonth > 0 {
					successCount++
				}
			case <-time.After(5 * time.Second):
				t.Fatal("Timeout waiting for concurrent calculations")
			}
		}

		if successCount != 100 {
			t.Errorf("Expected 100 successful calculations, got %d", successCount)
		}
	})
}
