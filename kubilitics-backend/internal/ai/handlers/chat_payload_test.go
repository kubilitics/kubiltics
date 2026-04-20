package handlers

import (
	"encoding/json"
	"testing"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
)

// The frontend chatStore reads tool_call_id / tool_name / preview at the
// top level of the WS frame payload. When chat.go marshalled the whole
// AssistantEvent proto directly, the oneof wrapped these fields inside
// {Event: {ToolStart: {...}}} and the store saw `undefined` for every
// key — tool_end never matched its tool_start (correlation is by
// tool_call_id), text_delta dropped, and the UI fell through to the
// stuck-spinner finalizer that marks the tool as failed even though
// the brain had streamed a full answer.
//
// This test locks the flat shape so nobody accidentally switches back
// to json.Marshal(ev) and reintroduces the bug.

func TestAssistantEventPayload_ToolStart_IsFlat(t *testing.T) {
	ev := &kotgv1.AssistantEvent{
		AnchorId: "anchor-1",
		Event: &kotgv1.AssistantEvent_ToolStart{
			ToolStart: &kotgv1.ToolStart{
				ToolCallId: "call-xyz",
				ToolName:   "list_resources",
				Preview:    `{"kind":"Namespace"}`,
			},
		},
	}
	p := assistantEventPayload(ev)
	if p["tool_call_id"] != "call-xyz" {
		t.Fatalf("tool_call_id not flat: %v", p)
	}
	if p["tool_name"] != "list_resources" {
		t.Fatalf("tool_name not flat: %v", p)
	}
	if p["preview"] != `{"kind":"Namespace"}` {
		t.Fatalf("preview not flat: %v", p)
	}
	if p["anchor_id"] != "anchor-1" {
		t.Fatalf("anchor_id missing: %v", p)
	}
	// Round-trip through JSON to ensure the wire bytes match.
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]interface{}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["tool_call_id"] != "call-xyz" {
		t.Fatalf("wire-level tool_call_id missing: %s", string(b))
	}
	if _, nested := got["Event"]; nested {
		t.Fatalf("payload must be flat, got nested Event: %s", string(b))
	}
}

func TestAssistantEventPayload_ToolEnd_IsFlat(t *testing.T) {
	ev := &kotgv1.AssistantEvent{
		AnchorId: "anchor-2",
		Event: &kotgv1.AssistantEvent_ToolEnd{
			ToolEnd: &kotgv1.ToolEnd{
				ToolCallId: "call-xyz",
				Ok:         true,
				Preview:    "result-preview",
			},
		},
	}
	p := assistantEventPayload(ev)
	if p["tool_call_id"] != "call-xyz" {
		t.Fatalf("tool_call_id not flat: %v", p)
	}
	if p["ok"] != true {
		t.Fatalf("ok not flat: %v", p)
	}
}

func TestAssistantEventPayload_TextDelta_IsFlat(t *testing.T) {
	ev := &kotgv1.AssistantEvent{
		AnchorId: "anchor-3",
		Event: &kotgv1.AssistantEvent_TextDelta{
			TextDelta: &kotgv1.TextDelta{Text: "hello"},
		},
	}
	p := assistantEventPayload(ev)
	if p["text"] != "hello" {
		t.Fatalf("text not flat: %v", p)
	}
}

func TestAssistantEventPayload_Error_FlatRoot(t *testing.T) {
	// Per protocol.ts, error frames carry {code, message} at the payload
	// root — no anchor_id. The store's error handler does
	// frame.payload.code / frame.payload.message directly.
	ev := &kotgv1.AssistantEvent{
		AnchorId: "ignored-for-errors",
		Event: &kotgv1.AssistantEvent_Error{
			Error: &kotgv1.ErrorEvent{Code: "router_error", Message: "kaboom"},
		},
	}
	p := assistantEventPayload(ev)
	if p["code"] != "router_error" || p["message"] != "kaboom" {
		t.Fatalf("error payload not flat: %v", p)
	}
	if _, ok := p["anchor_id"]; ok {
		t.Fatalf("error payload should omit anchor_id per frontend protocol: %v", p)
	}
}

func TestAssistantEventPayload_Done_FlatTokenCounts(t *testing.T) {
	ev := &kotgv1.AssistantEvent{
		AnchorId: "anchor-d",
		Event: &kotgv1.AssistantEvent_Done{
			Done: &kotgv1.Done{PromptTokens: 120, CompletionTokens: 45},
		},
	}
	p := assistantEventPayload(ev)
	if p["prompt_tokens"].(int32) != 120 || p["completion_tokens"].(int32) != 45 {
		t.Fatalf("done payload not flat: %v", p)
	}
}
