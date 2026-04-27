package render

import (
	"encoding/json"
	"testing"
)

func TestDeriveListPods_StatusBreakdown(t *testing.T) {
	shaped := []byte(`{"columns":[],"rows":[
		{"NAME":"a","STATUS":"Running"},
		{"NAME":"b","STATUS":"Running"},
		{"NAME":"c","STATUS":"Pending"}
	]}`)
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
