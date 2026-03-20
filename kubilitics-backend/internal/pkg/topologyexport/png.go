package topologyexport

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// GraphToPNG renders the topology graph to a PNG image (nodes as rects, edges as lines).
func GraphToPNG(g *models.TopologyGraph) ([]byte, error) {
	if g == nil || len(g.Nodes) == 0 {
		// Minimal 400x100 PNG
		img := image.NewRGBA(image.Rect(0, 0, 400, 100))
		draw.Draw(img, img.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	ApplySimpleLayout(g)
	posByID := make(map[string]*models.Position)
	for i := range g.Nodes {
		posByID[g.Nodes[i].ID] = g.Nodes[i].Position
	}
	minX, minY := math.MaxFloat64, math.MaxFloat64
	maxX, maxY := -math.MaxFloat64, -math.MaxFloat64
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
		if x+float64(nodeWidth) > maxX {
			maxX = x + float64(nodeWidth)
		}
		if y+float64(nodeHeight) > maxY {
			maxY = y + float64(nodeHeight)
		}
	}
	if minX == math.MaxFloat64 {
		minX, minY, maxX, maxY = 0, 0, 400, 200
	}
	pad := 40
	width := int(maxX-minX) + pad*2
	height := int(maxY-minY) + pad*2
	if width < 400 {
		width = 400
	}
	if height < 200 {
		height = 200
	}
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	white := color.RGBA{255, 255, 255, 255}
	draw.Draw(img, img.Bounds(), &image.Uniform{white}, image.Point{}, draw.Src)
	nodeColor := color.RGBA{226, 232, 240, 255}   // #e2e8f0
	strokeColor := color.RGBA{100, 116, 139, 255} // #64748b
	edgeColor := color.RGBA{148, 163, 184, 255}  // #94a3b8
	ox := float64(pad) - minX
	oy := float64(pad) - minY
	// Draw edges first
	for _, e := range g.Edges {
		src, ok1 := posByID[e.Source]
		dst, ok2 := posByID[e.Target]
		if !ok1 || !ok2 || src == nil || dst == nil {
			continue
		}
		x1 := int(src.X + nodeWidth/2 + ox)
		y1 := int(src.Y + nodeHeight + oy)
		x2 := int(dst.X + nodeWidth/2 + ox)
		y2 := int(dst.Y + oy)
		drawLine(img, x1, y1, x2, y2, edgeColor)
	}
	// Draw nodes (rects)
	for _, n := range g.Nodes {
		if n.Position == nil {
			continue
		}
		x := int(n.Position.X + ox)
		y := int(n.Position.Y + oy)
		rect := image.Rect(x, y, x+nodeWidth, y+nodeHeight)
		draw.Draw(img, rect, &image.Uniform{nodeColor}, image.Point{}, draw.Src)
		// Border
		for i := 0; i < 2; i++ {
			drawRectBorder(img, rect, strokeColor)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func drawLine(img draw.Image, x0, y0, x1, y1 int, c color.Color) {
	dx := abs(x1 - x0)
	dy := abs(y1 - y0)
	sx, sy := 1, 1
	if x0 >= x1 {
		sx = -1
	}
	if y0 >= y1 {
		sy = -1
	}
	err := dx - dy
	for {
		img.Set(x0, y0, c)
		if x0 == x1 && y0 == y1 {
			break
		}
		e2 := 2 * err
		if e2 > -dy {
			err -= dy
			x0 += sx
		}
		if e2 < dx {
			err += dx
			y0 += sy
		}
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func drawRectBorder(img draw.Image, r image.Rectangle, c color.Color) {
	for x := r.Min.X; x <= r.Max.X; x++ {
		img.Set(x, r.Min.Y, c)
		img.Set(x, r.Max.Y, c)
	}
	for y := r.Min.Y; y <= r.Max.Y; y++ {
		img.Set(r.Min.X, y, c)
		img.Set(r.Max.X, y, c)
	}
}
