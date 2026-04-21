// chat-quality-bench — end-to-end chat quality benchmark.
//
// For each prompt in prompts.json, open a WS chat session against a
// running backend + brain, send the prompt, and assert:
//  1. The assistant produced at least one non-empty text_delta (i.e.
//     actually wrote an answer, not just emitted silence).
//  2. If expect_tool is true, at least one tool_start fired.
//
// Prints PASS/FAIL per prompt and writes a JUnit XML to --out so CI
// can ingest the results directly. Exits non-zero if any prompt
// failed.
//
// Flags:
//
//	-backend   Backend HTTP base (default http://localhost:8190)
//	-cluster   Cluster ID to use (required)
//	-prompts   Path to prompts JSON (default ./prompts.json)
//	-out       JUnit XML output path (default ./chat_quality_results.xml)
//	-timeout   Per-prompt timeout (default 60s)
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type promptSpec struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	ExpectTool bool   `json:"expect_tool"`
}

type promptFile struct {
	Prompts []promptSpec `json:"prompts"`
}

type result struct {
	Prompt   promptSpec
	Text     string
	Tools    []string
	Duration time.Duration
	Err      error
}

func (r result) Pass() bool {
	if r.Err != nil {
		return false
	}
	if strings.TrimSpace(r.Text) == "" {
		return false
	}
	if r.Prompt.ExpectTool && len(r.Tools) == 0 {
		return false
	}
	return true
}

func main() {
	backend := flag.String("backend", "http://localhost:8190", "backend HTTP base URL")
	cluster := flag.String("cluster", "", "cluster ID (required)")
	prompts := flag.String("prompts", "cmd/chat-quality-bench/prompts.json", "prompts JSON path")
	out := flag.String("out", "chat_quality_results.xml", "JUnit XML output path")
	timeout := flag.Duration("timeout", 60*time.Second, "per-prompt timeout")
	flag.Parse()
	if *cluster == "" {
		log.Fatal("--cluster is required")
	}

	body, err := os.ReadFile(*prompts)
	if err != nil {
		log.Fatalf("read prompts: %v", err)
	}
	var pf promptFile
	if err := json.Unmarshal(body, &pf); err != nil {
		log.Fatalf("parse prompts: %v", err)
	}

	results := make([]result, 0, len(pf.Prompts))
	pass := 0
	for _, p := range pf.Prompts {
		r := runPrompt(*backend, *cluster, p, *timeout)
		results = append(results, r)
		status := "FAIL"
		if r.Pass() {
			status = "PASS"
			pass++
		}
		errStr := ""
		if r.Err != nil {
			errStr = "  err=" + r.Err.Error()
		}
		fmt.Printf("%s  %-28s  tools=%d  %5dms  text=%d%s\n",
			status, p.ID, len(r.Tools), r.Duration.Milliseconds(), len(r.Text), errStr)
	}

	fmt.Printf("\n%d / %d passed (%.0f%%)\n",
		pass, len(results), 100*float64(pass)/float64(len(results)))
	if err := writeJUnit(*out, results); err != nil {
		log.Fatalf("write junit: %v", err)
	}
	if pass != len(results) {
		os.Exit(1)
	}
}

func runPrompt(backend, cluster string, p promptSpec, timeout time.Duration) result {
	start := time.Now()
	r := result{Prompt: p}
	defer func() { r.Duration = time.Since(start) }()

	// Create session.
	sessBody, _ := json.Marshal(map[string]string{"focus_cluster_id": cluster, "title": "bench-" + p.ID})
	resp, err := http.Post(backend+"/api/v1/ai/sessions", "application/json", bytes.NewReader(sessBody))
	if err != nil {
		r.Err = fmt.Errorf("create session: %w", err)
		return r
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		r.Err = fmt.Errorf("create session: %d %s", resp.StatusCode, string(b))
		return r
	}
	var sessResp struct {
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sessResp); err != nil {
		r.Err = fmt.Errorf("decode session: %w", err)
		return r
	}

	// Connect WS.
	wsURL := strings.Replace(backend, "http", "ws", 1) + "/api/v1/ai/chat?cluster_id=" + url.QueryEscape(cluster)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		r.Err = fmt.Errorf("dial ws: %w", err)
		return r
	}
	defer conn.Close()

	frame := map[string]interface{}{
		"type": "user_message",
		"payload": map[string]string{
			"text":       p.Text,
			"session_id": sessResp.SessionID,
			"turn_id":    "bench-" + p.ID,
		},
	}
	if err := conn.WriteJSON(frame); err != nil {
		r.Err = fmt.Errorf("send prompt: %w", err)
		return r
	}

	// Drain.
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_ = conn.SetReadDeadline(time.Now().Add(timeout))
			_, data, err := conn.ReadMessage()
			if err != nil {
				if ctx.Err() == nil {
					r.Err = err
				}
				return
			}
			var f struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(data, &f); err != nil {
				continue
			}
			switch f.Type {
			case "text_delta":
				var pl struct {
					Text string `json:"text"`
				}
				_ = json.Unmarshal(f.Payload, &pl)
				r.Text += pl.Text
			case "tool_start":
				var pl struct {
					Name string `json:"tool_name"`
				}
				_ = json.Unmarshal(f.Payload, &pl)
				r.Tools = append(r.Tools, pl.Name)
			case "done":
				return
			case "error":
				var pl struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				}
				_ = json.Unmarshal(f.Payload, &pl)
				r.Err = fmt.Errorf("%s: %s", pl.Code, pl.Message)
				return
			}
		}
	}()
	select {
	case <-done:
	case <-ctx.Done():
		r.Err = fmt.Errorf("timeout after %s", timeout)
	}
	return r
}

// JUnit XML — minimal shape that mikepenz/action-junit-report and
// actions/test-reporter both consume without extra config.

type junitTestSuite struct {
	XMLName  xml.Name        `xml:"testsuite"`
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Cases    []junitTestCase `xml:"testcase"`
}
type junitTestCase struct {
	XMLName xml.Name      `xml:"testcase"`
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitFailure `xml:"failure,omitempty"`
}
type junitFailure struct {
	XMLName xml.Name `xml:"failure"`
	Message string   `xml:"message,attr"`
	Body    string   `xml:",chardata"`
}

func writeJUnit(path string, rs []result) error {
	suite := junitTestSuite{Name: "chat-quality", Tests: len(rs)}
	for _, r := range rs {
		tc := junitTestCase{Name: r.Prompt.ID, Time: r.Duration.Seconds()}
		if !r.Pass() {
			suite.Failures++
			msg := "empty text answer"
			if r.Err != nil {
				msg = r.Err.Error()
			} else if r.Prompt.ExpectTool && len(r.Tools) == 0 {
				msg = "expected a tool call, none fired"
			}
			body := fmt.Sprintf("prompt=%q tools=%v text_len=%d", r.Prompt.Text, r.Tools, len(r.Text))
			tc.Failure = &junitFailure{Message: msg, Body: body}
		}
		suite.Cases = append(suite.Cases, tc)
	}
	blob, err := xml.MarshalIndent(suite, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, blob, 0o644)
}
