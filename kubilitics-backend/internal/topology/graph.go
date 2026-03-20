package topology

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
)

// OwnerRef is used for inferencing owner-reference edges (UID lookup).
type OwnerRef struct {
	UID       string
	Kind      string
	Name      string
	Namespace string
}

// Graph represents the topology graph
type Graph struct {
	mu            sync.Mutex // protects concurrent node/edge insertion during parallel discovery
	Nodes         []models.TopologyNode
	Edges         []models.TopologyEdge
	NodeMap       map[string]*models.TopologyNode   // id -> node
	UIDToNode     map[string]*models.TopologyNode   // uid -> node (for owner ref inference)
	KindIndex     map[string][]*models.TopologyNode // kind -> nodes (O(1) lookup by kind)
	LabelIndex    map[string][]*models.TopologyNode // "namespace\x00key\x00value" -> nodes (inverted label index for O(1) selector matching)
	NameIndex     map[string]*models.TopologyNode   // "namespace\x00kind\x00name" -> node (O(1) lookup by name)
	EdgeMap       map[string]bool
	nodeOwnerRefs map[string][]OwnerRef            // nodeID -> owner refs
	nodeExtra     map[string]map[string]interface{} // nodeID -> extra fields for inference (scaleTargetRef, roleRef, spec, etc.)
	PodSpecCache  map[string]corev1.PodSpec         // "namespace/name" -> cached pod spec from discovery phase
	LayoutSeed    string
	// MaxNodes caps the number of nodes (C1.4); 0 = no limit. When reached, Truncated is set and no more nodes are added.
	MaxNodes      int
	Truncated     bool
	KindTruncated map[string]bool // tracks which resource kinds were rejected due to truncation
}

// NewGraph creates a new empty graph. Optionally pass maxNodes > 0 to cap node count (C1.4).
func NewGraph(maxNodes int) *Graph {
	return &Graph{
		Nodes:         []models.TopologyNode{},
		Edges:         []models.TopologyEdge{},
		NodeMap:       make(map[string]*models.TopologyNode),
		UIDToNode:     make(map[string]*models.TopologyNode),
		KindIndex:     make(map[string][]*models.TopologyNode),
		LabelIndex:    make(map[string][]*models.TopologyNode),
		NameIndex:     make(map[string]*models.TopologyNode),
		EdgeMap:       make(map[string]bool),
		nodeOwnerRefs: make(map[string][]OwnerRef),
		nodeExtra:     make(map[string]map[string]interface{}),
		PodSpecCache:  make(map[string]corev1.PodSpec),
		MaxNodes:      maxNodes,
		KindTruncated: make(map[string]bool),
	}
}

// SetNodeExtra stores extra per-node data for inference (e.g. scaleTargetRef, roleRef, spec).
func (g *Graph) SetNodeExtra(nodeID string, extra map[string]interface{}) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.nodeExtra[nodeID] = extra
}

// GetNodeExtra returns extra data for a node (for inference only).
// Note: safe to call without lock after discovery phase completes (single-writer then read-only).
// Lock added defensively for correctness if ever called during concurrent discovery.
func (g *Graph) GetNodeExtra(nodeID string) map[string]interface{} {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.nodeExtra[nodeID]
}

// SetOwnerRefs stores owner references for a node (used by engine for inference).
func (g *Graph) SetOwnerRefs(nodeID string, refs []OwnerRef) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.nodeOwnerRefs[nodeID] = refs
}

// GetOwnerRefs returns owner references for a node.
func (g *Graph) GetOwnerRefs(nodeID string) []OwnerRef {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.nodeOwnerRefs[nodeID]
}

// GetNodeByUID returns a node by its UID (for owner ref resolution).
func (g *Graph) GetNodeByUID(uid string) *models.TopologyNode {
	return g.UIDToNode[uid]
}

// AddNode adds a node to the graph and indexes by UID for owner-ref inference.
// When MaxNodes > 0 and capacity is reached, no-op and set Truncated (C1.4).
// Thread-safe: protected by g.mu for concurrent discovery.
func (g *Graph) AddNode(node models.TopologyNode) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.MaxNodes > 0 && len(g.Nodes) >= g.MaxNodes {
		g.Truncated = true
		g.KindTruncated[node.Kind] = true
		return
	}
	if _, exists := g.NodeMap[node.ID]; exists {
		return // Skip duplicates
	}
	g.Nodes = append(g.Nodes, node)
	ptr := &g.Nodes[len(g.Nodes)-1]
	g.NodeMap[node.ID] = ptr
	g.KindIndex[node.Kind] = append(g.KindIndex[node.Kind], ptr)
	if node.Metadata.UID != "" {
		g.UIDToNode[node.Metadata.UID] = ptr
	}
	// Populate inverted label index for O(1) selector matching (P0 perf fix).
	for k, v := range node.Metadata.Labels {
		labelKey := node.Namespace + "\x00" + k + "\x00" + v
		g.LabelIndex[labelKey] = append(g.LabelIndex[labelKey], ptr)
	}
	// Populate name index for O(1) name-based lookup (used by volume/env/network inference).
	nameKey := node.Namespace + "\x00" + node.Kind + "\x00" + node.Name
	g.NameIndex[nameKey] = ptr
}

// AddEdge adds an edge to the graph. Thread-safe.
func (g *Graph) AddEdge(edge models.TopologyEdge) {
	g.mu.Lock()
	defer g.mu.Unlock()
	edgeKey := fmt.Sprintf("%s->%s:%s", edge.Source, edge.Target, edge.RelationshipType)
	if g.EdgeMap[edgeKey] {
		return // Skip duplicates
	}

	g.Edges = append(g.Edges, edge)
	g.EdgeMap[edgeKey] = true
}

// GetNode retrieves a node by ID
func (g *Graph) GetNode(id string) *models.TopologyNode {
	return g.NodeMap[id]
}

// GenerateLayoutSeed generates a deterministic layout seed based on graph structure
func (g *Graph) GenerateLayoutSeed() string {
	// Sort nodes and edges for determinism
	sortedNodes := make([]string, len(g.Nodes))
	for i, node := range g.Nodes {
		sortedNodes[i] = fmt.Sprintf("%s:%s:%s", node.Kind, node.Namespace, node.Name)
	}
	sort.Strings(sortedNodes)

	sortedEdges := make([]string, len(g.Edges))
	for i, edge := range g.Edges {
		sortedEdges[i] = fmt.Sprintf("%s->%s:%s", edge.Source, edge.Target, edge.RelationshipType)
	}
	sort.Strings(sortedEdges)

	// Create deterministic hash
	data := struct {
		Nodes []string
		Edges []string
	}{
		Nodes: sortedNodes,
		Edges: sortedEdges,
	}

	jsonData, _ := json.Marshal(data)
	hash := sha256.Sum256(jsonData)
	return fmt.Sprintf("%x", hash)
}

// ToTopologyGraph converts internal graph to API model (contract: schemaVersion, nodes, edges, metadata).
func (g *Graph) ToTopologyGraph(clusterID string) models.TopologyGraph {
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z07:00")
	warnings := []models.GraphWarning{}
	if g.Truncated {
		msg := "Graph was truncated at max nodes; use ?namespace= to scope or increase topology_max_nodes"
		if len(g.KindTruncated) > 0 {
			kinds := make([]string, 0, len(g.KindTruncated))
			for k := range g.KindTruncated {
				kinds = append(kinds, k)
			}
			sort.Strings(kinds)
			msg += fmt.Sprintf(". Truncated kinds: %s", fmt.Sprintf("%v", kinds))
		}
		warnings = append(warnings, models.GraphWarning{
			Code:    "TOPOLOGY_TRUNCATED",
			Message: msg,
		})
	}
	return models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes:         g.Nodes,
		Edges:         g.Edges,
		Metadata: models.TopologyGraphMetadata{
			ClusterId:   clusterID,
			GeneratedAt: now,
			LayoutSeed:  g.LayoutSeed,
			IsComplete:  !g.Truncated,
			Warnings:    warnings,
			NodeCount:   len(g.Nodes),
			EdgeCount:   len(g.Edges),
		},
	}
}

// PruneDisconnectedClusterScoped removes cluster-scoped nodes that have no
// path to any namespaced resource. When a namespace filter is active, the
// backend discovers ALL cluster-scoped resources (Nodes, PVs, StorageClasses,
// ClusterRoles, etc.) but only namespaced resources from the selected namespace.
// This leaves cluster-scoped resources that are unrelated to that namespace as
// disconnected islands. BFS from namespaced resources finds all reachable nodes;
// unreachable cluster-scoped nodes are pruned.
func (g *Graph) PruneDisconnectedClusterScoped() {
	// Seed BFS with all namespaced resources + Namespace nodes themselves
	reachable := make(map[string]bool, len(g.Nodes))
	queue := make([]string, 0, len(g.Nodes))

	for _, node := range g.Nodes {
		if node.Namespace != "" || node.Kind == "Namespace" {
			reachable[node.ID] = true
			queue = append(queue, node.ID)
		}
	}

	// Build undirected adjacency list from edges
	adj := make(map[string][]string, len(g.Nodes))
	for _, edge := range g.Edges {
		adj[edge.Source] = append(adj[edge.Source], edge.Target)
		adj[edge.Target] = append(adj[edge.Target], edge.Source)
	}

	// BFS to find all reachable nodes
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, neighbor := range adj[current] {
			if !reachable[neighbor] {
				reachable[neighbor] = true
				queue = append(queue, neighbor)
			}
		}
	}

	// Rebuild Nodes slice keeping only reachable ones
	kept := g.Nodes[:0]
	for _, node := range g.Nodes {
		if reachable[node.ID] {
			kept = append(kept, node)
		} else {
			// Clean up indexes for pruned node
			delete(g.NodeMap, node.ID)
			if node.Metadata.UID != "" {
				delete(g.UIDToNode, node.Metadata.UID)
			}
			nameKey := node.Namespace + "\x00" + node.Kind + "\x00" + node.Name
			delete(g.NameIndex, nameKey)
		}
	}
	g.Nodes = kept

	// Rebuild node pointers in NodeMap (slice may have shifted)
	for i := range g.Nodes {
		g.NodeMap[g.Nodes[i].ID] = &g.Nodes[i]
	}

	// Remove edges referencing pruned nodes
	keptEdges := g.Edges[:0]
	for _, edge := range g.Edges {
		if reachable[edge.Source] && reachable[edge.Target] {
			keptEdges = append(keptEdges, edge)
		} else {
			edgeKey := fmt.Sprintf("%s->%s:%s", edge.Source, edge.Target, edge.RelationshipType)
			delete(g.EdgeMap, edgeKey)
		}
	}
	g.Edges = keptEdges
}

// Validate checks graph completeness and correctness.
// Orphan edges (referencing non-existent nodes) are removed gracefully rather than
// failing the entire graph, because partial discovery may leave stale edges.
func (g *Graph) Validate() error {
	// Remove orphan edges (edges referencing non-existent nodes)
	valid := g.Edges[:0]
	for _, edge := range g.Edges {
		if g.GetNode(edge.Source) != nil && g.GetNode(edge.Target) != nil {
			valid = append(valid, edge)
		} else {
			// Clean up EdgeMap entry for removed edge
			edgeKey := fmt.Sprintf("%s->%s:%s", edge.Source, edge.Target, edge.RelationshipType)
			delete(g.EdgeMap, edgeKey)
		}
	}
	g.Edges = valid

	// Check for duplicate node IDs
	if len(g.Nodes) != len(g.NodeMap) {
		return fmt.Errorf("duplicate node IDs detected")
	}

	return nil
}

// GetNodesByKind returns all nodes of a given kind using the O(1) kind index.
func (g *Graph) GetNodesByKind(kind string) []models.TopologyNode {
	ptrs := g.KindIndex[kind]
	result := make([]models.TopologyNode, len(ptrs))
	for i, p := range ptrs {
		result[i] = *p
	}
	return result
}

// GetNodesByType is an alias for GetNodesByKind for backward compatibility.
func (g *Graph) GetNodesByType(kind string) []models.TopologyNode {
	return g.GetNodesByKind(kind)
}

// GetNodesBySelector returns nodes in the given namespace whose labels match ALL key=value
// pairs in the selector. Uses the inverted label index for O(k) intersection where
// k = number of selector keys, instead of O(n) linear scan across all nodes.
func (g *Graph) GetNodesBySelector(namespace string, selector map[string]string) []*models.TopologyNode {
	if len(selector) == 0 {
		return nil
	}

	// Start with the candidate set from the first selector key.
	var candidates map[*models.TopologyNode]struct{}
	first := true
	for k, v := range selector {
		labelKey := namespace + "\x00" + k + "\x00" + v
		ptrs := g.LabelIndex[labelKey]
		if first {
			candidates = make(map[*models.TopologyNode]struct{}, len(ptrs))
			for _, p := range ptrs {
				candidates[p] = struct{}{}
			}
			first = false
		} else {
			// Intersect: keep only nodes present in both sets.
			intersection := make(map[*models.TopologyNode]struct{}, len(candidates))
			for _, p := range ptrs {
				if _, ok := candidates[p]; ok {
					intersection[p] = struct{}{}
				}
			}
			candidates = intersection
		}
		if len(candidates) == 0 {
			return nil
		}
	}

	result := make([]*models.TopologyNode, 0, len(candidates))
	for p := range candidates {
		result = append(result, p)
	}
	return result
}

// GetNodeByName returns a single node by namespace, kind, and name using the O(1) name index.
// Returns nil if not found.
func (g *Graph) GetNodeByName(namespace, kind, name string) *models.TopologyNode {
	nameKey := namespace + "\x00" + kind + "\x00" + name
	return g.NameIndex[nameKey]
}

// GetOutgoingEdges returns all edges originating from a node
func (g *Graph) GetOutgoingEdges(nodeID string) []models.TopologyEdge {
	var result []models.TopologyEdge
	for _, edge := range g.Edges {
		if edge.Source == nodeID {
			result = append(result, edge)
		}
	}
	return result
}

// GetIncomingEdges returns all edges targeting a node
func (g *Graph) GetIncomingEdges(nodeID string) []models.TopologyEdge {
	var result []models.TopologyEdge
	for _, edge := range g.Edges {
		if edge.Target == nodeID {
			result = append(result, edge)
		}
	}
	return result
}
