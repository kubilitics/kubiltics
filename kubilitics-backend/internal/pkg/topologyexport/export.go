package topologyexport

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"math"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	nodeWidth  = 120
	nodeHeight = 40
	gridGapX   = 180
	gridGapY   = 60
)

// ApplySimpleLayout assigns grid positions to nodes that don't have Position set.
func ApplySimpleLayout(g *models.TopologyGraph) {
	if g == nil {
		return
	}
	nodeIDs := make(map[string]int)
	for i, n := range g.Nodes {
		nodeIDs[n.ID] = i
	}
	// Grid: roughly sqrt(n) columns
	n := len(g.Nodes)
	cols := int(math.Ceil(math.Sqrt(float64(n))))
	if cols < 1 {
		cols = 1
	}
	for i := range g.Nodes {
		if g.Nodes[i].Position != nil {
			continue
		}
		row := i / cols
		col := i % cols
		x := float64(col)*gridGapX + 20
		y := float64(row)*gridGapY + 20
		g.Nodes[i].Position = &models.Position{X: x, Y: y}
	}
}

// GraphToJSON returns the topology graph as JSON bytes.
func GraphToJSON(g *models.TopologyGraph) ([]byte, error) {
	if g == nil {
		return []byte("null"), nil
	}
	return json.MarshalIndent(g, "", "  ")
}

// GraphToSVG returns an SVG document representing the topology graph.
func GraphToSVG(g *models.TopologyGraph) ([]byte, error) {
	if g == nil || len(g.Nodes) == 0 {
		return []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><text x="20" y="50" font-size="14">No resources</text></svg>`), nil
	}
	ApplySimpleLayout(g)
	// Bounds
	minX, minY := 1e9, 1e9
	maxX, maxY := -1e9, -1e9
	for _, n := range g.Nodes {
		if n.Position == nil {
			continue
		}
		x, y := n.Position.X, n.Position.Y
		if x < minX {
			minX = x
		}
		if y < minY {
			minY = y
		}
		if x+nodeWidth > maxX {
			maxX = x + nodeWidth
		}
		if y+nodeHeight > maxY {
			maxY = y + nodeHeight
		}
	}
	if minX == 1e9 {
		minX, minY, maxX, maxY = 0, 0, 400, 200
	}
	width := int(maxX - minX + 40)
	height := int(maxY - minY + 40)
	if width < 400 {
		width = 400
	}
	if height < 200 {
		height = 200
	}

	posByID := make(map[string]*models.Position)
	for i := range g.Nodes {
		posByID[g.Nodes[i].ID] = g.Nodes[i].Position
	}

	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`, width, height, width, height))
	buf.WriteString(`<defs><style>.node { fill: #e2e8f0; stroke: #64748b; stroke-width: 1; } .edge { stroke: #94a3b8; stroke-width: 2; fill: none; } .label { font: 12px sans-serif; fill: #334155; }</style></defs>`)
	// Edges
	for _, e := range g.Edges {
		src, ok1 := posByID[e.Source]
		dst, ok2 := posByID[e.Target]
		if !ok1 || !ok2 || src == nil || dst == nil {
			continue
		}
		sx := src.X + nodeWidth/2
		sy := src.Y + nodeHeight
		dx := dst.X + nodeWidth/2
		dy := dst.Y
		buf.WriteString(fmt.Sprintf(`<path class="edge" d="M %f %f L %f %f"/>`, sx, sy, dx, dy))
	}
	// Nodes
	for _, n := range g.Nodes {
		if n.Position == nil {
			continue
		}
		x, y := n.Position.X, n.Position.Y
		label := n.Name
		if len(label) > 18 {
			label = label[:15] + "..."
		}
		label = escapeXML(label)
		kind := n.Kind
		if kind == "" {
			kind = "Resource"
		}
		buf.WriteString(fmt.Sprintf(`<rect class="node" x="%f" y="%f" width="%d" height="%d" rx="4"/>`, x, y, nodeWidth, nodeHeight))
		buf.WriteString(fmt.Sprintf(`<text class="label" x="%f" y="%f" text-anchor="middle">%s: %s</text>`, x+float64(nodeWidth)/2, y+nodeHeight/2+4, escapeXML(kind), label))
	}
	buf.WriteString("</svg>")
	return buf.Bytes(), nil
}

func escapeXML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;").Replace(s)
}

// draw.io mxfile structure (minimal valid export)
type mxfile struct {
	XMLName xml.Name `xml:"mxfile"`
	Host    string   `xml:"host,attr"`
	Modified string  `xml:"modified,attr"`
	Agent   string   `xml:"agent,attr"`
	Version string   `xml:"version,attr"`
	Diagram mxDiagram `xml:"diagram"`
}

type mxDiagram struct {
	XMLName xml.Name `xml:"diagram"`
	ID      string   `xml:"id,attr"`
	Name    string   `xml:"name,attr"`
	MxGraphModel mxGraphModel `xml:"mxGraphModel"`
}

type mxGraphModel struct {
	XMLName  xml.Name   `xml:"mxGraphModel"`
	DX       int        `xml:"dx,attr"`
	DY       int        `xml:"dy,attr"`
	Grid     int        `xml:"grid,attr"`
	GridSize int        `xml:"gridSize,attr"`
	Root     mxRoot     `xml:"root"`
}

type mxRoot struct {
	XMLName xml.Name  `xml:"root"`
	Cells   []mxCell  `xml:"mxCell"`
}

type mxCell struct {
	XMLName xml.Name `xml:"mxCell"`
	ID      string   `xml:"id,attr"`
	Parent  string   `xml:"parent,attr,omitempty"`
	Value   string   `xml:"value,attr,omitempty"`
	Style   string   `xml:"style,attr,omitempty"`
	Vertex  string   `xml:"vertex,attr,omitempty"`
	Edge    string   `xml:"edge,attr,omitempty"`
	Source  string   `xml:"source,attr,omitempty"`
	Target  string   `xml:"target,attr,omitempty"`
	Geometry *mxGeometry `xml:"mxGeometry,omitempty"`
}

type mxGeometry struct {
	XMLName  xml.Name `xml:"mxGeometry"`
	X        string   `xml:"x,attr,omitempty"`
	Y        string   `xml:"y,attr,omitempty"`
	Width    string   `xml:"width,attr,omitempty"`
	Height   string   `xml:"height,attr,omitempty"`
	Relative string   `xml:"relative,attr,omitempty"`
	As       string   `xml:"as,attr,omitempty"`
}

// GraphToDrawioXML returns draw.io (diagrams.net) XML bytes.
func GraphToDrawioXML(g *models.TopologyGraph) ([]byte, error) {
	if g == nil || len(g.Nodes) == 0 {
		return []byte(`<mxfile host="app.diagrams.net"><diagram id="0" name="empty"><mxGraphModel dx="0" dy="0" grid="1" gridSize="10"><root><mxCell id="1"/></root></mxGraphModel></diagram></mxfile>`), nil
	}
	ApplySimpleLayout(g)
	posByID := make(map[string]*models.Position)
	for i := range g.Nodes {
		posByID[g.Nodes[i].ID] = g.Nodes[i].Position
	}
	cellID := 2
	cells := []mxCell{{XMLName: xml.Name{Local: "mxCell"}, ID: "1"}}
	nodeIDToCell := make(map[string]string)
	for _, n := range g.Nodes {
		if n.Position == nil {
			continue
		}
		cid := fmt.Sprintf("%d", cellID)
		cellID++
		nodeIDToCell[n.ID] = cid
		label := n.Name
		if n.Kind != "" {
			label = n.Kind + ": " + label
		}
		if len(label) > 40 {
			label = label[:37] + "..."
		}
		cells = append(cells, mxCell{
			ID:     cid,
			Parent: "1",
			Value:  label,
			Style:  "rounded=1;whiteSpace=wrap;html=1;fillColor=#e2e8f0;strokeColor=#64748b;",
			Vertex: "1",
			Geometry: &mxGeometry{
				X: fmt.Sprintf("%f", n.Position.X), Y: fmt.Sprintf("%f", n.Position.Y),
				Width: fmt.Sprintf("%d", nodeWidth), Height: fmt.Sprintf("%d", nodeHeight), As: "geometry",
			},
		})
	}
	for _, e := range g.Edges {
		srcID, ok1 := nodeIDToCell[e.Source]
		dstID, ok2 := nodeIDToCell[e.Target]
		if !ok1 || !ok2 {
			continue
		}
		cells = append(cells, mxCell{
			ID:     fmt.Sprintf("%d", cellID),
			Parent: "1",
			Edge:   "1",
			Source: srcID,
			Target: dstID,
			Style:  "endArrow=classic;html=1;strokeColor=#94a3b8;",
			Geometry: &mxGeometry{Relative: "1", As: "geometry"},
		})
		cellID++
	}
	mx := mxfile{
		Host: "app.diagrams.net", Modified: "2025-01-01T00:00:00.000Z", Agent: "Kubilitics", Version: "21.0.0",
		Diagram: mxDiagram{
			ID: "topology", Name: "Topology",
			MxGraphModel: mxGraphModel{DX: 1200, DY: 800, Grid: 1, GridSize: 10, Root: mxRoot{Cells: cells}},
		},
	}
	return xml.MarshalIndent(mx, "", "  ")
}
