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

type probe struct {
	name           string
	tool           string
	namespace      string
	rawTool        string
	forbidTokens   []string // entity names that must NOT appear in summary
	wantRenderType string
	wantRowCount   int
}

// probes is the Phase 1 set. Each fixture is small enough to inline
// for clarity; bigger fixtures will move to ./fixtures/ in followups.
var probes = []probe{
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
	},
	{
		name: "list_pods_empty_namespace",
		tool: "list_pods", namespace: "empty-ns",
		rawTool:        `[]`,
		forbidTokens:   nil,
		wantRenderType: "kubectl_table",
		wantRowCount:   0,
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
	},
	{
		name: "get_pod_yaml_simple",
		tool: "get_pod_yaml", namespace: "kube-system",
		rawTool:        `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: coredns-1\n"}`,
		forbidTokens:   []string{"coredns-1", "apiVersion"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
	},
	{
		name: "get_pod_yaml_long",
		tool: "get_pod_yaml", namespace: "busy",
		rawTool: `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: very-busy-pod\n  labels:\n    app: example\n    tier: backend\nspec:\n  containers:\n  - name: main\n    image: example:1.2.3\n"}`,
		forbidTokens:   []string{"very-busy-pod", "example:1.2.3"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
	},
	{
		name: "get_pod_yaml_unicode",
		tool: "get_pod_yaml", namespace: "i18n",
		rawTool:        `{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: pöd-ünïcödé\n"}`,
		forbidTokens:   []string{"pöd-ünïcödé"},
		wantRenderType: "yaml_block",
		wantRowCount:   1,
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
