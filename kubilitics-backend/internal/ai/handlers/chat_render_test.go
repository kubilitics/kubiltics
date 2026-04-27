package handlers

import (
	"bytes"
	"encoding/json"
	"testing"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// TestAssistantEventPayload_RenderBlockByteEqualData enforces the
// backend opacity guarantee: render.data MUST flow from the brain to
// the WebSocket frame byte-equal. The backend never unmarshals or
// mutates the bytes — they belong to the brain's shaper.
func TestAssistantEventPayload_RenderBlockByteEqualData(t *testing.T) {
	weird := []byte(`{"weird":" bytes","nested":{"a":1},"newline":"x\nbreak","emoji":"ÿ"}`)
	ev := &kotgv1.AssistantEvent{
		AnchorId: "anchor-x",
		Event: &kotgv1.AssistantEvent_RenderBlock{
			RenderBlock: &kotgv1.RenderBlock{
				Type:    "kubectl_table",
				Data:    weird,
				Summary: "13 pods (12 Running, 1 Pending)",
			},
		},
	}
	p := assistantEventPayload(ev)
	out, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	var got struct {
		AnchorId string `json:"anchor_id"`
		Render   struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		} `json:"render"`
		Summary string `json:"summary"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("unmarshal: %v\npayload: %s", err, out)
	}
	if got.Render.Type != "kubectl_table" {
		t.Errorf("type: %q", got.Render.Type)
	}
	if !bytes.Equal(got.Render.Data, weird) {
		t.Errorf("data drift\n got: %s\nwant: %s", got.Render.Data, weird)
	}
	if got.Summary != "13 pods (12 Running, 1 Pending)" {
		t.Errorf("summary drift: %q", got.Summary)
	}
	if got.AnchorId != "anchor-x" {
		t.Errorf("anchor lost: %q", got.AnchorId)
	}
}

func TestAssistantEventType_RenderBlockReturnsRenderBlock(t *testing.T) {
	ev := &kotgv1.AssistantEvent{
		Event: &kotgv1.AssistantEvent_RenderBlock{
			RenderBlock: &kotgv1.RenderBlock{Type: "yaml_block"},
		},
	}
	if got := assistantEventType(ev); got != "render_block" {
		t.Errorf("type tag: got %q want render_block", got)
	}
}
