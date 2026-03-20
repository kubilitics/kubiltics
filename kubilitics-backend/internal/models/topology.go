package models

import "time"

// NodeMetadata is the contract node metadata (labels, annotations, uid, createdAt).
type NodeMetadata struct {
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	CreatedAt   string            `json:"createdAt"`
	UID         string            `json:"uid"`
}

// NodeComputed is the contract computed fields (health, restartCount, replicas).
type NodeComputed struct {
	Health       string `json:"health"`
	RestartCount *int   `json:"restartCount,omitempty"`
	Replicas     *struct {
		Desired   int `json:"desired"`
		Ready     int `json:"ready"`
		Available int `json:"available"`
	} `json:"replicas,omitempty"`
}

// TopologyNode represents a node in the topology graph (contract: kind, id, metadata, computed).
type TopologyNode struct {
	ID        string        `json:"id"`
	Kind      string        `json:"kind"` // Contract: use "kind" not "type"
	Namespace string        `json:"namespace"`
	Name      string        `json:"name"`
	APIVersion string       `json:"apiVersion,omitempty"`
	Status    string        `json:"status,omitempty"`
	Metadata  NodeMetadata `json:"metadata"`
	Computed  NodeComputed  `json:"computed"`
	Position  *Position     `json:"position,omitempty"`
}

// TopologyEdge represents a relationship between nodes (contract: relationshipType, source, target, metadata).
type TopologyEdge struct {
	ID               string        `json:"id"`
	Source           string        `json:"source"`
	Target           string        `json:"target"`
	RelationshipType string        `json:"relationshipType"` // Contract: use "relationshipType" not "type"
	Label            string        `json:"label"`
	Metadata         EdgeMetadata `json:"metadata"`
}

// EdgeMetadata is the contract edge metadata (derivation, confidence, sourceField).
type EdgeMetadata struct {
	Derivation  string  `json:"derivation"`
	Confidence  float64 `json:"confidence"`
	SourceField string  `json:"sourceField"`
}

// Position represents node coordinates
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// GraphWarning is a non-fatal topology warning (contract).
type GraphWarning struct {
	Code          string   `json:"code"`
	Message       string   `json:"message"`
	AffectedNodes []string `json:"affectedNodes,omitempty"`
}

// TopologyGraphMetadata is the contract graph-level metadata.
type TopologyGraphMetadata struct {
	ClusterId   string         `json:"clusterId"`
	GeneratedAt string         `json:"generatedAt"` // ISO8601
	LayoutSeed  string         `json:"layoutSeed"`
	IsComplete  bool           `json:"isComplete"`
	Warnings    []GraphWarning `json:"warnings,omitempty"`
	// For snapshot storage (populated by ToTopologyGraph)
	NodeCount int `json:"node_count,omitempty"`
	EdgeCount int `json:"edge_count,omitempty"`
}

// TopologyGraph represents the complete topology (contract: schemaVersion, nodes, edges, metadata).
type TopologyGraph struct {
	SchemaVersion string                 `json:"schemaVersion"`
	Nodes         []TopologyNode         `json:"nodes"`
	Edges         []TopologyEdge         `json:"edges"`
	Metadata      TopologyGraphMetadata  `json:"metadata"`
}

// TopologySnapshot stores topology state for history
type TopologySnapshot struct {
	ID        string    `json:"id" db:"id"`
	ClusterID string    `json:"cluster_id" db:"cluster_id"`
	Namespace string    `json:"namespace" db:"namespace"`
	Data      string    `json:"data" db:"data"` // JSON serialized TopologyGraph
	Timestamp time.Time `json:"timestamp" db:"timestamp"`
}

// TopologyFilters defines filters for topology generation
type TopologyFilters struct {
	Namespace     string            `json:"namespace"`
	ResourceTypes []string          `json:"resource_types"`
	Labels        map[string]string `json:"labels"`
}
