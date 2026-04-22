package main

// judge.go — LLM-as-judge for bench answers. Self-contained HTTP client
// that talks to any OpenAI-compatible /v1/chat/completions endpoint
// (OpenAI, Anthropic via compatibility proxy, Ollama, Together, Groq).
//
// The judge gets (question, toolSequence, finalAnswer) and returns four
// integer scores 1-5 plus a one-sentence critique. See judge_rubric.md.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// JudgeResult is one row of the judge output.
type JudgeResult struct {
	Factual      int    `json:"factual"`
	Completeness int    `json:"completeness"`
	Clarity      int    `json:"clarity"`
	ToolUse      int    `json:"tool_use"`
	Critique     string `json:"critique"`
	Raw          string `json:"-"` // unparsed response, kept for debugging
	Err          error  `json:"-"`
}

// Mean returns the arithmetic mean of the four axis scores (0 if all zero).
func (j JudgeResult) Mean() float64 {
	sum := j.Factual + j.Completeness + j.Clarity + j.ToolUse
	if sum == 0 {
		return 0
	}
	return float64(sum) / 4.0
}

// JudgeConfig configures the judge HTTP client.
type JudgeConfig struct {
	BaseURL string // e.g. https://api.openai.com or http://localhost:11434
	APIKey  string // optional for local providers
	Model   string // e.g. gpt-4o-mini
	Timeout time.Duration
}

// Judge wraps the HTTP client + rubric.
type Judge struct {
	cfg        JudgeConfig
	httpClient *http.Client
}

// NewJudge builds a Judge with sane defaults.
func NewJudge(cfg JudgeConfig) *Judge {
	if cfg.Timeout == 0 {
		cfg.Timeout = 60 * time.Second
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com"
	}
	return &Judge{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: cfg.Timeout},
	}
}

const rubric = `You are a strict reviewer scoring an assistant's answer to a Kubernetes operations question.

Score each of the four axes from 1 (worst) to 5 (best):
- factual: are the claims supported by the tool calls and results?
- completeness: is every part of the question actually answered?
- clarity: is the answer precise, well-organized, right level of jargon?
- tool_use: were the right tools called with right parameters, minimal redundancy?

Respond with ONE JSON object and nothing else:
{"factual": N, "completeness": N, "clarity": N, "tool_use": N, "critique": "<one sentence>"}`

// Score calls the judge LLM and returns a parsed JudgeResult. A malformed
// response is surfaced via Err so the bench can still record PASS/FAIL.
func (j *Judge) Score(ctx context.Context, question string, toolSequence []string, finalAnswer string) JudgeResult {
	userMsg := fmt.Sprintf(
		"QUESTION:\n%s\n\nTOOLS_CALLED:\n%s\n\nANSWER:\n%s\n\nScore this answer using the rubric above.",
		strings.TrimSpace(question),
		strings.Join(toolSequence, ", "),
		strings.TrimSpace(finalAnswer),
	)
	body := map[string]interface{}{
		"model": j.cfg.Model,
		"messages": []map[string]string{
			{"role": "system", "content": rubric},
			{"role": "user", "content": userMsg},
		},
		"temperature": 0,
	}
	return j.callChat(ctx, body)
}

func (j *Judge) callChat(ctx context.Context, body map[string]interface{}) JudgeResult {
	var r JudgeResult
	payload, err := json.Marshal(body)
	if err != nil {
		r.Err = fmt.Errorf("marshal: %w", err)
		return r
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimSuffix(j.cfg.BaseURL, "/")+"/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		r.Err = err
		return r
	}
	req.Header.Set("Content-Type", "application/json")
	if j.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+j.cfg.APIKey)
	}
	resp, err := j.httpClient.Do(req)
	if err != nil {
		r.Err = err
		return r
	}
	defer resp.Body.Close()
	var respEnv struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&respEnv); err != nil {
		r.Err = fmt.Errorf("decode: %w", err)
		return r
	}
	if len(respEnv.Choices) == 0 {
		r.Err = fmt.Errorf("no choices: %s", respEnv.Error.Message)
		return r
	}
	r.Raw = respEnv.Choices[0].Message.Content
	parsed, perr := parseJudgeJSON(r.Raw)
	if perr != nil {
		r.Err = perr
		return r
	}
	r.Factual = parsed.Factual
	r.Completeness = parsed.Completeness
	r.Clarity = parsed.Clarity
	r.ToolUse = parsed.ToolUse
	r.Critique = parsed.Critique
	return r
}

// parseJudgeJSON extracts the JSON object from the model response. Models
// sometimes wrap JSON in ```json fences despite the rubric asking them not
// to; tolerate that case.
func parseJudgeJSON(raw string) (JudgeResult, error) {
	var out JudgeResult
	body := strings.TrimSpace(raw)
	// Strip fenced code blocks if present.
	if strings.HasPrefix(body, "```") {
		body = strings.TrimPrefix(body, "```json")
		body = strings.TrimPrefix(body, "```")
		body = strings.TrimSuffix(body, "```")
		body = strings.TrimSpace(body)
	}
	// Extract the first {...} if the model added narration.
	if !strings.HasPrefix(body, "{") {
		re := regexp.MustCompile(`\{[^{}]*"factual"[\s\S]*?\}`)
		if m := re.FindString(body); m != "" {
			body = m
		}
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		return out, fmt.Errorf("parse judge JSON: %w (raw=%q)", err, raw)
	}
	for _, v := range []int{out.Factual, out.Completeness, out.Clarity, out.ToolUse} {
		if v < 1 || v > 5 {
			return out, fmt.Errorf("score out of range 1..5: %+v", out)
		}
	}
	return out, nil
}
