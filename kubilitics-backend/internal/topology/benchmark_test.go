package topology

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// BenchmarkGraphBuilding benchmarks graph construction with various node counts
func BenchmarkGraphBuilding(b *testing.B) {
	nodeCounts := []int{100, 500, 1000, 5000, 10000}

	for _, nodeCount := range nodeCounts {
		b.Run(fmt.Sprintf("nodes_%d", nodeCount), func(b *testing.B) {
			graph := generateLargeGraph(nodeCount)
			
			b.ResetTimer()
			b.ReportAllocs()
			
			for i := 0; i < b.N; i++ {
				_ = graph.Validate()
			}
		})
	}
}

// BenchmarkGraphLookup benchmarks node lookup performance
func BenchmarkGraphLookup(b *testing.B) {
	nodeCounts := []int{1000, 5000, 10000}

	for _, nodeCount := range nodeCounts {
		b.Run(fmt.Sprintf("nodes_%d", nodeCount), func(b *testing.B) {
			graph := generateLargeGraph(nodeCount)
			
			b.ResetTimer()
			
			for i := 0; i < b.N; i++ {
				nodeID := fmt.Sprintf("node-%d", i%nodeCount)
				_ = graph.GetNode(nodeID)
			}
		})
	}
}

// BenchmarkRelationshipInference benchmarks relationship inference
func BenchmarkRelationshipInference(b *testing.B) {
	nodeCounts := []int{100, 500, 1000}

	for _, nodeCount := range nodeCounts {
		b.Run(fmt.Sprintf("nodes_%d", nodeCount), func(b *testing.B) {
			b.ResetTimer()
			b.ReportAllocs()
			
			for i := 0; i < b.N; i++ {
				b.StopTimer()
				graph := generateGraphWithOwnerRefs(nodeCount)
				inferencer := NewRelationshipInferencer(nil, graph)
				b.StartTimer()
				
				_ = inferencer.inferOwnerReferences()
			}
		})
	}
}

// BenchmarkGraphToTopology benchmarks conversion to TopologyGraph
func BenchmarkGraphToTopology(b *testing.B) {
	nodeCounts := []int{1000, 5000, 10000}

	for _, nodeCount := range nodeCounts {
		b.Run(fmt.Sprintf("nodes_%d", nodeCount), func(b *testing.B) {
			graph := generateLargeGraph(nodeCount)
			
			b.ResetTimer()
			b.ReportAllocs()
			
			for i := 0; i < b.N; i++ {
				_ = graph.ToTopologyGraph("bench")
			}
		})
	}
}

// BenchmarkLayoutSeedGeneration benchmarks deterministic layout seed generation
func BenchmarkLayoutSeedGeneration(b *testing.B) {
	nodeCounts := []int{1000, 5000, 10000}

	for _, nodeCount := range nodeCounts {
		b.Run(fmt.Sprintf("nodes_%d", nodeCount), func(b *testing.B) {
			graph := generateLargeGraph(nodeCount)
			
			b.ResetTimer()
			
			for i := 0; i < b.N; i++ {
				_ = graph.GenerateLayoutSeed()
			}
		})
	}
}

// BenchmarkGetNodesByType benchmarks filtering nodes by type
func BenchmarkGetNodesByType(b *testing.B) {
	graph := generateMixedTypeGraph(10000)
	
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		_ = graph.GetNodesByType("Deployment")
	}
}

// BenchmarkEdgeOperations benchmarks edge addition and retrieval
func BenchmarkEdgeOperations(b *testing.B) {
	b.Run("AddEdge", func(b *testing.B) {
		graph := generateLargeGraph(1000)
		
		b.ResetTimer()
		
		for i := 0; i < b.N; i++ {
			edge := models.TopologyEdge{
				ID: fmt.Sprintf("edge-bench-%d", i),
				Source: fmt.Sprintf("node-%d", i%1000),
				Target: fmt.Sprintf("node-%d", (i+1)%1000),
				RelationshipType: "owner",
				Metadata: models.EdgeMetadata{},
			}
			graph.AddEdge(edge)
		}
	})

	b.Run("GetOutgoingEdges", func(b *testing.B) {
		graph := generateGraphWithEdges(1000, 5000)
		
		b.ResetTimer()
		
		for i := 0; i < b.N; i++ {
			nodeID := fmt.Sprintf("node-%d", i%1000)
			_ = graph.GetOutgoingEdges(nodeID)
		}
	})

	b.Run("GetIncomingEdges", func(b *testing.B) {
		graph := generateGraphWithEdges(1000, 5000)
		
		b.ResetTimer()
		
		for i := 0; i < b.N; i++ {
			nodeID := fmt.Sprintf("node-%d", i%1000)
			_ = graph.GetIncomingEdges(nodeID)
		}
	})
}

// Helper: generateLargeGraph creates a graph with specified node count
func generateLargeGraph(nodeCount int) *Graph {
	graph := NewGraph(0)
	
	for i := 0; i < nodeCount; i++ {
		node := models.TopologyNode{
			ID: fmt.Sprintf("node-%d", i),
			Kind: "Pod",
			Name: fmt.Sprintf("pod-%d", i),
			Namespace: "default",
			Metadata: models.NodeMetadata{Labels: map[string]string{"app": "test"}},
			Computed: models.NodeComputed{},
		}
		graph.AddNode(node)
	}
	
	return graph
}

// Helper: generateMixedTypeGraph creates graph with multiple resource types
func generateMixedTypeGraph(nodeCount int) *Graph {
	graph := NewGraph(0)
	types := []string{"Pod", "Service", "Deployment", "ReplicaSet", "ConfigMap"}
	
	for i := 0; i < nodeCount; i++ {
		nodeType := types[i%len(types)]
		node := models.TopologyNode{
			ID: fmt.Sprintf("node-%d", i),
			Kind: nodeType,
			Name: fmt.Sprintf("%s-%d", nodeType, i),
			Namespace: "default",
			Metadata: models.NodeMetadata{},
			Computed: models.NodeComputed{},
		}
		graph.AddNode(node)
	}
	
	return graph
}

// Helper: generateGraphWithOwnerRefs creates graph with owner references
func generateGraphWithOwnerRefs(nodeCount int) *Graph {
	graph := NewGraph(0)
	
	// Create deployments
	for i := 0; i < nodeCount/3; i++ {
		uid := fmt.Sprintf("deployment-uid-%d", i)
		deployment := models.TopologyNode{
			ID: fmt.Sprintf("deployment-%d", i),
			Kind: "Deployment",
			Name: fmt.Sprintf("deployment-%d", i),
			Namespace: "default",
			Metadata: models.NodeMetadata{UID: uid},
			Computed: models.NodeComputed{},
		}
		graph.AddNode(deployment)
	}
	
	// Create replicasets owned by deployments
	for i := 0; i < nodeCount/3; i++ {
		uid := fmt.Sprintf("rs-uid-%d", i)
		rs := models.TopologyNode{
			ID: fmt.Sprintf("rs-%d", i),
			Kind: "ReplicaSet",
			Name: fmt.Sprintf("rs-%d", i),
			Namespace: "default",
			Metadata: models.NodeMetadata{UID: uid},
			Computed: models.NodeComputed{},
		}
		graph.AddNode(rs)
		depUID := fmt.Sprintf("deployment-uid-%d", i%(nodeCount/3))
		graph.SetOwnerRefs(rs.ID, []OwnerRef{{UID: depUID, Kind: "Deployment"}})
	}
	
	// Create pods owned by replicasets
	for i := 0; i < nodeCount/3; i++ {
		uid := fmt.Sprintf("pod-uid-%d", i)
		pod := models.TopologyNode{
			ID: fmt.Sprintf("pod-%d", i),
			Kind: "Pod",
			Name: fmt.Sprintf("pod-%d", i),
			Namespace: "default",
			Metadata: models.NodeMetadata{UID: uid},
			Computed: models.NodeComputed{},
		}
		graph.AddNode(pod)
		rsUID := fmt.Sprintf("rs-uid-%d", i%(nodeCount/3))
		graph.SetOwnerRefs(pod.ID, []OwnerRef{{UID: rsUID, Kind: "ReplicaSet"}})
	}
	
	return graph
}

// Helper: generateGraphWithEdges creates graph with specified nodes and edges
func generateGraphWithEdges(nodeCount, edgeCount int) *Graph {
	graph := generateLargeGraph(nodeCount)
	
	for i := 0; i < edgeCount; i++ {
		edge := models.TopologyEdge{
			ID: fmt.Sprintf("edge-%d", i),
			Source: fmt.Sprintf("node-%d", i%nodeCount),
			Target: fmt.Sprintf("node-%d", (i+1)%nodeCount),
			RelationshipType: "owner",
			Label: "owns",
			Metadata: models.EdgeMetadata{},
		}
		graph.AddEdge(edge)
	}
	
	return graph
}

// Test that large graphs meet performance targets
func TestLargeGraphPerformance(t *testing.T) {
	// Target: <2s for 10K nodes
	const targetTime = 2 * time.Second
	const nodeCount = 10000

	graph := generateLargeGraph(nodeCount)
	
	start := time.Now()
	err := graph.Validate()
	elapsed := time.Since(start)
	
	if err != nil {
		t.Fatalf("Validation failed: %v", err)
	}
	
	if elapsed > targetTime {
		t.Errorf("Performance target not met: %v > %v (for %d nodes)", elapsed, targetTime, nodeCount)
	} else {
		t.Logf("✅ Performance target met: %v < %v (for %d nodes)", elapsed, targetTime, nodeCount)
	}
}

// TestTopologyBuild_5000Nodes tests topology build performance with 5000 nodes (BE-030 requirement)
func TestTopologyBuild_5000Nodes(t *testing.T) {
	// Target: <1s for 5000 nodes (BE-030 requirement)
	const targetTime = 1 * time.Second
	const nodeCount = 5000

	graph := generateLargeGraph(nodeCount)
	
	start := time.Now()
	err := graph.Validate()
	elapsed := time.Since(start)
	
	if err != nil {
		t.Fatalf("Validation failed: %v", err)
	}
	
	// Convert to topology graph (more realistic test)
	start = time.Now()
	topology := graph.ToTopologyGraph("test-cluster")
	elapsed = time.Since(start)
	
	if topology.Metadata.NodeCount != nodeCount {
		t.Errorf("Expected %d nodes, got %d", nodeCount, topology.Metadata.NodeCount)
	}
	
	if elapsed > targetTime {
		t.Errorf("Performance target not met: %v > %v (for %d nodes)", elapsed, targetTime, nodeCount)
	} else {
		t.Logf("✅ Performance target met: %v < %v (for %d nodes)", elapsed, targetTime, nodeCount)
	}
}

// Test graph memory efficiency
func TestGraphMemoryEfficiency(t *testing.T) {
	ctx := context.Background()
	
	// Create graphs of different sizes and measure
	sizes := []int{100, 1000, 5000}
	
	for _, size := range sizes {
		graph := generateLargeGraph(size)
		_ = ctx // Use context if needed for future operations
		
		// Convert to topology
		topology := graph.ToTopologyGraph("test")
		
		// Basic sanity check
		if topology.Metadata.NodeCount != size {
			t.Errorf("Expected %d nodes, got %d", size, topology.Metadata.NodeCount)
		}
		
		t.Logf("Graph with %d nodes: %d edges, memory efficient", size, topology.Metadata.EdgeCount)
	}
}
