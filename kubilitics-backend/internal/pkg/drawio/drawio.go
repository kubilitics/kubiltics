package drawio

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const drawioBaseURL = "https://app.diagrams.net/"

// sanitizeId makes a string safe for Mermaid node IDs.
func sanitizeId(s string) string {
	re := regexp.MustCompile(`[^a-zA-Z0-9_]`)
	s = re.ReplaceAllString(s, "_")
	s = regexp.MustCompile(`_+`).ReplaceAllString(s, "_")
	if len(s) > 50 {
		s = s[:50]
	}
	if s == "" {
		s = "node"
	}
	return s
}

// TopologyGraphToMermaid converts a TopologyGraph to Mermaid flowchart syntax.
func TopologyGraphToMermaid(graph *models.TopologyGraph) string {
	if graph == nil || len(graph.Nodes) == 0 {
		return "flowchart TB\n  empty[No resources]"
	}

	lines := []string{"flowchart TB"}
	nodeIds := make(map[string]bool)
	visibleIds := make(map[string]bool)
	for _, n := range graph.Nodes {
		visibleIds[n.ID] = true
	}

	for _, node := range graph.Nodes {
		safeId := sanitizeId(node.ID)
		if nodeIds[safeId] {
			continue
		}
		nodeIds[safeId] = true
		kind := node.Kind
		if kind == "" {
			kind = "Resource"
		}
		label := node.Name
		if len(label) > 25 {
			label = label[:22] + "..."
		}
		label = strings.ReplaceAll(label, `"`, "'")
		lines = append(lines, `  `+safeId+`["`+kind+`: `+label+`"]`)
	}

	for _, edge := range graph.Edges {
		if !visibleIds[edge.Source] || !visibleIds[edge.Target] {
			continue
		}
		fromId := sanitizeId(edge.Source)
		toId := sanitizeId(edge.Target)
		if !nodeIds[fromId] || !nodeIds[toId] {
			continue
		}
		label := ""
		if edge.Label != "" {
			label = `|` + edge.Label + `|`
		}
		lines = append(lines, `  `+fromId+` -->`+label+` `+toId)
	}

	return strings.Join(lines, "\n")
}

// createObj is the draw.io JSON structure for create= hash.
type createObj struct {
	Type       string `json:"type"`
	Compressed bool   `json:"compressed"`
	Data       string `json:"data"`
}

// GenerateDrawioURL creates a draw.io URL that opens the editor with the given Mermaid content.
func GenerateDrawioURL(mermaid string) (string, error) {
	if mermaid == "" {
		return drawioBaseURL, nil
	}

	encoded := url.QueryEscape(mermaid)
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.BestCompression)
	if err != nil {
		return "", err
	}
	if _, err := w.Write([]byte(encoded)); err != nil {
		w.Close()
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	compressed := base64.StdEncoding.EncodeToString(buf.Bytes())

	obj := createObj{
		Type:       "mermaid",
		Compressed: true,
		Data:       compressed,
	}
	jsonBytes, err := json.Marshal(obj)
	if err != nil {
		return "", err
	}
	createHash := "#create=" + url.QueryEscape(string(jsonBytes))
	return drawioBaseURL + "?grid=0&pv=0&border=10&edit=_blank" + createHash, nil
}
