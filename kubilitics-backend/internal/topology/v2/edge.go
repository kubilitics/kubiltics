package v2

// RelationshipType is a string alias for relationship type identifiers.
type RelationshipType string

// EdgeStyle is a string alias for edge style identifiers.
type EdgeStyle string

// TopologyEdge mirrors the PRD TopologyEdge contract (section 11.2 of topology-prd.md).
type TopologyEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`

	RelationshipType     RelationshipType `json:"relationshipType"`
	RelationshipCategory string           `json:"relationshipCategory"`
	Label                string           `json:"label"`
	Detail               string           `json:"detail"`

	Style    EdgeStyle `json:"style"`
	Animated bool      `json:"animated"`

	Healthy      bool   `json:"healthy"`
	HealthReason string `json:"healthReason,omitempty"`
}

