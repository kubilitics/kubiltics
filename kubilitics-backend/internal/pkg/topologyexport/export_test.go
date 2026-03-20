package topologyexport

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestGraphToJSON_NilGraph(t *testing.T) {
	data, err := GraphToJSON(nil)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if string(data) != "null" {
		t.Errorf("Expected 'null', got '%s'", string(data))
	}
}

func TestGraphToJSON_EmptyGraph(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes:         []models.TopologyNode{},
		Edges:         []models.TopologyEdge{},
		Metadata:      models.TopologyGraphMetadata{},
	}
	data, err := GraphToJSON(graph)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	var result models.TopologyGraph
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}
	if len(result.Nodes) != 0 {
		t.Error("Expected empty nodes array")
	}
}

func TestGraphToJSON_WithNodes(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "node-1", Kind: "Pod", Name: "pod-1", Namespace: "default"},
			{ID: "node-2", Kind: "Service", Name: "svc-1", Namespace: "default"},
		},
		Edges: []models.TopologyEdge{
			{ID: "edge-1", Source: "node-1", Target: "node-2", RelationshipType: "owns"},
		},
		Metadata: models.TopologyGraphMetadata{
			ClusterId: "test-cluster",
		},
	}
	data, err := GraphToJSON(graph)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	var result models.TopologyGraph
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}
	if len(result.Nodes) != 2 {
		t.Errorf("Expected 2 nodes, got %d", len(result.Nodes))
	}
	if len(result.Edges) != 1 {
		t.Errorf("Expected 1 edge, got %d", len(result.Edges))
	}
}

func TestGraphToSVG_NilGraph(t *testing.T) {
	data, err := GraphToSVG(nil)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if !strings.Contains(string(data), "svg") {
		t.Error("Expected SVG content")
	}
}

func TestGraphToSVG_EmptyGraph(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes:         []models.TopologyNode{},
		Edges:         []models.TopologyEdge{},
		Metadata:     models.TopologyGraphMetadata{},
	}
	data, err := GraphToSVG(graph)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if !strings.Contains(string(data), "No resources") {
		t.Error("Expected 'No resources' message in SVG")
	}
}

func TestGraphToSVG_WithNodes(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "node-1", Kind: "Pod", Name: "pod-1", Namespace: "default"},
		},
		Edges:    []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{},
	}
	data, err := GraphToSVG(graph)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	svg := string(data)
	if !strings.Contains(svg, "svg") {
		t.Error("Expected SVG content")
	}
	// SVG may contain node name or other identifiers, not necessarily the ID
	// Just verify it's valid SVG
	if !strings.Contains(svg, "<svg") {
		t.Error("Expected SVG opening tag")
	}
}

func TestGraphToDrawioXML_NilGraph(t *testing.T) {
	data, err := GraphToDrawioXML(nil)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if !strings.Contains(string(data), "mxfile") {
		t.Error("Expected mxfile element")
	}
}

func TestGraphToDrawioXML_WithNodes(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "node-1", Kind: "Pod", Name: "pod-1", Namespace: "default"},
		},
		Edges:    []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{},
	}
	data, err := GraphToDrawioXML(graph)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	xml := string(data)
	if !strings.Contains(xml, "mxfile") {
		t.Error("Expected mxfile element")
	}
	if !strings.Contains(xml, "mxGraphModel") {
		t.Error("Expected mxGraphModel element")
	}
}

func TestGraphToPNG_NilGraph(t *testing.T) {
	data, err := GraphToPNG(nil)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(data) == 0 {
		t.Error("Expected PNG data")
	}
}

func TestGraphToPNG_WithNodes(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "node-1", Kind: "Pod", Name: "pod-1", Namespace: "default"},
		},
		Edges:    []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{},
	}
	data, err := GraphToPNG(graph)
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}
	if len(data) == 0 {
		t.Error("Expected PNG data")
	}
	// PNG files start with PNG signature (first 8 bytes)
	if len(data) < 8 {
		t.Error("PNG data too short")
	}
	pngSignature := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	for i := 0; i < 8 && i < len(data); i++ {
		if data[i] != pngSignature[i] {
			t.Errorf("Expected PNG signature at byte %d, got %x", i, data[i])
			break
		}
	}
}

func TestApplySimpleLayout(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "node-1", Kind: "Pod"},
			{ID: "node-2", Kind: "Service"},
			{ID: "node-3", Kind: "Deployment"},
		},
		Edges:    []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{},
	}
	
	ApplySimpleLayout(graph)
	
	// All nodes should have positions assigned
	for i, node := range graph.Nodes {
		if node.Position == nil {
			t.Errorf("Node %d should have position assigned", i)
		}
	}
}

func TestApplySimpleLayout_PreservesExistingPositions(t *testing.T) {
	graph := &models.TopologyGraph{
		SchemaVersion: "1.0",
		Nodes: []models.TopologyNode{
			{ID: "node-1", Kind: "Pod", Position: &models.Position{X: 100, Y: 200}},
			{ID: "node-2", Kind: "Service"},
		},
		Edges:    []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{},
	}
	
	originalX := graph.Nodes[0].Position.X
	originalY := graph.Nodes[0].Position.Y
	
	ApplySimpleLayout(graph)
	
	// First node's position should be preserved
	if graph.Nodes[0].Position.X != originalX || graph.Nodes[0].Position.Y != originalY {
		t.Error("Existing positions should be preserved")
	}
	
	// Second node should have a position assigned
	if graph.Nodes[1].Position == nil {
		t.Error("Node without position should have position assigned")
	}
}
