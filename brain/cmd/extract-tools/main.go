// Extract dumps the merged Tool taxonomy to JSON for downstream prompt-gen tooling.
//
// Output schema (one element per tool):
//
//	{"name":"...", "category":"observation|analysis|...", "description":"...",
//	 "args":{...optional input schema...}}
//
// Dedupes by name (chat_tools may overlap taxonomy).
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/mcp/tools"
)

type out struct {
	Name        string      `json:"name"`
	Category    string      `json:"category"`
	Description string      `json:"description"`
	Args        interface{} `json:"args,omitempty"`
}

func main() {
	merged := append([]tools.ToolDefinition{}, tools.ToolTaxonomy...)
	merged = append(merged, tools.GetChatToolDefinitions()...)

	seen := map[string]bool{}
	rows := []out{}
	for _, t := range merged {
		if seen[t.Name] {
			continue
		}
		seen[t.Name] = true
		rows = append(rows, out{
			Name:        t.Name,
			Category:    string(t.Category),
			Description: t.Description,
			Args:        t.InputSchema,
		})
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(rows); err != nil {
		fmt.Fprintln(os.Stderr, "extract:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "extracted %d unique tools\n", len(rows))
}
