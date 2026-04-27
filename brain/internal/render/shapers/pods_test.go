package shapers

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestShapeListPods_FixtureKubeSystem(t *testing.T) {
	raw, err := os.ReadFile("fixtures/list_pods_kube_system.json")
	if err != nil { t.Fatalf("read fixture: %v", err) }

	out, err := ShapeListPods(raw)
	if err != nil { t.Fatalf("ShapeListPods: %v", err) }

	var shaped struct {
		Columns []map[string]string      `json:"columns"`
		Rows    []map[string]interface{} `json:"rows"`
	}
	if err := json.Unmarshal(out, &shaped); err != nil {
		t.Fatalf("unmarshal shaped: %v", err)
	}

	wantCols := []string{"NAME", "READY", "STATUS", "RESTARTS", "AGE"}
	if len(shaped.Columns) != len(wantCols) {
		t.Fatalf("columns count: got %d want %d", len(shaped.Columns), len(wantCols))
	}
	for i, c := range wantCols {
		if shaped.Columns[i]["key"] != c {
			t.Errorf("column %d: got %q want %q", i, shaped.Columns[i]["key"], c)
		}
	}
	if len(shaped.Rows) != 3 {
		t.Fatalf("rows: got %d want 3", len(shaped.Rows))
	}
	if shaped.Rows[1]["RESTARTS"] != float64(2) {
		t.Errorf("row 1 RESTARTS: got %v want 2", shaped.Rows[1]["RESTARTS"])
	}
	if shaped.Rows[2]["STATUS"] != "Pending" {
		t.Errorf("row 2 STATUS: got %v want Pending", shaped.Rows[2]["STATUS"])
	}
}

func TestShapeListPods_Empty(t *testing.T) {
	out, err := ShapeListPods([]byte(`[]`))
	if err != nil { t.Fatalf("ShapeListPods: %v", err) }
	var shaped struct {
		Rows []any `json:"rows"`
	}
	_ = json.Unmarshal(out, &shaped)
	if len(shaped.Rows) != 0 {
		t.Errorf("rows on empty: got %d want 0", len(shaped.Rows))
	}
}

func TestShapeListPods_MalformedJSON(t *testing.T) {
	_, err := ShapeListPods([]byte(`{not json`))
	if err == nil {
		t.Fatalf("expected error on malformed JSON")
	}
}

func TestShapeGetPodYaml_FixtureCoredns(t *testing.T) {
	raw := []byte(`{"yaml":"apiVersion: v1\nkind: Pod\nmetadata:\n  name: coredns-1\n"}`)
	out, err := ShapeGetPodYaml(raw)
	if err != nil { t.Fatalf("ShapeGetPodYaml: %v", err) }
	var shaped struct{ Yaml string `json:"yaml"` }
	_ = json.Unmarshal(out, &shaped)
	if shaped.Yaml == "" {
		t.Fatal("yaml empty")
	}
}

func TestHumanAge_FutureTimestampReturnsQuestionMark(t *testing.T) {
	future := time.Now().Add(1 * time.Hour)
	if got := humanAge(future); got != "?" {
		t.Errorf("future timestamp: got %q want ?", got)
	}
}

func TestShapersMapHasAllPhase1Tools(t *testing.T) {
	for _, name := range []string{"list_pods", "get_pod_yaml"} {
		if _, ok := Shapers[name]; !ok {
			t.Errorf("missing shaper for %s", name)
		}
	}
}
