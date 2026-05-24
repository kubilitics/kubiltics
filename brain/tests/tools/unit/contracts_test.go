// Package unit validates tool taxonomy contracts without a live cluster.
// These tests run in CI on every push and enforce:
//   - Every tool has a non-empty Name, Description, and Category
//   - Names are unique across the taxonomy
//   - Destructive tools have RequiredAutonomyLevel >= 4 (Act)
//   - No tool name contains whitespace or uppercase letters
//   - All 8 expected categories are represented
//   - Tool count stays within expected bounds (sanity check against accidental deletions)
package unit

import (
	"strings"
	"testing"
	"unicode"

	"github.com/vellankikoti/kubilitics/brain/internal/mcp/tools"
)

func TestContract_AllToolsHaveRequiredFields(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		t.Run(td.Name, func(t *testing.T) {
			if td.Name == "" {
				t.Error("Name must not be empty")
			}
			if td.Description == "" {
				t.Errorf("tool %q: Description must not be empty", td.Name)
			}
			if td.Category == "" {
				t.Errorf("tool %q: Category must not be empty", td.Name)
			}
			if td.InputSchema == nil {
				t.Errorf("tool %q: InputSchema must not be nil", td.Name)
			}
		})
	}
}

func TestContract_UniqueNames(t *testing.T) {
	seen := make(map[string]int)
	for i, td := range tools.ToolTaxonomy {
		if prev, ok := seen[td.Name]; ok {
			t.Errorf("duplicate tool name %q at indices %d and %d", td.Name, prev, i)
		}
		seen[td.Name] = i
	}
}

func TestContract_NameFormat(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		for _, r := range td.Name {
			if unicode.IsUpper(r) {
				t.Errorf("tool %q: name must be lowercase (found uppercase %q)", td.Name, r)
				break
			}
			if unicode.IsSpace(r) {
				t.Errorf("tool %q: name must not contain whitespace", td.Name)
				break
			}
		}
		if strings.HasPrefix(td.Name, "_") || strings.HasSuffix(td.Name, "_") {
			t.Errorf("tool %q: name must not start or end with underscore", td.Name)
		}
	}
}

func TestContract_DestructiveToolsHaveHighAutonomy(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		if td.Destructive && td.RequiredAutonomyLevel < 4 {
			t.Errorf("tool %q is Destructive but RequiredAutonomyLevel=%d (must be >= 4 = Act)",
				td.Name, td.RequiredAutonomyLevel)
		}
	}
}

func TestContract_ExecutionCategoryIsDestructive(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		if td.Category == tools.CategoryExecution && !td.Destructive {
			t.Errorf("tool %q is in execution category but not marked Destructive", td.Name)
		}
	}
}

func TestContract_AllCategoriesRepresented(t *testing.T) {
	want := []tools.ToolCategory{
		tools.CategoryObservation,
		tools.CategoryAnalysis,
		tools.CategoryRecommendation,
		tools.CategoryTroubleshooting,
		tools.CategorySecurity,
		tools.CategoryCost,
		tools.CategoryAutomation,
		tools.CategoryExecution,
	}
	have := make(map[tools.ToolCategory]bool)
	for _, td := range tools.ToolTaxonomy {
		have[td.Category] = true
	}
	for _, cat := range want {
		if !have[cat] {
			t.Errorf("expected category %q to have at least one tool", cat)
		}
	}
}

func TestContract_ToolCount(t *testing.T) {
	count := len(tools.ToolTaxonomy)
	// Sanity guard: warn if count drops below 100 (accidental deletions)
	// or exceeds 300 (runaway additions without review).
	const minExpected = 100
	const maxExpected = 300
	if count < minExpected {
		t.Errorf("tool count %d is below minimum %d — possible accidental deletions", count, minExpected)
	}
	if count > maxExpected {
		t.Errorf("tool count %d exceeds maximum %d — review taxonomy for bloat", count, maxExpected)
	}
	t.Logf("Tool count: %d (within [%d, %d])", count, minExpected, maxExpected)
}

func TestContract_ObservationToolsAreNotDestructive(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		if td.Category == tools.CategoryObservation && td.Destructive {
			t.Errorf("tool %q is in observation category but marked Destructive (read-only category)", td.Name)
		}
	}
}

func TestContract_AnalysisToolsAreNotDestructive(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		if td.Category == tools.CategoryAnalysis && td.Destructive {
			t.Errorf("tool %q is in analysis category but marked Destructive (read-only category)", td.Name)
		}
	}
}

func TestContract_InputSchemaHasProperties(t *testing.T) {
	for _, td := range tools.ToolTaxonomy {
		schema, ok := td.InputSchema.(map[string]interface{})
		if !ok {
			t.Errorf("tool %q: InputSchema is not a map[string]interface{}", td.Name)
			continue
		}
		props, hasProp := schema["properties"]
		if !hasProp {
			t.Errorf("tool %q: InputSchema missing 'properties' key", td.Name)
			continue
		}
		propMap, ok := props.(map[string]interface{})
		if !ok || len(propMap) == 0 {
			t.Errorf("tool %q: InputSchema.properties is empty — every tool must declare at least cluster_id", td.Name)
		}
		if _, hasCluster := propMap["cluster_id"]; !hasCluster {
			t.Errorf("tool %q: InputSchema.properties missing 'cluster_id'", td.Name)
		}
	}
}

func TestContract_CategoryDistribution(t *testing.T) {
	dist := make(map[tools.ToolCategory]int)
	for _, td := range tools.ToolTaxonomy {
		dist[td.Category]++
	}
	t.Log("Category distribution:")
	for cat, count := range dist {
		t.Logf("  %-20s %d tools", cat, count)
		if count == 0 {
			t.Errorf("category %q has 0 tools", cat)
		}
	}
}
