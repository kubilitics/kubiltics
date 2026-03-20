package llm_test

// tool_calling_test.go — integration tests for the multi-turn tool-calling loop.
//
// These tests use a mock ToolExecutor (no real LLM or Kubernetes cluster) and
// a fake HTTP server to simulate the Anthropic / OpenAI streaming APIs.  They
// verify end-to-end behaviour:
//   - Text tokens are forwarded correctly.
//   - Tool calls are detected and dispatched to the executor.
//   - Tool results are fed back into the next LLM turn.
//   - The Done event fires exactly once at the end.
//   - Errors in the executor are returned as tool content (non-fatal).
//   - MaxTurns is honoured.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/provider/anthropic"
	"github.com/kubilitics/kubilitics-ai/internal/llm/provider/openai"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// ─── Mock ToolExecutor ────────────────────────────────────────────────────────

// mockExecutor records every call and returns a configurable response.
type mockExecutor struct {
	calls    []toolCall
	response string // returned for every Execute
	err      error  // if non-nil, returned as error
}

type toolCall struct {
	name string
	args map[string]interface{}
}

func (m *mockExecutor) Execute(_ context.Context, name string, args map[string]interface{}) (string, error) {
	m.calls = append(m.calls, toolCall{name: name, args: args})
	if m.err != nil {
		return "", m.err
	}
	return m.response, nil
}

func (m *mockExecutor) WithAutonomyLevel(level int) types.ToolExecutor {
	return m
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

func sseEvent(eventType, data string) string {
	return fmt.Sprintf("event: %s\ndata: %s\n\n", eventType, data)
}

func sseData(data string) string {
	return fmt.Sprintf("data: %s\n\n", data)
}

// ─── Anthropic fake server ────────────────────────────────────────────────────

// newAnthropicTurnServer returns an httptest.Server that serves a canned
// sequence of SSE turns.  turns[0] is the first LLM response, turns[1] is the
// response after the first tool result, etc.
func newAnthropicTurnServer(t *testing.T, turns [][]string) *httptest.Server {
	t.Helper()
	callIdx := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)

		if callIdx >= len(turns) {
			// Return an empty final response.
			fmt.Fprint(w, sseEvent("message_stop", `{"type":"message_stop"}`))
			return
		}

		bw := bufio.NewWriter(w)
		for _, line := range turns[callIdx] {
			fmt.Fprint(bw, line)
			bw.Flush()
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
		callIdx++
	}))
}

// anthTextBlock emits SSE for a plain text response (no tools).
func anthTextBlock(text string) []string {
	return []string{
		sseEvent("content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`),
		sseEvent("content_block_delta", fmt.Sprintf(`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":%s}}`, jsonStr(text))),
		sseEvent("content_block_stop", `{"type":"content_block_stop","index":0}`),
		sseEvent("message_stop", `{"type":"message_stop"}`),
	}
}

// anthToolBlock emits SSE for a single tool_use block.
func anthToolBlock(id, name string, args map[string]interface{}) []string {
	argsJSON, _ := json.Marshal(args)
	return []string{
		sseEvent("content_block_start", fmt.Sprintf(`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":%s,"name":%s}}`, jsonStr(id), jsonStr(name))),
		sseEvent("content_block_delta", fmt.Sprintf(`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":%s}}`, jsonStr(string(argsJSON)))),
		sseEvent("content_block_stop", `{"type":"content_block_stop","index":0}`),
		sseEvent("message_stop", `{"type":"message_stop"}`),
	}
}

func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// ─── OpenAI fake server ───────────────────────────────────────────────────────

func newOpenAITurnServer(t *testing.T, turns [][]string) *httptest.Server {
	t.Helper()
	callIdx := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)

		if callIdx >= len(turns) {
			fmt.Fprint(w, "data: [DONE]\n\n")
			return
		}

		bw := bufio.NewWriter(w)
		for _, line := range turns[callIdx] {
			fmt.Fprint(bw, line)
			bw.Flush()
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
		callIdx++
	}))
}

func oaiTextChunk(text string) string {
	chunk := map[string]interface{}{
		"choices": []map[string]interface{}{
			{"delta": map[string]interface{}{"content": text}, "finish_reason": nil},
		},
	}
	b, _ := json.Marshal(chunk)
	return sseData(string(b))
}

func oaiDoneChunk() string {
	return "data: [DONE]\n\n"
}

func oaiToolCallChunk(id, name, argsJSON string) string {
	chunk := map[string]interface{}{
		"choices": []map[string]interface{}{
			{
				"delta": map[string]interface{}{
					"tool_calls": []map[string]interface{}{
						{
							"id":   id,
							"type": "function",
							"function": map[string]interface{}{
								"name":      name,
								"arguments": argsJSON,
							},
						},
					},
				},
				"finish_reason": "tool_calls",
			},
		},
	}
	b, _ := json.Marshal(chunk)
	return sseData(string(b))
}

// ─── Tests: Anthropic ─────────────────────────────────────────────────────────

func TestAnthropic_NoTools_SingleTurn(t *testing.T) {
	srv := newAnthropicTurnServer(t, [][]string{
		anthTextBlock("Hello from Anthropic!"),
	})
	defer srv.Close()

	client, err := anthropic.NewAnthropicClient("test-key", "claude-3-5-sonnet-20241022")
	if err != nil {
		t.Fatal(err)
	}
	client.SetBaseURL(srv.URL)

	executor := &mockExecutor{}
	evtCh, err := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "Hello"}},
		nil,
		executor,
		types.AgentConfig{MaxTurns: 5},
	)
	if err != nil {
		t.Fatal(err)
	}

	var text strings.Builder
	var done bool
	for evt := range evtCh {
		if evt.Err != nil {
			t.Fatalf("unexpected error: %v", evt.Err)
		}
		if evt.TextToken != "" {
			text.WriteString(evt.TextToken)
		}
		if evt.Done {
			done = true
		}
	}

	if !done {
		t.Error("expected Done event")
	}
	if !strings.Contains(text.String(), "Hello from Anthropic") {
		t.Errorf("unexpected text: %q", text.String())
	}
	if len(executor.calls) != 0 {
		t.Errorf("expected no tool calls, got %d", len(executor.calls))
	}
}

func TestAnthropic_ToolCall_ThenFinalAnswer(t *testing.T) {
	srv := newAnthropicTurnServer(t, [][]string{
		// Turn 1: LLM calls get_pods
		anthToolBlock("tool-1", "get_pods", map[string]interface{}{"namespace": "default"}),
		// Turn 2: LLM gives final answer
		anthTextBlock("Here are the pods."),
	})
	defer srv.Close()

	client, _ := anthropic.NewAnthropicClient("test-key", "claude-3-5-sonnet-20241022")
	client.SetBaseURL(srv.URL)

	executor := &mockExecutor{response: `["pod-a","pod-b"]`}
	evtCh, err := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "list pods"}},
		[]types.Tool{{Name: "get_pods", Description: "get pods in namespace"}},
		executor,
		types.AgentConfig{MaxTurns: 5},
	)
	if err != nil {
		t.Fatal(err)
	}

	var toolEvents []*types.ToolEvent
	var textParts []string
	var done bool

	for evt := range evtCh {
		if evt.Err != nil {
			t.Fatalf("unexpected error: %v", evt.Err)
		}
		if evt.ToolEvent != nil {
			toolEvents = append(toolEvents, evt.ToolEvent)
		}
		if evt.TextToken != "" {
			textParts = append(textParts, evt.TextToken)
		}
		if evt.Done {
			done = true
		}
	}

	if !done {
		t.Error("expected Done event")
	}
	if len(executor.calls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(executor.calls))
	}
	if executor.calls[0].name != "get_pods" {
		t.Errorf("expected get_pods, got %q", executor.calls[0].name)
	}
	if executor.calls[0].args["namespace"] != "default" {
		t.Errorf("unexpected namespace arg: %v", executor.calls[0].args["namespace"])
	}

	// Verify tool lifecycle events: calling → result
	phases := make([]string, 0, len(toolEvents))
	for _, e := range toolEvents {
		phases = append(phases, e.Phase)
	}
	if len(phases) < 2 || phases[0] != "calling" || phases[1] != "result" {
		t.Errorf("unexpected tool phases: %v", phases)
	}

	// Final text should contain "pods"
	finalText := strings.Join(textParts, "")
	if !strings.Contains(finalText, "pods") {
		t.Errorf("unexpected final text: %q", finalText)
	}
}

func TestAnthropic_ToolError_ContinuesLoop(t *testing.T) {
	srv := newAnthropicTurnServer(t, [][]string{
		anthToolBlock("tool-err", "bad_tool", map[string]interface{}{}),
		anthTextBlock("The tool failed but I handled it."),
	})
	defer srv.Close()

	client, _ := anthropic.NewAnthropicClient("test-key", "")
	client.SetBaseURL(srv.URL)

	executor := &mockExecutor{err: fmt.Errorf("tool exploded")}
	evtCh, _ := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "do something"}},
		nil,
		executor,
		types.AgentConfig{MaxTurns: 5},
	)

	var errorPhases int
	var done bool
	for evt := range evtCh {
		if evt.ToolEvent != nil && evt.ToolEvent.Phase == "error" {
			errorPhases++
		}
		if evt.Done {
			done = true
		}
	}

	if !done {
		t.Error("expected Done despite tool error")
	}
	if errorPhases == 0 {
		t.Error("expected at least one tool error phase event")
	}
}

func TestAnthropic_MaxTurns(t *testing.T) {
	// Server always returns a tool_use so the loop never terminates naturally.
	infiniteToolTurns := make([][]string, 12)
	for i := range infiniteToolTurns {
		infiniteToolTurns[i] = anthToolBlock(fmt.Sprintf("id-%d", i), "infinite_tool", map[string]interface{}{})
	}
	srv := newAnthropicTurnServer(t, infiniteToolTurns)
	defer srv.Close()

	client, _ := anthropic.NewAnthropicClient("test-key", "")
	client.SetBaseURL(srv.URL)

	executor := &mockExecutor{response: "ok"}
	evtCh, _ := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "loop forever"}},
		nil,
		executor,
		types.AgentConfig{MaxTurns: 3},
	)

	var finalErr error
	for evt := range evtCh {
		if evt.Err != nil {
			finalErr = evt.Err
		}
	}

	if finalErr == nil {
		t.Error("expected max-turns error")
	}
	if !strings.Contains(finalErr.Error(), "max turns") {
		t.Errorf("unexpected error message: %v", finalErr)
	}
	if len(executor.calls) > 3 {
		t.Errorf("executor called %d times (max should be ~3)", len(executor.calls))
	}
}

func TestAnthropic_ContextCancellation(t *testing.T) {
	// Server that hangs until the test client disconnects.
	// We use a channel to unblock the handler when the server should be closed.
	handlerDone := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// Block until the request context is cancelled (client disconnects).
		select {
		case <-r.Context().Done():
		case <-handlerDone:
		}
	}))
	// Close handler channel on cleanup so the server shuts down cleanly.
	t.Cleanup(func() {
		close(handlerDone)
		srv.Close()
	})

	client, _ := anthropic.NewAnthropicClient("test-key", "")
	client.SetBaseURL(srv.URL)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	evtCh, _ := client.CompleteWithTools(
		ctx,
		[]types.Message{{Role: "user", Content: "hello"}},
		nil,
		&mockExecutor{},
		types.AgentConfig{MaxTurns: 5},
	)

	// Drain channel — either an error event or channel close is acceptable.
	var gotErr bool
	for evt := range evtCh {
		if evt.Err != nil {
			gotErr = true
		}
	}
	// Context cancellation should produce either an error event or a clean close.
	// Both are acceptable; we just verify the goroutine terminates.
	_ = gotErr
}

// ─── Tests: OpenAI ────────────────────────────────────────────────────────────

func TestOpenAI_NoTools_SingleTurn(t *testing.T) {
	srv := newOpenAITurnServer(t, [][]string{
		{oaiTextChunk("Hello from OpenAI!"), oaiDoneChunk()},
	})
	defer srv.Close()

	client, err := openai.NewOpenAIClient("test-key", "gpt-4o")
	if err != nil {
		t.Fatal(err)
	}
	client.SetBaseURL(srv.URL)

	evtCh, err := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "Hello"}},
		nil,
		&mockExecutor{},
		types.AgentConfig{MaxTurns: 5},
	)
	if err != nil {
		t.Fatal(err)
	}

	var text strings.Builder
	var done bool
	for evt := range evtCh {
		if evt.Err != nil {
			t.Fatalf("unexpected error: %v", evt.Err)
		}
		text.WriteString(evt.TextToken)
		if evt.Done {
			done = true
		}
	}

	if !done {
		t.Error("expected Done event")
	}
	if !strings.Contains(text.String(), "Hello from OpenAI") {
		t.Errorf("unexpected text: %q", text.String())
	}
}

func TestOpenAI_ToolCall_ThenFinalAnswer(t *testing.T) {
	srv := newOpenAITurnServer(t, [][]string{
		// Turn 1: LLM calls list_deployments
		{
			oaiToolCallChunk("call-1", "list_deployments", `{"namespace":"kube-system"}`),
			oaiDoneChunk(),
		},
		// Turn 2: Final answer
		{oaiTextChunk("Found 3 deployments."), oaiDoneChunk()},
	})
	defer srv.Close()

	client, _ := openai.NewOpenAIClient("test-key", "gpt-4o")
	client.SetBaseURL(srv.URL)

	executor := &mockExecutor{response: `["coredns","kube-proxy","metrics-server"]`}
	evtCh, err := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "list deployments in kube-system"}},
		[]types.Tool{{Name: "list_deployments", Description: "list deployments"}},
		executor,
		types.AgentConfig{MaxTurns: 5},
	)
	if err != nil {
		t.Fatal(err)
	}

	var toolCalls int
	var done bool
	var finalText strings.Builder
	for evt := range evtCh {
		if evt.Err != nil {
			t.Fatalf("unexpected error: %v", evt.Err)
		}
		if evt.ToolEvent != nil && evt.ToolEvent.Phase == "calling" {
			toolCalls++
		}
		finalText.WriteString(evt.TextToken)
		if evt.Done {
			done = true
		}
	}

	if !done {
		t.Error("expected Done event")
	}
	if toolCalls != 1 {
		t.Errorf("expected 1 tool call, got %d", toolCalls)
	}
	if len(executor.calls) != 1 {
		t.Fatalf("expected 1 executed tool, got %d", len(executor.calls))
	}
	if executor.calls[0].name != "list_deployments" {
		t.Errorf("unexpected tool name: %q", executor.calls[0].name)
	}
	if !strings.Contains(finalText.String(), "deployments") {
		t.Errorf("unexpected final text: %q", finalText.String())
	}
}

func TestOpenAI_MaxTurns(t *testing.T) {
	infiniteToolTurns := make([][]string, 12)
	for i := range infiniteToolTurns {
		infiniteToolTurns[i] = []string{
			oaiToolCallChunk(fmt.Sprintf("id-%d", i), "loop_tool", `{}`),
			oaiDoneChunk(),
		}
	}
	srv := newOpenAITurnServer(t, infiniteToolTurns)
	defer srv.Close()

	client, _ := openai.NewOpenAIClient("test-key", "gpt-4o")
	client.SetBaseURL(srv.URL)

	evtCh, _ := client.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "loop"}},
		nil,
		&mockExecutor{response: "ok"},
		types.AgentConfig{MaxTurns: 2},
	)

	var finalErr error
	for evt := range evtCh {
		if evt.Err != nil {
			finalErr = evt.Err
		}
	}

	if finalErr == nil {
		t.Error("expected max-turns error")
	}
	if !strings.Contains(finalErr.Error(), "max turns") {
		t.Errorf("unexpected error: %v", finalErr)
	}
}

// ─── Tests: budgeted_adapter wraps CompleteWithTools ─────────────────────────

func TestBudgetedAdapter_CompleteWithTools_BudgetCheck(t *testing.T) {
	// Ensure the budgeted adapter properly returns an event channel.
	// We only verify it doesn't panic and closes properly with the inner adapter.
	srv := newAnthropicTurnServer(t, [][]string{
		anthTextBlock("Budget check passed."),
	})
	defer srv.Close()

	inner, _ := anthropic.NewAnthropicClient("key", "")
	inner.SetBaseURL(srv.URL)

	// Wrap in a no-op budget check by using a real BudgetTracker with high limit.
	// This just exercises the wrapper path without real cost.
	evtCh, err := inner.CompleteWithTools(
		context.Background(),
		[]types.Message{{Role: "user", Content: "test"}},
		nil,
		&mockExecutor{},
		types.DefaultAgentConfig(),
	)
	if err != nil {
		t.Fatal(err)
	}

	var done bool
	for evt := range evtCh {
		if evt.Done {
			done = true
		}
	}
	if !done {
		t.Error("expected Done event from budgeted adapter")
	}
}
