package spof

import "time"

// SPOFInventory is the full SPOF inventory for a cluster, returned by the
// GET /api/v1/clusters/{id}/spofs endpoint.
type SPOFInventory struct {
	ClusterID   string     `json:"cluster_id"`
	TotalSPOFs  int        `json:"total_spofs"`
	Critical    int        `json:"critical"`
	High        int        `json:"high"`
	Medium      int        `json:"medium"`
	Low         int        `json:"low"`
	Items       []SPOFItem `json:"items"`
	GeneratedAt time.Time  `json:"generated_at"`
}

// SPOFItem is a single SPOF resource with enriched context.
type SPOFItem struct {
	Name             string        `json:"name"`
	Kind             string        `json:"kind"`
	Namespace        string        `json:"namespace"`
	Reason           string        `json:"reason"`             // human-readable SPOF reason
	ReasonCode       string        `json:"reason_code"`        // "single-replica", "no-pdb", "sole-consumer", etc.
	BlastRadiusScore float64       `json:"blast_radius_score"`
	BlastRadiusLevel string        `json:"blast_radius_level"`
	DependentCount   int           `json:"dependent_count"` // fanIn
	Remediations     []Remediation `json:"remediations"`
}

// Remediation is a recommended action to resolve or mitigate a SPOF.
type Remediation struct {
	Type        string `json:"type"`        // "scale", "hpa", "pdb", "topology-spread"
	Description string `json:"description"`
	Priority    string `json:"priority"`    // "critical", "high", "medium", "low"
}
