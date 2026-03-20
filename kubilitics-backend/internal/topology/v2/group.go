package v2

// GroupType represents the supported group types.
type GroupType string

// TopologyGroup mirrors the PRD TopologyGroup contract (section 11.2 of topology-prd.md).
type TopologyGroup struct {
	ID      string    `json:"id"`
	Label   string    `json:"label"`
	Type    GroupType `json:"type"`
	Members []string  `json:"members"`

	Collapsed bool `json:"collapsed"`

	Style GroupStyle   `json:"style"`
	Metrics *GroupMetrics `json:"metrics,omitempty"`
}

// GroupStyle contains visual hints for frontend grouping.
type GroupStyle struct {
	BackgroundColor string `json:"backgroundColor"`
	BorderColor     string `json:"borderColor"`
}

// GroupMetrics aggregates metrics at group level.
type GroupMetrics struct {
	TotalCostUSD    *float64 `json:"totalCostUSD,omitempty"`
	PodCount        *int64   `json:"podCount,omitempty"`
	HealthyPodCount *int64   `json:"healthyPodCount,omitempty"`
}

