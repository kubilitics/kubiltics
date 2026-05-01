package render

import (
	"encoding/json"
	"testing"
)

func TestDeriveListPods_StatusBreakdown(t *testing.T) {
	// Namespace is derived from single_namespace in shaped data, not from
	// the passed namespace arg. When single_namespace is present, it wins.
	shaped := []byte(`{"columns":[],"rows":[
		{"NAME":"a","STATUS":"Running"},
		{"NAME":"b","STATUS":"Running"},
		{"NAME":"c","STATUS":"Pending"}
	],"single_namespace":"kube-system"}`)
	d, err := derive("list_pods", "kube-system", shaped)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if d.RowCount != 3 {
		t.Errorf("RowCount: got %d want 3", d.RowCount)
	}
	if d.Namespace != "kube-system" {
		t.Errorf("Namespace: got %q want kube-system", d.Namespace)
	}
	if d.StatusBreakdown["Running"] != 2 || d.StatusBreakdown["Pending"] != 1 {
		t.Errorf("StatusBreakdown: got %v", d.StatusBreakdown)
	}
}

func TestDeriveListResources_MultiNamespace_NoLabel(t *testing.T) {
	// When rows span multiple namespaces, single_namespace is absent and
	// Namespace must be "" regardless of the ns arg — prevents mislabels
	// like "15 pods in default" when the result spans all namespaces.
	shaped := []byte(`{"columns":[],"rows":[
		{"NAME":"a","NAMESPACE":"default","STATUS":"Running"},
		{"NAME":"b","NAMESPACE":"kube-system","STATUS":"Running"}
	]}`)
	d, err := derive("list_resources", "default", shaped)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if d.Namespace != "" {
		t.Errorf("Namespace: got %q want empty (multi-namespace result)", d.Namespace)
	}
	if d.RowCount != 2 {
		t.Errorf("RowCount: got %d want 2", d.RowCount)
	}
}

// Phase 2 #3: every inspect_<kind> tool counts as a single resource
// per call. The prefix-match branch in derive() makes this generic
// for all 27 inspect_* tools without per-name boilerplate.
func TestDeriveInspectFamily_SingleDoc(t *testing.T) {
	shaped, _ := json.Marshal(map[string]string{"yaml": "irrelevant"})
	for _, name := range []string{
		"inspect_pod", "inspect_deployment", "inspect_node",
		"inspect_namespace", "inspect_pvc", "inspect_clusterrole",
		"inspect_hpa",
	} {
		d, err := derive(name, "kube-system", shaped)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if d.RowCount != 1 {
			t.Errorf("%s RowCount: got %d want 1", name, d.RowCount)
		}
	}
}

func TestDeriveGetPodYaml_NoBreakdown(t *testing.T) {
	shaped, _ := json.Marshal(map[string]string{"yaml": "kind: Pod"})
	d, err := derive("get_pod_yaml", "kube-system", shaped)
	if err != nil {
		t.Fatalf("derive: %v", err)
	}
	if d.RowCount != 1 {
		t.Errorf("RowCount: got %d want 1", d.RowCount)
	}
	if len(d.StatusBreakdown) != 0 {
		t.Errorf("StatusBreakdown should be empty")
	}
}
