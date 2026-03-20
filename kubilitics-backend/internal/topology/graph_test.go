package topology

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestNewGraph(t *testing.T) {
	graph := NewGraph(0)
	
	assert.NotNil(t, graph)
	assert.Equal(t, 0, len(graph.Nodes))
	assert.Equal(t, 0, len(graph.Edges))
	assert.NotNil(t, graph.NodeMap)
	assert.NotNil(t, graph.EdgeMap)
}

func TestAddNode(t *testing.T) {
	graph := NewGraph(0)
	
	node := models.TopologyNode{
		ID: "pod-123", Kind: "Pod", Namespace: "default", Name: "nginx", Status: "Running",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	}
	
	graph.AddNode(node)
	
	assert.Equal(t, 1, len(graph.Nodes))
	assert.Equal(t, "pod-123", graph.Nodes[0].ID)
	assert.NotNil(t, graph.NodeMap["pod-123"])
}

func TestAddNodeDuplicate(t *testing.T) {
	graph := NewGraph(0)
	
	node := models.TopologyNode{
		ID: "pod-123", Kind: "Pod", Name: "nginx",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	}
	
	graph.AddNode(node)
	graph.AddNode(node) // Add same node again
	
	// Should only have one node
	assert.Equal(t, 1, len(graph.Nodes))
}

func TestAddEdge(t *testing.T) {
	graph := NewGraph(0)
	
	edge := models.TopologyEdge{
		ID: "edge-1", Source: "deploy-1", Target: "pod-1", RelationshipType: "owner", Label: "owns",
		Metadata: models.EdgeMetadata{},
	}
	
	graph.AddEdge(edge)
	
	assert.Equal(t, 1, len(graph.Edges))
	assert.Equal(t, "edge-1", graph.Edges[0].ID)
}

func TestAddEdgeDuplicate(t *testing.T) {
	graph := NewGraph(0)
	
	edge := models.TopologyEdge{
		ID: "edge-1", Source: "deploy-1", Target: "pod-1", RelationshipType: "owner",
		Metadata: models.EdgeMetadata{},
	}
	
	graph.AddEdge(edge)
	graph.AddEdge(edge) // Add same edge again
	
	// Should only have one edge
	assert.Equal(t, 1, len(graph.Edges))
}

func TestGetNode(t *testing.T) {
	graph := NewGraph(0)
	
	node := models.TopologyNode{
		ID: "pod-123", Kind: "Pod", Name: "nginx",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	}
	
	graph.AddNode(node)
	
	foundNode := graph.GetNode("pod-123")
	assert.NotNil(t, foundNode)
	assert.Equal(t, "pod-123", foundNode.ID)
	
	notFound := graph.GetNode("nonexistent")
	assert.Nil(t, notFound)
}

func TestGetNodesByType(t *testing.T) {
	graph := NewGraph(0)
	
	graph.AddNode(models.TopologyNode{ID: "pod-1", Kind: "Pod", Name: "nginx-1", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "pod-2", Kind: "Pod", Name: "nginx-2", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "svc-1", Kind: "Service", Name: "nginx-svc", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	
	pods := graph.GetNodesByType("Pod")
	assert.Equal(t, 2, len(pods))
	
	services := graph.GetNodesByType("Service")
	assert.Equal(t, 1, len(services))
	
	deployments := graph.GetNodesByType("Deployment")
	assert.Equal(t, 0, len(deployments))
}

func TestGenerateLayoutSeed(t *testing.T) {
	graph := NewGraph(0)
	
	graph.AddNode(models.TopologyNode{ID: "pod-1", Kind: "Pod", Namespace: "default", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "svc-1", Kind: "Service", Namespace: "default", Name: "nginx-svc", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddEdge(models.TopologyEdge{ID: "edge-1", Source: "svc-1", Target: "pod-1", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	seed1 := graph.GenerateLayoutSeed()
	assert.NotEmpty(t, seed1)
	assert.Equal(t, 64, len(seed1)) // SHA256 hex string
	
	// Same graph should produce same seed (determinism)
	seed2 := graph.GenerateLayoutSeed()
	assert.Equal(t, seed1, seed2)
}

func TestGenerateLayoutSeedDeterminism(t *testing.T) {
	// Create two identical graphs
	graph1 := NewGraph(0)
	graph1.AddNode(models.TopologyNode{ID: "pod-1", Kind: "Pod", Namespace: "default", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph1.AddNode(models.TopologyNode{ID: "svc-1", Kind: "Service", Namespace: "default", Name: "nginx-svc", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph1.AddEdge(models.TopologyEdge{ID: "edge-1", Source: "svc-1", Target: "pod-1", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	graph2 := NewGraph(0)
	graph2.AddNode(models.TopologyNode{ID: "pod-1", Kind: "Pod", Namespace: "default", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph2.AddNode(models.TopologyNode{ID: "svc-1", Kind: "Service", Namespace: "default", Name: "nginx-svc", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph2.AddEdge(models.TopologyEdge{ID: "edge-1", Source: "svc-1", Target: "pod-1", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	seed1 := graph1.GenerateLayoutSeed()
	seed2 := graph2.GenerateLayoutSeed()
	
	// Identical graphs should produce identical seeds
	assert.Equal(t, seed1, seed2)
}

func TestValidate(t *testing.T) {
	graph := NewGraph(0)
	
	// Add nodes and edges
	graph.AddNode(models.TopologyNode{ID: "pod-1", Kind: "Pod", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "svc-1", Kind: "Service", Name: "nginx-svc", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddEdge(models.TopologyEdge{ID: "edge-1", Source: "svc-1", Target: "pod-1", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	// Valid graph should pass
	err := graph.Validate()
	assert.NoError(t, err)
}

func TestValidateOrphanEdge(t *testing.T) {
	graph := NewGraph(0)

	// Add edge without nodes
	graph.AddEdge(models.TopologyEdge{
		ID: "edge-1", Source: "nonexistent-1", Target: "nonexistent-2", RelationshipType: "owner",
		Metadata: models.EdgeMetadata{},
	})

	// Validate should succeed — orphan edges are gracefully removed
	err := graph.Validate()
	assert.NoError(t, err)
	// Orphan edge should have been removed
	assert.Equal(t, 0, len(graph.Edges), "orphan edges should be removed during validation")
	assert.False(t, graph.EdgeMap["nonexistent-1->nonexistent-2:owner"], "orphan edge should be removed from EdgeMap")
}

func TestGetOutgoingEdges(t *testing.T) {
	graph := NewGraph(0)
	
	graph.AddEdge(models.TopologyEdge{ID: "e1", Source: "n1", Target: "n2", RelationshipType: "owner", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e2", Source: "n1", Target: "n3", RelationshipType: "owner", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e3", Source: "n2", Target: "n3", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	edges := graph.GetOutgoingEdges("n1")
	assert.Equal(t, 2, len(edges))
	
	edges = graph.GetOutgoingEdges("n2")
	assert.Equal(t, 1, len(edges))
	
	edges = graph.GetOutgoingEdges("n3")
	assert.Equal(t, 0, len(edges))
}

func TestGetIncomingEdges(t *testing.T) {
	graph := NewGraph(0)
	
	graph.AddEdge(models.TopologyEdge{ID: "e1", Source: "n1", Target: "n3", RelationshipType: "owner", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e2", Source: "n2", Target: "n3", RelationshipType: "owner", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e3", Source: "n1", Target: "n2", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	edges := graph.GetIncomingEdges("n3")
	assert.Equal(t, 2, len(edges))
	
	edges = graph.GetIncomingEdges("n2")
	assert.Equal(t, 1, len(edges))
	
	edges = graph.GetIncomingEdges("n1")
	assert.Equal(t, 0, len(edges))
}

func TestToTopologyGraph(t *testing.T) {
	graph := NewGraph(0)
	
	graph.AddNode(models.TopologyNode{ID: "pod-1", Kind: "Pod", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "svc-1", Kind: "Service", Name: "nginx-svc", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddEdge(models.TopologyEdge{ID: "edge-1", Source: "svc-1", Target: "pod-1", RelationshipType: "selector", Metadata: models.EdgeMetadata{}})
	
	graph.LayoutSeed = "test-seed-123"
	
	topology := graph.ToTopologyGraph("test-cluster")
	
	assert.Equal(t, 2, topology.Metadata.NodeCount)
	assert.Equal(t, 1, topology.Metadata.EdgeCount)
	assert.Equal(t, "test-seed-123", topology.Metadata.LayoutSeed)
	assert.Equal(t, "1.0", topology.SchemaVersion)
	assert.Equal(t, 2, len(topology.Nodes))
	assert.Equal(t, 1, len(topology.Edges))
}
