package models

// ClusterOverview is the response for GET /clusters/{clusterId}/overview
type ClusterOverview struct {
	Health       OverviewHealth       `json:"health"`
	Counts       OverviewCounts       `json:"counts"`
	PodStatus    OverviewPodStatus   `json:"pod_status"`
	Alerts       OverviewAlerts      `json:"alerts"`
	Utilization  *OverviewUtilization `json:"utilization,omitempty"`
}

type OverviewHealth struct {
	Score  int    `json:"score"`
	Grade  string `json:"grade"`  // A, B, C, D, F
	Status string `json:"status"` // excellent, good, fair, poor, critical
}

type OverviewCounts struct {
	Nodes       int `json:"nodes"`
	Pods        int `json:"pods"`
	Namespaces  int `json:"namespaces"`
	Deployments int `json:"deployments"`
}

type OverviewPodStatus struct {
	Running       int `json:"running"`
	Pending       int `json:"pending"`
	Failed        int `json:"failed"`
	Succeeded     int `json:"succeeded"`
	TotalRestarts int `json:"total_restarts"`
}

type OverviewAlerts struct {
	Warnings int              `json:"warnings"`
	Critical int              `json:"critical"`
	Top3     []OverviewAlert  `json:"top_3"`
}

type OverviewAlert struct {
	Reason    string `json:"reason"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace"`
}

type OverviewUtilization struct {
	CPUPercent    int     `json:"cpu_percent"`
	MemoryPercent int     `json:"memory_percent"`
	CPUCores      float64 `json:"cpu_cores"`
	MemoryGiB     float64 `json:"memory_gib"`
}
