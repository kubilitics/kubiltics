package cost

import (
	"errors"
	"fmt"
	"time"
)

// ResourceType represents different types of Kubernetes resources
type ResourceType string

const (
	ResourceTypePod          ResourceType = "pod"
	ResourceTypeNode         ResourceType = "node"
	ResourceTypePVC          ResourceType = "pvc"
	ResourceTypeLoadBalancer ResourceType = "loadbalancer"
	ResourceTypeIngress      ResourceType = "ingress"
)

// CloudProvider represents different cloud providers
type CloudProvider string

const (
	ProviderAWS     CloudProvider = "aws"
	ProviderGCP     CloudProvider = "gcp"
	ProviderAzure   CloudProvider = "azure"
	ProviderGeneric CloudProvider = "generic"
)

// PricingConfig holds pricing information
type PricingConfig struct {
	Provider                 CloudProvider
	CPUPricePerHour          float64 // Price per vCPU per hour
	MemPricePerGBHour        float64 // Price per GB memory per hour
	StoragePricePerGBMonth   float64 // Price per GB storage per month
	NetworkPricePerGB        float64 // Price per GB network egress
	LoadBalancerPricePerHour float64
}

// ResourceCost represents the cost of a single resource
type ResourceCost struct {
	ResourceType   ResourceType
	ResourceName   string
	Namespace      string
	CPUCost        float64
	MemoryCost     float64
	StorageCost    float64
	NetworkCost    float64
	TotalCostHour  float64
	TotalCostDay   float64
	TotalCostMonth float64
	Timestamp      time.Time
}

// ClusterCost represents total cluster costs
type ClusterCost struct {
	TotalCostHour  float64
	TotalCostDay   float64
	TotalCostMonth float64
	ByNamespace    map[string]float64
	ByResourceType map[ResourceType]float64
	ResourceCount  int
	Timestamp      time.Time
}

// CostCalculator calculates costs for Kubernetes resources
type CostCalculator struct {
	pricing PricingConfig
}

// NewCostCalculator creates a new cost calculator
func NewCostCalculator(provider CloudProvider) *CostCalculator {
	pricing := getDefaultPricing(provider)
	return &CostCalculator{
		pricing: pricing,
	}
}

// NewCostCalculatorWithPricing creates a calculator with custom pricing
func NewCostCalculatorWithPricing(pricing PricingConfig) *CostCalculator {
	return &CostCalculator{
		pricing: pricing,
	}
}

// getDefaultPricing returns default pricing for a cloud provider
func getDefaultPricing(provider CloudProvider) PricingConfig {
	switch provider {
	case ProviderAWS:
		return PricingConfig{
			Provider:                 ProviderAWS,
			CPUPricePerHour:          0.04,  // ~$0.04 per vCPU-hour (t3.medium equivalent)
			MemPricePerGBHour:        0.005, // ~$0.005 per GB-hour
			StoragePricePerGBMonth:   0.10,  // EBS GP3
			NetworkPricePerGB:        0.09,  // Egress pricing
			LoadBalancerPricePerHour: 0.025,
		}
	case ProviderGCP:
		return PricingConfig{
			Provider:                 ProviderGCP,
			CPUPricePerHour:          0.035,
			MemPricePerGBHour:        0.0047,
			StoragePricePerGBMonth:   0.10, // Standard PD
			NetworkPricePerGB:        0.12,
			LoadBalancerPricePerHour: 0.025,
		}
	case ProviderAzure:
		return PricingConfig{
			Provider:                 ProviderAzure,
			CPUPricePerHour:          0.042,
			MemPricePerGBHour:        0.0055,
			StoragePricePerGBMonth:   0.12, // Standard SSD
			NetworkPricePerGB:        0.087,
			LoadBalancerPricePerHour: 0.025,
		}
	default: // Generic
		return PricingConfig{
			Provider:                 ProviderGeneric,
			CPUPricePerHour:          0.04,
			MemPricePerGBHour:        0.005,
			StoragePricePerGBMonth:   0.10,
			NetworkPricePerGB:        0.09,
			LoadBalancerPricePerHour: 0.025,
		}
	}
}

// CalculatePodCost calculates cost for a pod
func (c *CostCalculator) CalculatePodCost(
	name, namespace string,
	cpuCores float64, // CPU in cores
	memoryGB float64, // Memory in GB
	hoursRunning float64, // Hours the pod has been running
) ResourceCost {
	// CPU cost
	cpuCost := cpuCores * c.pricing.CPUPricePerHour * hoursRunning

	// Memory cost
	memoryCost := memoryGB * c.pricing.MemPricePerGBHour * hoursRunning

	// Total per-hour cost (for current usage)
	totalCostHour := (cpuCores * c.pricing.CPUPricePerHour) + (memoryGB * c.pricing.MemPricePerGBHour)

	return ResourceCost{
		ResourceType:   ResourceTypePod,
		ResourceName:   name,
		Namespace:      namespace,
		CPUCost:        cpuCost,
		MemoryCost:     memoryCost,
		StorageCost:    0,
		NetworkCost:    0,
		TotalCostHour:  totalCostHour,
		TotalCostDay:   totalCostHour * 24,
		TotalCostMonth: totalCostHour * 24 * 30,
		Timestamp:      time.Now(),
	}
}

// CalculateNodeCost calculates cost for a node
func (c *CostCalculator) CalculateNodeCost(
	name string,
	cpuCores float64,
	memoryGB float64,
) ResourceCost {
	// Node cost per hour
	cpuCostHour := cpuCores * c.pricing.CPUPricePerHour
	memoryCostHour := memoryGB * c.pricing.MemPricePerGBHour
	totalCostHour := cpuCostHour + memoryCostHour

	return ResourceCost{
		ResourceType:   ResourceTypeNode,
		ResourceName:   name,
		Namespace:      "",
		CPUCost:        cpuCostHour,
		MemoryCost:     memoryCostHour,
		TotalCostHour:  totalCostHour,
		TotalCostDay:   totalCostHour * 24,
		TotalCostMonth: totalCostHour * 24 * 30,
		Timestamp:      time.Now(),
	}
}

// CalculatePVCCost calculates cost for a PersistentVolumeClaim
func (c *CostCalculator) CalculatePVCCost(
	name, namespace string,
	sizeGB float64,
) ResourceCost {
	// Storage cost per month, convert to hourly
	storageCostMonth := sizeGB * c.pricing.StoragePricePerGBMonth
	storageCostHour := storageCostMonth / (24 * 30)

	return ResourceCost{
		ResourceType:   ResourceTypePVC,
		ResourceName:   name,
		Namespace:      namespace,
		CPUCost:        0,
		MemoryCost:     0,
		StorageCost:    storageCostMonth,
		TotalCostHour:  storageCostHour,
		TotalCostDay:   storageCostHour * 24,
		TotalCostMonth: storageCostMonth,
		Timestamp:      time.Now(),
	}
}

// CalculateLoadBalancerCost calculates cost for a LoadBalancer service
func (c *CostCalculator) CalculateLoadBalancerCost(
	name, namespace string,
	dataTransferGB float64, // GB transferred per month
) ResourceCost {
	// LoadBalancer fixed cost per hour
	lbCostHour := c.pricing.LoadBalancerPricePerHour

	// Network egress cost (monthly)
	networkCostMonth := dataTransferGB * c.pricing.NetworkPricePerGB
	networkCostHour := networkCostMonth / (24 * 30)

	totalCostHour := lbCostHour + networkCostHour

	return ResourceCost{
		ResourceType:   ResourceTypeLoadBalancer,
		ResourceName:   name,
		Namespace:      namespace,
		CPUCost:        0,
		MemoryCost:     0,
		StorageCost:    0,
		NetworkCost:    networkCostMonth,
		TotalCostHour:  totalCostHour,
		TotalCostDay:   totalCostHour * 24,
		TotalCostMonth: totalCostHour * 24 * 30,
		Timestamp:      time.Now(),
	}
}

// AggregateClusterCost aggregates costs for the entire cluster
func (c *CostCalculator) AggregateClusterCost(resources []ResourceCost) ClusterCost {
	totalHour := 0.0
	byNamespace := make(map[string]float64)
	byType := make(map[ResourceType]float64)

	for _, r := range resources {
		totalHour += r.TotalCostHour

		// By namespace
		if r.Namespace != "" {
			byNamespace[r.Namespace] += r.TotalCostHour
		}

		// By type
		byType[r.ResourceType] += r.TotalCostHour
	}

	return ClusterCost{
		TotalCostHour:  totalHour,
		TotalCostDay:   totalHour * 24,
		TotalCostMonth: totalHour * 24 * 30,
		ByNamespace:    byNamespace,
		ByResourceType: byType,
		ResourceCount:  len(resources),
		Timestamp:      time.Now(),
	}
}

// EstimateYearlyCost estimates yearly cost from monthly cost
func EstimateYearlyCost(monthlyCost float64) float64 {
	return monthlyCost * 12
}

// CalculateSavings calculates potential savings
func CalculateSavings(currentCost, optimizedCost float64) float64 {
	return currentCost - optimizedCost
}

// CalculateSavingsPercentage calculates savings as percentage
func CalculateSavingsPercentage(currentCost, optimizedCost float64) float64 {
	if currentCost == 0 {
		return 0
	}
	return ((currentCost - optimizedCost) / currentCost) * 100
}

// ParseCPU parses Kubernetes CPU format to cores
// Examples: "100m" = 0.1, "1" = 1.0, "2000m" = 2.0
func ParseCPU(cpu string) (float64, error) {
	if cpu == "" {
		return 0, errors.New("empty CPU value")
	}

	// Handle millicores (m suffix)
	if len(cpu) > 1 && cpu[len(cpu)-1] == 'm' {
		var millicores int
		_, err := fmt.Sscanf(cpu, "%dm", &millicores)
		if err != nil {
			return 0, err
		}
		return float64(millicores) / 1000.0, nil
	}

	// Handle regular cores
	var cores float64
	_, err := fmt.Sscanf(cpu, "%f", &cores)
	if err != nil {
		return 0, err
	}
	return cores, nil
}

// ParseMemory parses Kubernetes memory format to GB
// Examples: "128Mi" = 0.128, "1Gi" = 1.0, "500Mi" = 0.5
func ParseMemory(memory string) (float64, error) {
	if memory == "" {
		return 0, errors.New("empty memory value")
	}

	// Handle different units
	if len(memory) > 2 {
		suffix := memory[len(memory)-2:]
		valueStr := memory[:len(memory)-2]

		var value float64
		_, err := fmt.Sscanf(valueStr, "%f", &value)
		if err != nil {
			return 0, err
		}

		switch suffix {
		case "Ki":
			return value / (1024 * 1024), nil // KB to GB
		case "Mi":
			return value / 1024, nil // MB to GB
		case "Gi":
			return value, nil // GB
		case "Ti":
			return value * 1024, nil // TB to GB
		default:
			// Try single character suffix
			if len(memory) > 1 {
				suffix = memory[len(memory)-1:]
				valueStr = memory[:len(memory)-1]
				_, err := fmt.Sscanf(valueStr, "%f", &value)
				if err != nil {
					return 0, err
				}

				switch suffix {
				case "K":
					return value / (1000 * 1000), nil
				case "M":
					return value / 1000, nil
				case "G":
					return value, nil
				case "T":
					return value * 1000, nil
				}
			}
			return 0, fmt.Errorf("unknown memory unit: %s", suffix)
		}
	}

	// No suffix, assume bytes
	var bytes float64
	_, err := fmt.Sscanf(memory, "%f", &bytes)
	if err != nil {
		return 0, err
	}
	return bytes / (1024 * 1024 * 1024), nil
}

// GetPricing returns current pricing configuration
func (c *CostCalculator) GetPricing() PricingConfig {
	return c.pricing
}

// UpdatePricing updates pricing configuration
func (c *CostCalculator) UpdatePricing(pricing PricingConfig) {
	c.pricing = pricing
}
