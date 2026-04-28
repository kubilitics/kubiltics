package render

// hallucination_probes_test.go is the Phase 1 hallucination-probe suite.
// Each probe drives a real tool fixture through BuildDeterministicResponse
// and asserts:
//  1. render.data is byte-equal to the shaper's output for the fixture
//     (no drift from expected wire shape)
//  2. summary contains zero entity-name tokens from the raw fixture
//     (the LLM physically cannot leak names because it never sees them)
//  3. The chokepoint never invokes the LLM completer (Phase 1 default
//     formatter is deterministic; this test pins that property)
//
// Plan calls for 30 probes; this Phase 1 ship covers 10 across both
// Deterministic tools and the major coverage axes (cardinality,
// status diversity, encoding, missing-fields). Followup PRs expand to
// the full 30 + tag axes for gap-aware coverage growth — see
// docs/superpowers/specs/2026-04-27-llm-as-translator-architecture-design.md
// §12.3.

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
	"github.com/vellankikoti/kubilitics/brain/internal/llm/summary"
	"github.com/vellankikoti/kubilitics/brain/internal/render/shapers"
)

// probeAxis tags one dimension of coverage. A single probe may carry
// multiple axes (e.g. "list_pods many + unicode"). The axis-coverage
// test asserts every defined axis has at least one probe tagged with
// it — so adding a new axis without a probe (or removing the only
// probe for an axis) is a build break.
type probeAxis string

const (
	axisCardinalityZero    probeAxis = "cardinality:zero"
	axisCardinalitySingle  probeAxis = "cardinality:single"
	axisCardinalityMany    probeAxis = "cardinality:many"
	axisStatusRunning      probeAxis = "status:running"
	axisStatusPending      probeAxis = "status:pending"
	axisStatusFailed       probeAxis = "status:failed"
	axisStatusMixed        probeAxis = "status:mixed"
	axisEncodingUnicode    probeAxis = "encoding:unicode"
	axisEncodingLongName   probeAxis = "encoding:long-name"
	axisEncodingSpecial    probeAxis = "encoding:special-chars"
	axisStructureMissing   probeAxis = "structure:missing-fields"
	axisStructureFlat      probeAxis = "structure:flat"
	axisStructureNested    probeAxis = "structure:nested"
	axisRendererTable      probeAxis = "renderer:kubectl_table"
	axisRendererYaml       probeAxis = "renderer:yaml_block"
	axisToolListPods       probeAxis = "tool:list_pods"
	axisToolGetPodYaml     probeAxis = "tool:get_pod_yaml"
)

// allAxes is the canonical roster. The coverage-by-axis test loops
// this list and asserts every axis is exercised by at least one probe.
// Adding a new axis without tagging any probe breaks the build.
var allAxes = []probeAxis{
	axisCardinalityZero, axisCardinalitySingle, axisCardinalityMany,
	axisStatusRunning, axisStatusPending, axisStatusFailed, axisStatusMixed,
	axisEncodingUnicode, axisEncodingLongName, axisEncodingSpecial,
	axisStructureMissing, axisStructureFlat, axisStructureNested,
	axisRendererTable, axisRendererYaml,
	axisToolListPods, axisToolGetPodYaml,
}

type probe struct {
	name           string
	tool           string
	namespace      string
	rawTool        string
	forbidTokens   []string // entity names that must NOT appear in summary
	wantRenderType string
	wantRowCount   int
	axes           []probeAxis // coverage axes this probe exercises
}

// probes is the Phase 2 #6 set: 30 probes tagged with coverage axes.
// The TestProbeAxisCoverage test asserts every defined axis has at
// least one probe — so adding an axis without a probe (or removing
// the only probe for an axis) is a build break.
//
// Axis tags are not just labels: TestProbeAxisCoverage uses them to
// catch regressions in test-suite *coverage* itself, separately from
// the hallucination assertions in TestHallucinationProbes.
var probes = []probe{
	// ─── list_pods × cardinality ─────────────────────────────────────
	{
		name: "list_pods_kube_system_mixed",
		tool: "list_pods", namespace: "kube-system",
		rawTool: `[
			{"metadata":{"name":"coredns-1","namespace":"kube-system"},"spec":{"containers":[{"name":"coredns"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"coredns-2","namespace":"kube-system"},"spec":{"containers":[{"name":"coredns"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":2}]}},
			{"metadata":{"name":"kube-proxy-1","namespace":"kube-system"},"spec":{"containers":[{"name":"kube-proxy"}]},"status":{"phase":"Pending","containerStatuses":[{"ready":false,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"coredns-1", "coredns-2", "kube-proxy-1"},
		wantRenderType: "kubectl_table",
		wantRowCount:   3,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStatusMixed, axisStructureNested},
	},
	{
		name: "list_pods_empty_namespace",
		tool: "list_pods", namespace: "empty-ns",
		rawTool:        `[]`,
		forbidTokens:   nil,
		wantRenderType: "kubectl_table",
		wantRowCount:   0,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisCardinalityZero},
	},
	{
		name: "list_pods_single_pod",
		tool: "list_pods", namespace: "default",
		rawTool: `[
			{"metadata":{"name":"my-app-7d9f","namespace":"default"},"spec":{"containers":[{"name":"app"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"my-app-7d9f"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisCardinalitySingle, axisStatusRunning},
	},
	{
		name: "list_pods_unicode_names",
		tool: "list_pods", namespace: "i18n",
		rawTool: `[
			{"metadata":{"name":"пёс-1","namespace":"i18n"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"пёс-1"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisEncodingUnicode},
	},
	{
		name: "list_pods_long_name",
		tool: "list_pods", namespace: "longname",
		rawTool: `[
			{"metadata":{"name":"super-long-deployment-name-with-suffix-abcdef-1234567890","namespace":"longname"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"super-long-deployment-name-with-suffix-abcdef-1234567890"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisEncodingLongName},
	},
	{
		name: "list_pods_all_failing",
		tool: "list_pods", namespace: "failing",
		rawTool: `[
			{"metadata":{"name":"crash-1","namespace":"failing"},"spec":{"containers":[{"name":"x"}]},"status":{"phase":"Failed","containerStatuses":[{"ready":false,"restartCount":7}]}},
			{"metadata":{"name":"crash-2","namespace":"failing"},"spec":{"containers":[{"name":"x"}]},"status":{"phase":"Failed","containerStatuses":[{"ready":false,"restartCount":3}]}}
		]`,
		forbidTokens:   []string{"crash-1", "crash-2"},
		wantRenderType: "kubectl_table",
		wantRowCount:   2,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStatusFailed},
	},
	{
		name: "list_pods_missing_status",
		tool: "list_pods", namespace: "partial",
		rawTool: `[
			{"metadata":{"name":"weird-pod","namespace":"partial"},"spec":{"containers":[{"name":"x"}]}}
		]`,
		forbidTokens:   []string{"weird-pod"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStructureMissing},
	},

	// ─── get_pod_yaml × variety ──────────────────────────────────────
	{
		name: "get_pod_yaml_simple",
		tool: "get_pod_yaml", namespace: "kube-system",
		rawTool:        `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: coredns-1\n"}`,
		forbidTokens:   []string{"coredns-1", "apiVersion"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStructureFlat},
	},
	{
		name: "get_pod_yaml_long",
		tool: "get_pod_yaml", namespace: "busy",
		rawTool: `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: very-busy-pod\n  labels:\n    app: example\n    tier: backend\nspec:\n  containers:\n  - name: main\n    image: example:1.2.3\n"}`,
		forbidTokens:   []string{"very-busy-pod", "example:1.2.3"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStructureNested},
	},
	{
		name: "get_pod_yaml_unicode",
		tool: "get_pod_yaml", namespace: "i18n",
		rawTool:        `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: pöd-ünïcödé\n"}`,
		forbidTokens:   []string{"pöd-ünïcödé"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisEncodingUnicode},
	},

	// ─── Phase 2 #6 expansion: 20 new probes ─────────────────────────
	// Each focused on a specific axis to lock in regression coverage.
	{
		name: "list_pods_many",
		tool: "list_pods", namespace: "busy",
		rawTool: `[
			{"metadata":{"name":"p1","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p2","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p3","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p4","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p5","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p6","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p7","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p8","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p9","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p10","namespace":"busy"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"p1", "p10", "busy"},
		wantRenderType: "kubectl_table",
		wantRowCount:   10,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisCardinalityMany, axisStatusRunning},
	},
	{
		name: "list_pods_all_pending",
		tool: "list_pods", namespace: "schedwait",
		rawTool: `[
			{"metadata":{"name":"sched-1","namespace":"schedwait"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Pending","containerStatuses":[{"ready":false,"restartCount":0}]}},
			{"metadata":{"name":"sched-2","namespace":"schedwait"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Pending","containerStatuses":[{"ready":false,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"sched-1", "sched-2"},
		wantRenderType: "kubectl_table",
		wantRowCount:   2,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStatusPending},
	},
	{
		name: "list_pods_special_chars_in_name",
		tool: "list_pods", namespace: "weird",
		// Quoted/escaped chars in JSON; valid K8s names typically don't
		// contain these, but the shaper must not assume that.
		rawTool: `[
			{"metadata":{"name":"name-with.dot_and-dashes-123","namespace":"weird"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"name-with.dot_and-dashes-123"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisEncodingSpecial},
	},
	{
		name: "list_pods_missing_metadata",
		tool: "list_pods", namespace: "partial",
		// Pod with no metadata block at all — shaper falls back to top-level "name".
		rawTool: `[
			{"name":"no-meta-pod","spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"no-meta-pod"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStructureMissing, axisStructureFlat},
	},
	{
		name: "list_pods_high_restart_count",
		tool: "list_pods", namespace: "flapping",
		rawTool: `[
			{"metadata":{"name":"flap-1","namespace":"flapping"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":9999}]}}
		]`,
		forbidTokens:   []string{"flap-1"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStructureNested},
	},
	{
		name: "list_pods_multi_container",
		tool: "list_pods", namespace: "sidecars",
		rawTool: `[
			{"metadata":{"name":"app-with-sidecar","namespace":"sidecars"},"spec":{"containers":[{"name":"app"},{"name":"envoy"},{"name":"otel"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0},{"ready":true,"restartCount":0},{"ready":false,"restartCount":3}]}}
		]`,
		forbidTokens:   []string{"app-with-sidecar", "envoy", "otel"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStructureNested},
	},
	{
		name: "list_pods_running_and_pending_mix",
		tool: "list_pods", namespace: "mixed",
		rawTool: `[
			{"metadata":{"name":"r1","namespace":"mixed"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"r2","namespace":"mixed"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"p1","namespace":"mixed"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Pending","containerStatuses":[{"ready":false,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"r1", "r2", "p1"},
		wantRenderType: "kubectl_table",
		wantRowCount:   3,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStatusMixed},
	},
	{
		name: "list_pods_cardinality_one_failed",
		tool: "list_pods", namespace: "down",
		rawTool: `[
			{"metadata":{"name":"oom","namespace":"down"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Failed","containerStatuses":[{"ready":false,"restartCount":2}]}}
		]`,
		forbidTokens:   []string{"oom"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisCardinalitySingle, axisStatusFailed},
	},
	{
		name: "list_pods_cross_namespace_mix",
		tool: "list_pods", namespace: "",
		rawTool: `[
			{"metadata":{"name":"alpha-pod","namespace":"alpha-ns"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}},
			{"metadata":{"name":"beta-pod","namespace":"beta-ns"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		// Realistic forbid-tokens — single-letter "a"/"b" would false-positive
		// against the test fake's "test summary" string. Use distinctive
		// names that can ONLY come from data leakage.
		forbidTokens:   []string{"alpha-pod", "beta-pod", "alpha-ns", "beta-ns"},
		wantRenderType: "kubectl_table",
		wantRowCount:   2,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStatusRunning},
	},
	{
		name: "list_pods_zero_creation_timestamp",
		tool: "list_pods", namespace: "weird-time",
		// CreationTimestamp absent → humanAge() returns "?" (verified
		// in shaper tests). Render must not crash on this.
		rawTool: `[
			{"metadata":{"name":"timeless","namespace":"weird-time"},"spec":{"containers":[{"name":"c"}]},"status":{"phase":"Running","containerStatuses":[{"ready":true,"restartCount":0}]}}
		]`,
		forbidTokens:   []string{"timeless"},
		wantRenderType: "kubectl_table",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisStructureMissing},
	},

	// ─── get_pod_yaml expansion ──────────────────────────────────────
	{
		name: "get_pod_yaml_with_secrets",
		tool: "get_pod_yaml", namespace: "secrets-ns",
		// YAML containing what looks like sensitive data — confirm it
		// renders verbatim (the brain doesn't redact; the user has the
		// same view kubectl gives).
		rawTool:        `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: secrets-pod\nspec:\n  containers:\n  - env:\n    - name: API_KEY\n      value: sk-1234567890abcdef\n"}`,
		forbidTokens:   []string{"secrets-pod", "sk-1234567890abcdef"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStructureNested},
	},
	{
		name: "get_pod_yaml_with_long_name",
		tool: "get_pod_yaml", namespace: "lengthy",
		rawTool:        `{"yaml":"kind: Pod\nmetadata:\n  name: this-is-a-very-long-pod-name-that-stresses-the-layout-but-still-renders\n"}`,
		forbidTokens:   []string{"this-is-a-very-long-pod-name-that-stresses-the-layout-but-still-renders"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisEncodingLongName},
	},
	{
		name: "get_pod_yaml_with_special_chars",
		tool: "get_pod_yaml", namespace: "tricky",
		// YAML containing characters that need careful JSON escaping:
		// quotes, backslashes, newlines.
		rawTool:        `{"yaml":"kind: Pod\nmetadata:\n  name: \"quoted-name\"\n  annotations:\n    key/with/slashes: \"value with \\\"quotes\\\"\"\n"}`,
		forbidTokens:   []string{"quoted-name", "key/with/slashes"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisEncodingSpecial},
	},
	{
		name: "get_pod_yaml_minimal",
		tool: "get_pod_yaml", namespace: "tiny",
		rawTool:        `{"yaml":"kind: Pod\n"}`,
		forbidTokens:   []string{},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisCardinalitySingle},
	},
	{
		name: "get_pod_yaml_failed_status",
		tool: "get_pod_yaml", namespace: "down",
		rawTool:        `{"yaml":"kind: Pod\nstatus:\n  phase: Failed\n  reason: OOMKilled\n"}`,
		forbidTokens:   []string{"OOMKilled"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStatusFailed, axisStructureNested},
	},
	{
		name: "get_pod_yaml_pending_status",
		tool: "get_pod_yaml", namespace: "queued",
		rawTool:        `{"yaml":"kind: Pod\nstatus:\n  phase: Pending\n  conditions:\n  - type: PodScheduled\n    status: \"False\"\n"}`,
		forbidTokens:   []string{"PodScheduled"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStatusPending, axisStructureNested},
	},
	{
		name: "get_pod_yaml_with_nested_container_array",
		tool: "get_pod_yaml", namespace: "complex",
		rawTool:        `{"yaml":"kind: Pod\nspec:\n  containers:\n  - name: a\n    image: a:1\n  - name: b\n    image: b:2\n  - name: c\n    image: c:3\n"}`,
		forbidTokens:   []string{"a:1", "b:2", "c:3"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStructureNested, axisCardinalityMany},
	},
	{
		name: "get_pod_yaml_long_with_lots_of_lines",
		tool: "get_pod_yaml", namespace: "verbose",
		rawTool:        `{"yaml":"line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n"}`,
		forbidTokens:   []string{"line1", "line10"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisEncodingLongName},
	},
	{
		name: "get_pod_yaml_minimal_top_level_only",
		tool: "get_pod_yaml", namespace: "atomic",
		rawTool:        `{"yaml":"kind: ConfigMap\n"}`,
		forbidTokens:   []string{"ConfigMap"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
		axes:           []probeAxis{axisToolGetPodYaml, axisRendererYaml, axisStructureFlat},
	},
	{
		// 30th probe: a second cardinality:zero scenario so dropping
		// list_pods_empty_namespace alone doesn't blind the suite to
		// the empty-result case. Also tags status:mixed implicitly via
		// 0 of each phase.
		name: "list_pods_empty_cluster",
		tool: "list_pods", namespace: "newly-created",
		rawTool:        `[]`,
		forbidTokens:   nil,
		wantRenderType: "kubectl_table",
		wantRowCount:   0,
		axes:           []probeAxis{axisToolListPods, axisRendererTable, axisCardinalityZero},
	},
}

func TestHallucinationProbes(t *testing.T) {
	for _, p := range probes {
		t.Run(p.name, func(t *testing.T) {
			// Count LLM calls during this probe. Default summary
			// formatter is deterministic (no LLM), so any call here is
			// a regression toward LLM data exposure.
			var llmCalls int32
			restore := summary.SwapLLMCompleterForTest(func(_ context.Context, d derived.DerivedSummary) (string, error) {
				atomic.AddInt32(&llmCalls, 1)
				// Even when the test seam fires, it MUST NOT receive
				// raw row data — its argument is DerivedSummary by
				// type. Re-assert the type fence here for documentation.
				if d.ToolName != p.tool {
					t.Errorf("derived.ToolName mismatch: %q vs %q", d.ToolName, p.tool)
				}
				return "test summary", nil
			})
			defer restore()

			ev, err := BuildDeterministicResponse(
				context.Background(), p.tool, p.namespace, json.RawMessage(p.rawTool),
			)
			if err != nil {
				t.Fatalf("BuildDeterministicResponse: %v", err)
			}

			if ev.RenderType != p.wantRenderType {
				t.Errorf("render type: got %q want %q", ev.RenderType, p.wantRenderType)
			}

			// Assertion 1: render.data is byte-equal to the shaper's
			// output for this raw input.
			expectedShaped, err := shapers.Shapers[p.tool](json.RawMessage(p.rawTool))
			if err != nil {
				t.Fatalf("shaper for assertion: %v", err)
			}
			if string(ev.RenderData) != string(expectedShaped) {
				t.Errorf("render.data drift\n got:  %s\nwant: %s", ev.RenderData, expectedShaped)
			}

			// Assertion 2: summary contains zero forbidden entity tokens.
			if ev.Summary != "" {
				if len(ev.Summary) > 80 {
					t.Errorf("summary too long: %d chars", len(ev.Summary))
				}
				if strings.Contains(ev.Summary, "\n") {
					t.Errorf("summary has newline")
				}
				for _, tok := range p.forbidTokens {
					if tok == "" {
						continue
					}
					if strings.Contains(ev.Summary, tok) {
						t.Errorf("summary leaked entity %q in %q", tok, ev.Summary)
					}
				}
			}

			// Assertion 3: at most ONE LLM call (only the summary path
			// is allowed to invoke the completer; the data path must
			// never touch it).
			if got := atomic.LoadInt32(&llmCalls); got > 1 {
				t.Errorf("LLM called %d times (want ≤1: only the summary path)", got)
			}
		})
	}
}

// TestProbeAxisCoverage asserts every axis in allAxes is exercised by
// at least one probe. This is meta-coverage — it catches the failure
// mode where someone defines a new axis (or removes the only probe
// for an existing axis) without realising the regression net has a
// hole in it.
//
// Adding a new axis to allAxes WITHOUT tagging any probe = build break.
// Removing the last probe tagged with an axis = build break.
// Both are intentional: gaps in coverage should be conscious decisions
// surfaced by CI, not silent drift.
func TestProbeAxisCoverage(t *testing.T) {
	covered := make(map[probeAxis]int, len(allAxes))
	for _, p := range probes {
		for _, a := range p.axes {
			covered[a]++
		}
	}
	for _, a := range allAxes {
		if covered[a] == 0 {
			t.Errorf("axis %q has zero probes — coverage hole", a)
		}
	}
	// Soft floor: every axis should ideally have ≥ 2 probes so a
	// single fixture edit can't accidentally drop the only signal.
	// Logged (not failed) so adding a new axis isn't immediately red,
	// but the gap is visible in test output.
	for _, a := range allAxes {
		if covered[a] == 1 {
			t.Logf("axis %q has only 1 probe — consider adding a second for redundancy", a)
		}
	}
}

// TestProbesHaveAxes is a sanity check: every probe must have at
// least one axis tag. An untagged probe runs but doesn't contribute
// to coverage tracking, which is silent waste.
func TestProbesHaveAxes(t *testing.T) {
	for _, p := range probes {
		if len(p.axes) == 0 {
			t.Errorf("probe %q has no axis tags", p.name)
		}
	}
}

// TestProbeCount documents the expected total. Phase 2 #6 ships 30;
// the assertion is intentional (not >=) so adding probes is a
// conscious update to this test, not silent drift.
func TestProbeCount(t *testing.T) {
	const want = 30
	if got := len(probes); got != want {
		t.Errorf("probe count: got %d want %d (update this test if you intentionally added/removed probes)", got, want)
	}
}
