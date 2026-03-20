package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// HandleExportTopology handles topology export in various formats.
// GET /api/v1/clusters/{id}/topology/v2/export/{format}
// Supported formats: json, drawio
func HandleExportTopology(response *v2.TopologyResponse) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if response == nil {
			http.Error(w, "no topology data available", http.StatusNotFound)
			return
		}

		// Extract format from URL path
		path := r.URL.Path
		parts := strings.Split(path, "/")
		format := parts[len(parts)-1]

		switch format {
		case "json":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition",
				fmt.Sprintf("attachment; filename=\"topology-%s.json\"", response.Metadata.ClusterID))
			enc := json.NewEncoder(w)
			enc.SetIndent("", "  ")
			_ = enc.Encode(response)

		case "drawio":
			xml := generateDrawIOXML(response)
			w.Header().Set("Content-Type", "application/xml")
			w.Header().Set("Content-Disposition",
				fmt.Sprintf("attachment; filename=\"topology-%s.drawio\"", response.Metadata.ClusterID))
			_, _ = w.Write([]byte(xml))

		default:
			http.Error(w, fmt.Sprintf("unsupported export format: %s", format), http.StatusBadRequest)
		}
	}
}

// generateDrawIOXML converts a TopologyResponse to Draw.io XML format.
func generateDrawIOXML(response *v2.TopologyResponse) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>`)
	sb.WriteString("\n")
	sb.WriteString(`<mxfile>`)
	sb.WriteString("\n")
	sb.WriteString(`  <diagram name="Topology">`)
	sb.WriteString("\n")
	sb.WriteString(`    <mxGraphModel>`)
	sb.WriteString("\n")
	sb.WriteString(`      <root>`)
	sb.WriteString("\n")
	sb.WriteString(`        <mxCell id="0"/>`)
	sb.WriteString("\n")
	sb.WriteString(`        <mxCell id="1" parent="0"/>`)
	sb.WriteString("\n")

	cellID := 2

	// Category to color mapping
	categoryColors := map[string]string{
		"workload":   "#2563EB",
		"networking": "#7C3AED",
		"config":     "#0D9488",
		"storage":    "#EA580C",
		"rbac":       "#D97706",
		"scaling":    "#16A34A",
		"cluster":    "#475569",
		"extensions": "#DB2777",
	}

	nodeIDMap := make(map[string]int)

	// Render nodes
	for i, node := range response.Nodes {
		id := cellID + i
		nodeIDMap[node.ID] = id
		x := (i % 5) * 200
		y := (i / 5) * 120
		color := categoryColors[node.Category]
		if color == "" {
			color = "#475569"
		}

		sb.WriteString(fmt.Sprintf(
			`        <mxCell id="%d" value="%s\n%s" style="rounded=1;whiteSpace=wrap;fillColor=%s;fontColor=#FFFFFF;strokeColor=%s;" vertex="1" parent="1">`+"\n",
			id, escapeXML(node.Kind), escapeXML(node.Name), color, color,
		))
		sb.WriteString(fmt.Sprintf(
			`          <mxGeometry x="%d" y="%d" width="160" height="80" as="geometry"/>`+"\n", x, y,
		))
		sb.WriteString(`        </mxCell>` + "\n")
	}

	cellID += len(response.Nodes)

	// Render edges
	for i, edge := range response.Edges {
		id := cellID + i
		sourceID, sok := nodeIDMap[edge.Source]
		targetID, tok := nodeIDMap[edge.Target]
		if !sok || !tok {
			continue
		}

		sb.WriteString(fmt.Sprintf(
			`        <mxCell id="%d" value="%s" style="edgeStyle=orthogonalEdgeStyle;" edge="1" source="%d" target="%d" parent="1">`+"\n",
			id, escapeXML(edge.Label), sourceID, targetID,
		))
		sb.WriteString(`          <mxGeometry relative="1" as="geometry"/>` + "\n")
		sb.WriteString(`        </mxCell>` + "\n")
	}

	sb.WriteString(`      </root>` + "\n")
	sb.WriteString(`    </mxGraphModel>` + "\n")
	sb.WriteString(`  </diagram>` + "\n")
	sb.WriteString(`</mxfile>` + "\n")

	return sb.String()
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}
