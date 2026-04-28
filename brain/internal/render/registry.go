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
	// RenderLogBlock is for line-oriented log output (Phase 2 #4).
	// Unlike kubectl_table (rows of structured columns) or yaml_block
	// (a single document), logs are an ordered sequence of opaque
	// strings. The frontend renders them in a monospace, scrollable
	// log surface with line numbers and truncation indicators.
	RenderLogBlock RenderType = "log_block"
	RenderError    RenderType = "render_error"
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
//
// Adding a tool is the rollout knob — every new tool ships in
// Analytical mode by default (see Lookup), and going live is a
// deliberate edit here. Each Deterministic entry MUST have a
// matching shaper in package shapers (TestDeterministicToolsHaveShapers
// enforces this at build time).
//
// Phase 1 (initial Deterministic set):
//   list_resources / get_resource — list + detail for any kind
//
// Phase 2 #3 (inspect_* expansion):
//   All 27 inspect_<kind> tools render the same rich detail blob and
//   reuse ShapeGetResource (which pretty-prints arbitrary JSON for
//   the YamlBlock renderer). This brings ~30 more tool-call paths
//   under the structured-render guarantee.
//
// list_pods / get_pod_yaml are retained as test-only entries so the
// fixture-driven shaper tests + hallucination probes keep working.
var registry = map[string]ToolBehavior{
	// — Phase 1 production tools —
	"list_resources": {Class: Deterministic, Render: RenderKubectlTable},
	"get_resource":   {Class: Deterministic, Render: RenderYAMLBlock},

	// — Phase 2 #4: log-oriented tools —
	"get_logs": {Class: Deterministic, Render: RenderLogBlock},

	// — Phase 2 #3: inspect_<kind> family —
	// Workloads
	"inspect_pod":         {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_deployment":  {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_replicaset":  {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_statefulset": {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_daemonset":   {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_job":         {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_cronjob":     {Class: Deterministic, Render: RenderYAMLBlock},
	// Cluster scope
	"inspect_node":      {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_namespace": {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_crd":       {Class: Deterministic, Render: RenderYAMLBlock},
	// Networking
	"inspect_service":       {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_ingress":       {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_networkpolicy": {Class: Deterministic, Render: RenderYAMLBlock},
	// Storage
	"inspect_pvc":          {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_pv":           {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_storageclass": {Class: Deterministic, Render: RenderYAMLBlock},
	// Config / data
	"inspect_configmap": {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_secret":    {Class: Deterministic, Render: RenderYAMLBlock},
	// RBAC
	"inspect_role":               {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_rolebinding":        {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_clusterrole":        {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_clusterrolebinding": {Class: Deterministic, Render: RenderYAMLBlock},
	// Quotas / limits / autoscaling / disruption
	"inspect_limitrange":    {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_resourcequota": {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_hpa":           {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_vpa":           {Class: Deterministic, Render: RenderYAMLBlock},
	"inspect_pdb":           {Class: Deterministic, Render: RenderYAMLBlock},

	// — Test-only entries (fixture-driven unit tests) —
	"list_pods":    {Class: Deterministic, Render: RenderKubectlTable},
	"get_pod_yaml": {Class: Deterministic, Render: RenderYAMLBlock},
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
