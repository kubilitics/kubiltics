package render

import (
	"testing"

	shapers "github.com/vellankikoti/kubilitics/brain/internal/render/shapers"
)

func TestLookupReturnsSafeDefault(t *testing.T) {
	b := Lookup("totally_unknown_tool")
	if b.Class != Analytical {
		t.Fatalf("unknown tool default class: got %q want %q", b.Class, Analytical)
	}
	if b.Render != RenderText {
		t.Fatalf("unknown tool default render: got %q want %q", b.Render, RenderText)
	}
}

func TestRegistryHasPhase1Tools(t *testing.T) {
	for _, name := range []string{"list_pods", "get_pod_yaml"} {
		b := Lookup(name)
		if b.Class != Deterministic {
			t.Errorf("%s should be Deterministic, got %q", name, b.Class)
		}
	}
}

func TestEveryDeterministicToolHasNonTextRenderer(t *testing.T) {
	for name, b := range registry {
		if b.Class == Deterministic && b.Render == RenderText {
			t.Errorf("deterministic tool %s declared RenderText (must declare a structured renderer)", name)
		}
	}
}

func TestDeterministicToolsHaveShapers(t *testing.T) {
	for name, b := range registry {
		if b.Class != Deterministic { continue }
		if _, ok := shapers.Shapers[name]; !ok {
			t.Errorf("deterministic tool %s has no shaper in shapers.Shapers", name)
		}
	}
}

// TestRegistryHasInspectFamily pins the Phase 2 #3 expansion so future
// edits can't accidentally drop coverage. Every inspect_<kind> entry
// must be Deterministic with a YAML renderer (the rich detail blob the
// inspect_* tools return is rendered as YAML for legibility).
func TestRegistryHasInspectFamily(t *testing.T) {
	mustInspect := []string{
		"inspect_pod", "inspect_deployment", "inspect_replicaset",
		"inspect_statefulset", "inspect_daemonset", "inspect_job",
		"inspect_cronjob", "inspect_node", "inspect_namespace",
		"inspect_crd", "inspect_service", "inspect_ingress",
		"inspect_networkpolicy", "inspect_pvc", "inspect_pv",
		"inspect_storageclass", "inspect_configmap", "inspect_secret",
		"inspect_role", "inspect_rolebinding", "inspect_clusterrole",
		"inspect_clusterrolebinding", "inspect_limitrange",
		"inspect_resourcequota", "inspect_hpa", "inspect_vpa", "inspect_pdb",
	}
	for _, name := range mustInspect {
		b := Lookup(name)
		if b.Class != Deterministic {
			t.Errorf("%s must be Deterministic, got %q", name, b.Class)
		}
		if b.Render != RenderYAMLBlock {
			t.Errorf("%s must render as %q, got %q", name, RenderYAMLBlock, b.Render)
		}
	}
}
