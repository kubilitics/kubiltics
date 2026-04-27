package derived

import (
	"encoding/json"
	"testing"
)

// TestDerivedSummarySchemaIsExhaustive snapshots the JSON shape of
// DerivedSummary. Adding a field requires updating this test, which
// forces code review (the type is the LLM's only allowed input on
// the deterministic path).
func TestDerivedSummarySchemaIsExhaustive(t *testing.T) {
	d := DerivedSummary{
		ToolName:        "list_pods",
		Namespace:       "kube-system",
		RowCount:        13,
		StatusBreakdown: map[string]int{"Running": 12, "Pending": 1},
	}
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	want := `{"tool_name":"list_pods","namespace":"kube-system","row_count":13,"status_breakdown":{"Pending":1,"Running":12}}`
	if string(b) != want {
		t.Fatalf("schema drift\n got:  %s\nwant: %s", b, want)
	}
}
