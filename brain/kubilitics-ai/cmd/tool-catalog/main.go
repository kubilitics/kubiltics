// Command tool-catalog extracts the full MCP tool inventory from the
// in-code ToolTaxonomy + GetChatToolDefinitions, merges a hand-authored
// plain-english description map, and emits a single JSON catalog for the
// bench report to render.
//
// Usage:
//
//	go run ./cmd/tool-catalog --plain-english docs/reports/plain-english.json --out /tmp/catalog.json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"

	tools "github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/mcp/tools"
)

// CatalogEntry is the merged, flattened view of one MCP tool.
type CatalogEntry struct {
	Name          string                 `json:"name"`
	Category      string                 `json:"category"`
	Description   string                 `json:"description"`
	PlainEnglish  string                 `json:"plain_english"`
	AutonomyLevel int                    `json:"autonomy_level"`
	Destructive   bool                   `json:"destructive"`
	RequiresAI    bool                   `json:"requires_ai"`
	InputSchema   map[string]interface{} `json:"input_schema,omitempty"`
	Parameters    []string               `json:"parameters,omitempty"`
	Required      []string               `json:"required,omitempty"`
	Source        string                 `json:"source"` // "taxonomy" | "chat"
}

const pending = "(description pending)"

// buildCatalog merges ToolTaxonomy + chat tool defs with the provided
// plain-english description map. Tools with no plain-english entry get
// "(description pending)". Entries are deduplicated by Name (taxonomy wins).
func buildCatalog(plain map[string]string) []CatalogEntry {
	seen := make(map[string]bool)
	out := make([]CatalogEntry, 0, len(tools.ToolTaxonomy)+16)

	add := func(t tools.ToolDefinition, source string) {
		if seen[t.Name] {
			return
		}
		seen[t.Name] = true
		pe, ok := plain[t.Name]
		if !ok || pe == "" {
			pe = pending
		}
		e := CatalogEntry{
			Name:          t.Name,
			Category:      string(t.Category),
			Description:   t.Description,
			PlainEnglish:  pe,
			AutonomyLevel: t.RequiredAutonomyLevel,
			Destructive:   t.Destructive,
			RequiresAI:    t.RequiresAI,
			Source:        source,
		}
		// InputSchema on ToolDefinition is interface{} — try to surface
		// properties + required if it's shaped as the usual JSON-schema map.
		if m, ok := t.InputSchema.(map[string]interface{}); ok && m != nil {
			e.InputSchema = m
			if props, ok := m["properties"].(map[string]interface{}); ok {
				for k := range props {
					e.Parameters = append(e.Parameters, k)
				}
				sort.Strings(e.Parameters)
			}
			if reqAny, ok := m["required"]; ok {
				switch r := reqAny.(type) {
				case []string:
					e.Required = append(e.Required, r...)
				case []interface{}:
					for _, v := range r {
						if s, ok := v.(string); ok {
							e.Required = append(e.Required, s)
						}
					}
				}
			}
		}
		out = append(out, e)
	}

	for _, t := range tools.ToolTaxonomy {
		add(t, "taxonomy")
	}
	for _, t := range tools.GetChatToolDefinitions() {
		add(t, "chat")
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Category != out[j].Category {
			return out[i].Category < out[j].Category
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// writeCatalogJSON pretty-prints the catalog to path.
func writeCatalogJSON(path string, cat []CatalogEntry) error {
	b, err := json.MarshalIndent(cat, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// loadPlainEnglish reads {name: description} from a JSON file. Missing file
// is not an error — returns an empty map so every entry falls through to
// "(description pending)".
func loadPlainEnglish(path string) (map[string]string, error) {
	if path == "" {
		return map[string]string{}, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]string{}, nil
		}
		return nil, err
	}
	out := map[string]string{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return out, nil
}

func main() {
	plainPath := flag.String("plain-english", "docs/reports/plain-english.json", "path to plain-english descriptions JSON")
	outPath := flag.String("out", "catalog.json", "output catalog path")
	flag.Parse()

	plain, err := loadPlainEnglish(*plainPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load plain-english: %v\n", err)
		os.Exit(1)
	}
	cat := buildCatalog(plain)
	if err := writeCatalogJSON(*outPath, cat); err != nil {
		fmt.Fprintf(os.Stderr, "write catalog: %v\n", err)
		os.Exit(1)
	}

	hits := 0
	for _, e := range cat {
		if e.PlainEnglish != pending {
			hits++
		}
	}
	fmt.Printf("wrote %s — %d tools (%d with plain-english, %d pending)\n",
		*outPath, len(cat), hits, len(cat)-hits)
}
