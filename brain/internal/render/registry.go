// Package render owns the deterministic-rendering pipeline: the
// classification registry, the BuildDeterministicResponse chokepoint,
// and per-tool shapers. It is the ONLY package permitted to construct
// AssistantEvent values of kind RenderBlock.
//
// Import discipline (planned enforcement via depguard in Task 11;
// treat as binding now even though the lint is not yet wired):
//   render MAY import: internal/derived, internal/llm/summary
//   render MAY NOT import: internal/llm (raw LLM client)
package render

type Class string
type RenderType string

const (
	Deterministic Class = "deterministic"
	Analytical    Class = "analytical"
)

const (
	RenderKubectlTable RenderType = "kubectl_table"
	RenderYAMLBlock    RenderType = "yaml_block"
	RenderError        RenderType = "render_error"
	// RenderText is reserved for the analytical default. Deterministic
	// tools must declare a structured renderer (enforced by tests).
	RenderText RenderType = "text"
)

// ToolBehavior is the per-tool classification + render type.
type ToolBehavior struct {
	Class  Class
	Render RenderType
}

// registry is the single source of truth for tool classification.
// Phase 1: list_resources + get_resource (the production MCP tool
// names). Adding a tool is the rollout knob — every new tool ships
// in Analytical mode by default (see Lookup), and going live is a
// deliberate edit here.
//
// list_pods / get_pod_yaml are retained as test-only entries so the
// fixture-driven shaper tests + hallucination probes keep working.
var registry = map[string]ToolBehavior{
	"list_resources": {Class: Deterministic, Render: RenderKubectlTable},
	"get_resource":   {Class: Deterministic, Render: RenderYAMLBlock},
	"list_pods":      {Class: Deterministic, Render: RenderKubectlTable},
	"get_pod_yaml":   {Class: Deterministic, Render: RenderYAMLBlock},
}

// Lookup returns the ToolBehavior for a registered tool, or the
// Analytical+Text default for unmapped tools. This default preserves
// pre-Phase-1 behavior — new tools are safe by construction.
func Lookup(toolName string) ToolBehavior {
	if b, ok := registry[toolName]; ok {
		return b
	}
	return ToolBehavior{Class: Analytical, Render: RenderText}
}
