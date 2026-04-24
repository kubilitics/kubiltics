package main

// judge_test.go — tests judge HTTP client against a mocked chat-completions
// endpoint.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func mockOpenAIServer(t *testing.T, content string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/v1/chat/completions") {
			http.Error(w, "unexpected path: "+r.URL.Path, http.StatusNotFound)
			return
		}
		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{"message": map[string]interface{}{"role": "assistant", "content": content}},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestJudge_ScoreParsesCleanJSON(t *testing.T) {
	content := `{"factual": 5, "completeness": 4, "clarity": 5, "tool_use": 4, "critique": "Accurate and well-scoped."}`
	srv := mockOpenAIServer(t, content)
	j := NewJudge(JudgeConfig{BaseURL: srv.URL, Model: "test", Timeout: 2 * time.Second})
	res := j.Score(context.Background(), "What broke?", []string{"observe_events"}, "A pod OOMKilled.")
	if res.Err != nil {
		t.Fatalf("unexpected err: %v", res.Err)
	}
	if res.Factual != 5 || res.ToolUse != 4 {
		t.Errorf("parse: %+v", res)
	}
	if got := res.Mean(); got < 4.0 || got > 5.0 {
		t.Errorf("mean: got %.2f", got)
	}
}

func TestJudge_ScoreToleratesCodeFence(t *testing.T) {
	content := "```json\n{\"factual\": 3, \"completeness\": 3, \"clarity\": 3, \"tool_use\": 3, \"critique\": \"ok\"}\n```"
	srv := mockOpenAIServer(t, content)
	j := NewJudge(JudgeConfig{BaseURL: srv.URL, Model: "test"})
	res := j.Score(context.Background(), "q", nil, "a")
	if res.Err != nil {
		t.Fatalf("fenced: %v", res.Err)
	}
	if res.Factual != 3 {
		t.Errorf("parse fenced: %+v", res)
	}
}

func TestJudge_ScoreToleratesNarrationAround(t *testing.T) {
	content := `Here is my score:
{"factual": 2, "completeness": 4, "clarity": 3, "tool_use": 2, "critique": "Hedged."}
That's my final answer.`
	srv := mockOpenAIServer(t, content)
	j := NewJudge(JudgeConfig{BaseURL: srv.URL, Model: "test"})
	res := j.Score(context.Background(), "q", nil, "a")
	if res.Err != nil {
		t.Fatalf("narration: %v (raw=%q)", res.Err, res.Raw)
	}
	if res.Factual != 2 || res.Completeness != 4 {
		t.Errorf("parse narration: %+v", res)
	}
}

func TestJudge_ScoreRejectsOutOfRange(t *testing.T) {
	content := `{"factual": 7, "completeness": 3, "clarity": 3, "tool_use": 3, "critique": "bad"}`
	srv := mockOpenAIServer(t, content)
	j := NewJudge(JudgeConfig{BaseURL: srv.URL, Model: "test"})
	res := j.Score(context.Background(), "q", nil, "a")
	if res.Err == nil {
		t.Fatalf("expected out-of-range error; got %+v", res)
	}
}

func TestJudge_ScoreSendsAuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"content":"{\"factual\":5,\"completeness\":5,\"clarity\":5,\"tool_use\":5,\"critique\":\"ok\"}"}}]}`)
	}))
	defer srv.Close()
	j := NewJudge(JudgeConfig{BaseURL: srv.URL, Model: "test", APIKey: "sk-abc"})
	_ = j.Score(context.Background(), "q", nil, "a")
	if gotAuth != "Bearer sk-abc" {
		t.Errorf("auth: got %q", gotAuth)
	}
}
