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
