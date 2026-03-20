package financial

import "time"

// FinancialStack describes which cost-related components are installed in a cluster.
type FinancialStack struct {
	PrometheusInstalled       bool   `json:"prometheus_installed"`
	PrometheusReleaseName     string `json:"prometheus_release_name,omitempty"`
	PrometheusNamespace       string `json:"prometheus_namespace,omitempty"`
	PrometheusEndpoint        string `json:"prometheus_endpoint"`
	OpenCostInstalled         bool   `json:"opencost_installed"`
	OpenCostReleaseName       string `json:"opencost_release_name,omitempty"`
	OpenCostNamespace         string `json:"opencost_namespace,omitempty"`
	OpenCostEndpoint          string `json:"opencost_endpoint"`
	KubeStateMetricsInstalled bool   `json:"kube_state_metrics_installed"`
}

// CostEstimate is a per-addon cost estimate for planning.
type CostEstimate struct {
	AddonID        string
	ReleaseName    string
	MonthlyCostUSD float64
	CPUMillicores  int
	MemoryMB       int
	StorageGB      int
	ClusterTier    string
}

// PlanCostEstimate aggregates cost estimates for an install plan.
type PlanCostEstimate struct {
	Steps                    []CostEstimate
	TotalMonthlyCostDeltaUSD float64
}

// OpenCostAllocation is a single allocation row from OpenCost allocation API.
// CPUCoreRequestAvg/CPUCoreUsageAvg are average cores over the query window.
// RAMByteRequestAvg/RAMByteUsageAvg are average bytes over the query window.
// These are populated when OpenCost returns cpuCoreRequestAverage etc. in the
// /allocation/compute response; they are zero when OpenCost does not emit them.
type OpenCostAllocation struct {
	Name              string
	Namespace         string
	ClusterID         string
	CPUCost           float64
	MemoryCost        float64
	StorageCost       float64
	TotalCost         float64
	Window            string
	CPUCoreRequestAvg float64 // avg cores requested over window
	CPUCoreUsageAvg   float64 // avg cores actually used over window
	RAMByteRequestAvg float64 // avg RAM bytes requested over window
	RAMByteUsageAvg   float64 // avg RAM bytes actually used over window
}

// AddonCostAttribution attributes cost to an add-on release from OpenCost.
type AddonCostAttribution struct {
	AddonInstallID string
	ReleaseName    string
	Namespace      string
	MonthlyCostUSD float64
	Efficiency     float64
	Window         string
	FetchedAt      time.Time
}

// RightsizingRecommendation provides resource adjustment suggestions based on historical usage.
type RightsizingRecommendation struct {
	AddonInstallID string    `json:"addon_install_id"`
	ReleaseName    string    `json:"release_name"`
	Namespace      string    `json:"namespace"`
	CurrentCPU     float64   `json:"current_cpu"`
	CurrentMem     float64   `json:"current_mem"`
	SuggestedCPU   float64   `json:"suggested_cpu"`
	SuggestedMem   float64   `json:"suggested_mem"`
	MonthlySavings float64   `json:"monthly_savings_usd"`
	Confidence     float64   `json:"confidence"` // 0.0 to 1.0
	Description    string    `json:"description"`
	GeneratedAt    time.Time `json:"generated_at"`
}
