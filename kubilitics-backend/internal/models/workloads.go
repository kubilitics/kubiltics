package models

// WorkloadsOverview is the response for GET /clusters/{clusterId}/workloads
type WorkloadsOverview struct {
	Pulse     WorkloadPulse   `json:"pulse"`
	Workloads []WorkloadItem  `json:"workloads"`
	Alerts    WorkloadAlerts  `json:"alerts"`
}

// WorkloadPulse aggregates health counts for the Workloads page hero
type WorkloadPulse struct {
	Total          int     `json:"total"`
	Healthy        int     `json:"healthy"`
	Warning        int     `json:"warning"`
	Critical       int     `json:"critical"`
	OptimalPercent float64 `json:"optimal_percent"`
}

// WorkloadItem represents a single workload controller (Deployment, StatefulSet, etc.)
type WorkloadItem struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Status    string `json:"status"` // Running, Healthy, Optimal, Pending, Failed, Completed
	Ready     int    `json:"ready"`
	Desired   int    `json:"desired"`
	Pressure  string `json:"pressure"` // Low, Medium, High, Zero, Unknown
}

// WorkloadAlerts surfaces top alerts for the Workloads page
type WorkloadAlerts struct {
	Warnings int              `json:"warnings"`
	Critical int              `json:"critical"`
	Top3     []WorkloadAlert  `json:"top_3"`
}

// WorkloadAlert is a single alert item
type WorkloadAlert struct {
	Reason    string `json:"reason"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace"`
}
