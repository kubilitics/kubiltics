package v2

// TopologyNode mirrors the PRD TopologyNode contract (section 11.2 of topology-prd.md).
type TopologyNode struct {
	ID        string            `json:"id"`
	Kind      string            `json:"kind"`
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	APIVersion string           `json:"apiVersion"`

	// Display
	Category string `json:"category"`
	Label    string `json:"label"`

	// Status
	Status       string `json:"status"`
	StatusReason string `json:"statusReason"`

	// Metrics (optional)
	Metrics *NodeMetrics `json:"metrics,omitempty"`

	// Cost (optional)
	Cost *NodeCost `json:"cost,omitempty"`

	// Layout hints
	Layer int    `json:"layer"`
	Group string `json:"group,omitempty"`

	// Detail panel metadata
	Labels     map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	CreatedAt  string            `json:"createdAt"`
}

// NodeMetrics captures the metrics section from the PRD.
type NodeMetrics struct {
	CPUUsage     *int64 `json:"cpuUsage,omitempty"`
	CPURequest   *int64 `json:"cpuRequest,omitempty"`
	CPULimit     *int64 `json:"cpuLimit,omitempty"`
	MemoryUsage  *int64 `json:"memoryUsage,omitempty"`
	MemoryRequest *int64 `json:"memoryRequest,omitempty"`
	MemoryLimit   *int64 `json:"memoryLimit,omitempty"`
	RestartCount  *int64 `json:"restartCount,omitempty"`
	PodCount      *int64 `json:"podCount,omitempty"`
	ReadyCount    *int64 `json:"readyCount,omitempty"`
}

// NodeCost captures cost information attached to a node.
type NodeCost struct {
	MonthlyCostUSD float64 `json:"monthlyCostUSD"`
	DailyCostUSD   float64 `json:"dailyCostUSD"`
}

