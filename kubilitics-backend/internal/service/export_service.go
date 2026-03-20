package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ExportService handles topology export to various formats
type ExportService interface {
	ExportToPNG(ctx context.Context, topology *models.TopologyGraph, width, height int) ([]byte, error)
	ExportToPDF(ctx context.Context, topology *models.TopologyGraph) ([]byte, error)
	ExportToSVG(ctx context.Context, topology *models.TopologyGraph) ([]byte, error)
	ExportToJSON(ctx context.Context, topology *models.TopologyGraph) ([]byte, error)
}

type exportService struct {
	topologyService TopologyService
}

// NewExportService creates a new export service
func NewExportService(ts TopologyService) ExportService {
	return &exportService{
		topologyService: ts,
	}
}

// ExportToJSON exports topology as JSON
func (s *exportService) ExportToJSON(ctx context.Context, topology *models.TopologyGraph) ([]byte, error) {
	data, err := json.MarshalIndent(topology, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal topology: %w", err)
	}
	return data, nil
}

// ExportToSVG exports topology as SVG
func (s *exportService) ExportToSVG(ctx context.Context, topology *models.TopologyGraph) ([]byte, error) {
	// Generate SVG representation
	svg := s.generateSVG(topology)
	return []byte(svg), nil
}

// ExportToPNG exports topology as PNG (requires conversion from SVG)
func (s *exportService) ExportToPNG(ctx context.Context, topology *models.TopologyGraph, width, height int) ([]byte, error) {
	// First generate SVG
	svg, err := s.ExportToSVG(ctx, topology)
	if err != nil {
		return nil, err
	}

	// Convert SVG to PNG using ImageMagick or similar
	// For production, you'd want to use a proper image library
	// This is a placeholder implementation
	cmd := exec.CommandContext(ctx, "convert", "-background", "white", "-", "png:-")
	cmd.Stdin = bytes.NewReader(svg)
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to convert SVG to PNG: %w", err)
	}

	return output, nil
}

// ExportToPDF exports topology as PDF
func (s *exportService) ExportToPDF(ctx context.Context, topology *models.TopologyGraph) ([]byte, error) {
	// Generate SVG first
	svg, err := s.ExportToSVG(ctx, topology)
	if err != nil {
		return nil, err
	}

	// Convert SVG to PDF using ImageMagick or similar
	cmd := exec.CommandContext(ctx, "convert", "-", "pdf:-")
	cmd.Stdin = bytes.NewReader(svg)
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to convert SVG to PDF: %w", err)
	}

	return output, nil
}

// generateSVG generates SVG representation of topology
func (s *exportService) generateSVG(topology *models.TopologyGraph) string {
	// Simple SVG generation
	// In production, you'd want to use the same layout algorithm as the frontend
	var svg bytes.Buffer
	
	width := 1920
	height := 1080
	
	svg.WriteString(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="%d" height="%d" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .node { fill: #4A90E2; stroke: #2E5C8A; stroke-width: 2; }
      .node-text { fill: white; font-family: Arial; font-size: 12px; text-anchor: middle; }
      .edge { stroke: #666; stroke-width: 1.5; fill: none; marker-end: url(#arrowhead); }
      .edge-label { fill: #666; font-family: Arial; font-size: 10px; }
    </style>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#666" />
    </marker>
  </defs>
  <g id="topology">
`, width, height))

	// Add metadata
	svg.WriteString(fmt.Sprintf(`    <text x="10" y="20" font-size="14" font-weight="bold">Topology: %d nodes, %d edges</text>
    <text x="10" y="40" font-size="12">Generated: %s</text>
`, topology.Metadata.NodeCount, topology.Metadata.EdgeCount, time.Now().Format(time.RFC3339)))

	// Draw edges first (so they appear behind nodes)
	for i, edge := range topology.Edges {
		sourceNode := findNode(topology.Nodes, edge.Source)
		targetNode := findNode(topology.Nodes, edge.Target)
		
		if sourceNode != nil && targetNode != nil {
			sourceX, sourceY := getNodePosition(sourceNode, i, len(topology.Nodes), width, height)
			targetX, targetY := getNodePosition(targetNode, i, len(topology.Nodes), width, height)
			
			svg.WriteString(fmt.Sprintf(`    <line class="edge" x1="%d" y1="%d" x2="%d" y2="%d" />
`, sourceX, sourceY, targetX, targetY))
			
			// Edge label
			midX := (sourceX + targetX) / 2
			midY := (sourceY + targetY) / 2
			svg.WriteString(fmt.Sprintf(`    <text class="edge-label" x="%d" y="%d">%s</text>
`, midX, midY, edge.Label))
		}
	}

	// Draw nodes
	for i, node := range topology.Nodes {
		x, y := getNodePosition(&node, i, len(topology.Nodes), width, height)
		
		// Node circle
		svg.WriteString(fmt.Sprintf(`    <circle class="node" cx="%d" cy="%d" r="30" />
`, x, y))
		
		// Node label
		svg.WriteString(fmt.Sprintf(`    <text class="node-text" x="%d" y="%d">%s</text>
    <text class="node-text" x="%d" y="%d" font-size="10">%s</text>
`, x, y-5, node.Kind, x, y+10, node.Name))
	}

	svg.WriteString(`  </g>
</svg>`)

	return svg.String()
}

// findNode finds a node by ID
func findNode(nodes []models.TopologyNode, id string) *models.TopologyNode {
	for i := range nodes {
		if nodes[i].ID == id {
			return &nodes[i]
		}
	}
	return nil
}

// getNodePosition calculates node position for layout
// This is a simple circular layout - in production you'd use a proper layout algorithm
func getNodePosition(node *models.TopologyNode, index, total, width, height int) (int, int) {
	if node.Position != nil {
		return int(node.Position.X), int(node.Position.Y)
	}
	
	// Simple circular layout
	centerX := width / 2
	centerY := height / 2
	radius := min(width, height) / 3
	
	angle := float64(index) / float64(total) * 2 * 3.14159
	x := centerX + int(float64(radius)*cosApprox(angle))
	y := centerY + int(float64(radius)*sinApprox(angle))
	
	return x, y
}

// Simple cos approximation
func cosApprox(x float64) float64 {
	// Taylor series approximation
	return 1 - (x*x)/2 + (x*x*x*x)/24
}

// Simple sin approximation
func sinApprox(x float64) float64 {
	// Taylor series approximation
	return x - (x*x*x)/6 + (x*x*x*x*x)/120
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
