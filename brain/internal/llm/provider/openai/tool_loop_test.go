package openai

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestOAIMessageMarshal_AssistantWithToolCallsAlwaysEmitsContent locks in the
// fix for the "content: null" 400 response. When an assistant turn carries
// tool_calls and no preamble text, the previous `omitempty` tag dropped the
// content key entirely; OpenAI then rejected the next turn's request with
// "expected a string, got null".
func TestOAIMessageMarshal_AssistantWithToolCallsAlwaysEmitsContent(t *testing.T) {
	msg := oaiMessage{
		Role:    "assistant",
		Content: "", // intentionally empty — common when LLM emits only tool_calls
		ToolCalls: []oaiToolCall{
			{ID: "call_1", Type: "function", Function: oaiToolFunction{Name: "list_pods", Arguments: "{}"}},
		},
	}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	if !strings.Contains(got, `"content":""`) {
		t.Fatalf("assistant tool-call message must serialise content as empty string, got: %s", got)
	}
	if strings.Contains(got, `"content":null`) {
		t.Fatalf("assistant content must never be null, got: %s", got)
	}
}

// TestOAIMessageMarshal_ToolMessageAlwaysEmitsContent — same invariant for
// the tool-result reply that follows a failing tool execution.
func TestOAIMessageMarshal_ToolMessageAlwaysEmitsContent(t *testing.T) {
	msg := oaiMessage{
		Role:       "tool",
		Content:    "", // empty result string from a tool that errored
		ToolCallID: "call_1",
	}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	if !strings.Contains(got, `"content":""`) {
		t.Fatalf("tool message must serialise content as empty string, got: %s", got)
	}
	if !strings.Contains(got, `"tool_call_id":"call_1"`) {
		t.Fatalf("tool_call_id missing: %s", got)
	}
}

// TestOAIMessageMarshal_UserSystemPreserveOmitEmpty — user/system messages
// keep the legacy omit-when-empty shape so we don't change request size for
// the normal path.
func TestOAIMessageMarshal_UserSystemPreserveOmitEmpty(t *testing.T) {
	msg := oaiMessage{Role: "user", Content: ""}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	if strings.Contains(got, `"content"`) {
		t.Fatalf("user message with empty content should omit the key, got: %s", got)
	}
}

// TestOAIMessageMarshal_AssistantWithText keeps round-trip parity for the
// happy path — non-empty text serialises identically to the previous shape.
func TestOAIMessageMarshal_AssistantWithText(t *testing.T) {
	msg := oaiMessage{Role: "assistant", Content: "hello"}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	if !strings.Contains(got, `"content":"hello"`) {
		t.Fatalf("assistant content not serialised: %s", got)
	}
}
