package healthscore

// Severity levels for health findings, following k8s-health-checker conventions.
type Severity int

const (
	SeverityPass     Severity = 0
	SeverityInfo     Severity = 1
	SeverityWarning  Severity = 2
	SeverityCritical Severity = 3
)

// Penalty deductions per severity tier (Kubecost pattern).
var severityPenalty = map[Severity]int{
	SeverityPass:     0,
	SeverityInfo:     1,
	SeverityWarning:  3,
	SeverityCritical: 8,
}

// Category identifies a health scoring dimension.
type Category string

const (
	CategoryNodes     Category = "nodes"
	CategoryWorkloads Category = "workloads"
	CategoryPods      Category = "pods"
	CategoryStability Category = "stability"
	CategoryEvents    Category = "events"
)

// CategoryWeight defines how much each category contributes to the final score.
var CategoryWeight = map[Category]float64{
	CategoryNodes:     0.25,
	CategoryWorkloads: 0.25,
	CategoryPods:      0.25,
	CategoryStability: 0.15,
	CategoryEvents:    0.10,
}

// Finding represents a single health check result.
type Finding struct {
	Category Category `json:"category"`
	Severity Severity `json:"severity"`
	Check    string   `json:"check"`
	Message  string   `json:"message"`
	Resource string   `json:"resource,omitempty"`
}

// CategoryScore is the per-category health breakdown.
type CategoryScore struct {
	Name     Category  `json:"name"`
	Score    int       `json:"score"`
	Findings []Finding `json:"findings"`
}

// HealthResult is the complete output of the scoring engine.
type HealthResult struct {
	Score      int                         `json:"score"`
	Grade      string                      `json:"grade"`
	Status     string                      `json:"status"`
	Categories map[Category]*CategoryScore `json:"categories"`
	Findings   []Finding                   `json:"findings"`
	Insight    string                      `json:"insight"`
}
