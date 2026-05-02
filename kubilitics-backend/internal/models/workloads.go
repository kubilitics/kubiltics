package models

// WorkloadsOverview is the response for GET /clusters/{clusterId}/workloads
type WorkloadsOverview struct {
	Pulse     WorkloadPulse   `json:"pulse"`
	Workloads []WorkloadItem  `json:"workloads"`
	Alerts    WorkloadAlerts  `json:"alerts"`
}

// WorkloadPulse aggregates health counts for the Workloads page hero.
//
// Warning counts controller-level degradation only (replicas below desired,
// pending pods). Event-level K8s Warning events are tracked separately in
// EventWarnings so the two signals are not conflated.
type WorkloadPulse struct {
	Total          int     `json:"total"`
	Healthy        int     `json:"healthy"`
	Warning        int     `json:"warning"`        // controller + pod degradation only
	EventWarnings  int     `json:"event_warnings"` // count of K8s Warning events (separate signal)
	Critical       int     `json:"critical"`
	OptimalPercent float64 `json:"optimal_percent"`
}

// WorkloadItem represents a single workload controller (Deployment, StatefulSet, etc.)
type WorkloadItem struct {
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Status         string `json:"status"`          // Running, Healthy, Optimal, Pending, Failed, Completed
	Ready          int    `json:"ready"`
	Desired        int    `json:"desired"`
	Pressure       string `json:"pressure"`        // Low, Medium, High, Zero, Unknown
	MaxPodRestarts int    `json:"max_pod_restarts,omitempty"` // max restart count across owned pods
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
