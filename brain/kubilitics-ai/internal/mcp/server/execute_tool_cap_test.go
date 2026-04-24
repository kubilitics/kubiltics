package server

import (
	"encoding/json"
	"strings"
	"testing"
)

// ExecuteTool must never return a JSON blob larger than MaxToolOutputBytes
// to the LLM. This is the single guardrail against every future tool that
// forgets to pre-summarize. Smoke-tests the wrap via capToolOutput directly
// (full dispatcher mocking is covered by the larger server_test.go suite).
func TestExecuteTool_CapsOversizedHandlerOutput(t *testing.T) {
	big := make([]interface{}, 300)
	for i := range big {
		big[i] = map[string]interface{}{
			"metadata": map[string]interface{}{
				"name":        "pod-xyz",
				"annotations": map[string]interface{}{"junk": strings.Repeat("Z", 500)},
			},
		}
	}
	raw := map[string]interface{}{"items": big, "item_count": 300}

	capped := capToolOutput(raw)
	b, _ := json.Marshal(capped)
	max := int(MaxToolOutputBytes)
	budget := max + max/10
	if len(b) > budget {
		t.Fatalf("capToolOutput did not cap payload: %d bytes (limit %d)", len(b), budget)
	}
	m := capped.(map[string]interface{})
	if m["item_count"] != 300 {
		t.Fatalf("item_count must survive truncation so the LLM can still say 'N of M': %v", m["item_count"])
	}
	if m["_truncated"] != true {
		t.Fatalf("caller must know the payload was truncated so it can warn the user")
	}
}
