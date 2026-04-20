// Bench is a wide-event benchmarking harness for the kubilitics-ai brain.
//
// One row per LLM call. Every dimension queryable. Same shape as the audit
// pipeline in internal/audit/types.go so production traffic and bench traffic
// converge under one observability-2.0 schema.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"sort"
	"time"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"gopkg.in/yaml.v3"
)

// schemaVersion of the wide event format. Bump if fields are removed/renamed.
const schemaVersion = 1

type promptDef struct {
	ID       string `yaml:"id"`
	Category string `yaml:"category"`
	Text     string `yaml:"text"`
}

type promptFile struct {
	Version int         `yaml:"version"`
	Prompts []promptDef `yaml:"prompts"`
}

// wideEvent is the per-iteration row appended to the NDJSON output.
// Flat top-level fields stay queryable; new keys go in Attributes.
type wideEvent struct {
	SchemaVersion      int                    `json:"schema_version"`
	TS                 string                 `json:"ts"`
	CorrelationID      string                 `json:"correlation_id"`
	EventType          string                 `json:"event_type"`
	Result             string                 `json:"result"`
	Tag                string                 `json:"tag"`
	Provider           string                 `json:"provider"`
	Model              string                 `json:"model"`
	AIVersion          string                 `json:"ai_version"`
	ClusterID          string                 `json:"cluster_id"`
	PromptID           string                 `json:"prompt_id"`
	PromptCategory     string                 `json:"prompt_category"`
	Iteration          int                    `json:"iteration"`
	TTFTMs             int64                  `json:"ttft_ms"`
	TotalMs            int64                  `json:"total_ms"`
	Chunks             int                    `json:"chunks"`
	OutputChars        int                    `json:"output_chars"`
	CharsPerSec        float64                `json:"chars_per_sec"`
	InputTokenEstimate int                    `json:"input_token_estimate"`
	FinishReason       string                 `json:"finish_reason"`
	Partial            bool                   `json:"partial"`
	Cancelled          bool                   `json:"cancelled"`
	ErrorCode          string                 `json:"error_code"`
	ErrorMessage       string                 `json:"error_message"`
	Attributes         map[string]interface{} `json:"attributes"`
}

type benchConfig struct {
	server     string
	httpAddr   string
	promptFile string
	clusterID  string
	output     string
	warmup     int
	iterations int
	timeout    time.Duration
	tag        string
	dryRun     bool
}

type capabilities struct {
	Provider  string
	Model     string
	AIVersion string
}

func main() {
	cfg := parseFlags()
	if err := run(context.Background(), cfg, nil); err != nil {
		fmt.Fprintln(os.Stderr, "bench:", err)
		os.Exit(1)
	}
}

func parseFlags() benchConfig {
	cfg := benchConfig{}
	flag.StringVar(&cfg.server, "server", "localhost:50051", "kubilitics-ai gRPC endpoint")
	flag.StringVar(&cfg.httpAddr, "http", "http://localhost:8081", "kubilitics-ai HTTP control-plane base URL")
	flag.StringVar(&cfg.promptFile, "prompts", "cmd/bench/prompts/smoke.yaml", "path to prompts YAML")
	flag.StringVar(&cfg.clusterID, "cluster-id", "bench-cluster", "focus_cluster_id used on every session")
	flag.StringVar(&cfg.output, "output", "bench-results.ndjson", "wide-event NDJSON output file")
	flag.IntVar(&cfg.warmup, "warmup", 1, "warmup iterations per prompt (not measured)")
	flag.IntVar(&cfg.iterations, "iterations", 3, "measured iterations per prompt")
	flag.DurationVar(&cfg.timeout, "timeout", 2*time.Minute, "per-prompt deadline")
	flag.StringVar(&cfg.tag, "tag", "untagged", "free-form tag stamped on every row, e.g. 'ollama-llama3-7b'")
	flag.BoolVar(&cfg.dryRun, "dry-run", false, "use in-process bufconn mock; no real LLM call")
	flag.Parse()
	return cfg
}

// dialer is the gRPC connection factory. The dry-run mock injects a bufconn
// dialer; production passes nil and we dial cfg.server.
type dialer func(ctx context.Context) (*grpc.ClientConn, error)

func run(ctx context.Context, cfg benchConfig, customDialer dialer) error {
	prompts, err := loadPrompts(cfg.promptFile)
	if err != nil {
		return fmt.Errorf("load prompts: %w", err)
	}
	if len(prompts) == 0 {
		return errors.New("no prompts found")
	}

	d := customDialer
	var caps capabilities
	if cfg.dryRun && d == nil {
		mockD, mockCaps, stop, err := startMock()
		if err != nil {
			return fmt.Errorf("start mock: %w", err)
		}
		defer stop()
		d = mockD
		caps = mockCaps
	} else if d == nil {
		caps = fetchCapabilities(ctx, cfg)
		d = func(ctx context.Context) (*grpc.ClientConn, error) {
			return grpc.NewClient(cfg.server, grpc.WithTransportCredentials(insecure.NewCredentials()))
		}
	} else {
		// custom dialer (test), capabilities default
		caps = capabilities{Provider: "mock", Model: "mock", AIVersion: "test"}
	}

	conn, err := d(ctx)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer func() { _ = conn.Close() }()

	chat := kotgv1.NewChatClient(conn)

	out, err := os.Create(cfg.output)
	if err != nil {
		return fmt.Errorf("open output: %w", err)
	}
	defer func() { _ = out.Close() }()
	enc := json.NewEncoder(out)

	var allRows []wideEvent
	for _, p := range prompts {
		// Warmup: same code path, results discarded.
		for i := 0; i < cfg.warmup; i++ {
			_ = runIteration(ctx, chat, cfg, caps, p, -1)
		}
		for i := 1; i <= cfg.iterations; i++ {
			row := runIteration(ctx, chat, cfg, caps, p, i)
			if err := enc.Encode(row); err != nil {
				return fmt.Errorf("encode row: %w", err)
			}
			allRows = append(allRows, row)
		}
	}

	summary := summarize(allRows, cfg, caps)
	if err := enc.Encode(summary); err != nil {
		return fmt.Errorf("encode summary: %w", err)
	}
	printSummary(os.Stdout, summary)
	return nil
}

func runIteration(ctx context.Context, chat kotgv1.ChatClient, cfg benchConfig, caps capabilities, p promptDef, iteration int) wideEvent {
	row := wideEvent{
		SchemaVersion:      schemaVersion,
		TS:                 time.Now().UTC().Format(time.RFC3339Nano),
		CorrelationID:      newID(),
		EventType:          "bench.llm_call",
		Result:             "success",
		Tag:                cfg.tag,
		Provider:           caps.Provider,
		Model:              caps.Model,
		AIVersion:          caps.AIVersion,
		ClusterID:          cfg.clusterID,
		PromptID:           p.ID,
		PromptCategory:     p.Category,
		Iteration:          iteration,
		InputTokenEstimate: estimateTokens(p.Text),
		Attributes:         map[string]interface{}{},
	}

	turnCtx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()

	sess, err := chat.CreateSession(turnCtx, &kotgv1.CreateSessionRequest{
		FocusClusterId: cfg.clusterID,
		Title:          "bench-" + p.ID,
	})
	if err != nil {
		row.Result = "failure"
		row.ErrorCode = "create_session"
		row.ErrorMessage = err.Error()
		return row
	}

	turnID := newID()
	t0 := time.Now()
	stream, err := chat.Send(turnCtx)
	if err != nil {
		row.Result = "failure"
		row.ErrorCode = "stream_open"
		row.ErrorMessage = err.Error()
		return row
	}
	if err := stream.Send(&kotgv1.UserMessage{
		SessionId: sess.SessionId,
		TurnId:    turnID,
		Text:      p.Text,
	}); err != nil {
		row.Result = "failure"
		row.ErrorCode = "send_user_message"
		row.ErrorMessage = err.Error()
		return row
	}
	_ = stream.CloseSend()

	var t1 time.Time
	for {
		ev, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			row.Result = "failure"
			row.ErrorCode = "stream_recv"
			row.ErrorMessage = err.Error()
			break
		}
		switch v := ev.GetEvent().(type) {
		case *kotgv1.AssistantEvent_TextDelta:
			text := v.TextDelta.GetText()
			if text == "" {
				continue
			}
			if t1.IsZero() {
				t1 = time.Now()
				row.TTFTMs = t1.Sub(t0).Milliseconds()
			}
			row.Chunks++
			row.OutputChars += len(text)
		case *kotgv1.AssistantEvent_Error:
			row.Result = "failure"
			row.ErrorCode = v.Error.GetCode()
			row.ErrorMessage = v.Error.GetMessage()
		case *kotgv1.AssistantEvent_Done:
			row.FinishReason = v.Done.GetFinishReason()
			row.Partial = v.Done.GetPartial()
			row.Cancelled = v.Done.GetCancelled()
		}
	}

	t2 := time.Now()
	row.TotalMs = t2.Sub(t0).Milliseconds()
	if !t1.IsZero() {
		dur := t2.Sub(t1).Seconds()
		if dur > 0 {
			row.CharsPerSec = float64(row.OutputChars) / dur
		}
	}
	return row
}

func loadPrompts(path string) ([]promptDef, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var pf promptFile
	if err := yaml.Unmarshal(data, &pf); err != nil {
		return nil, err
	}
	return pf.Prompts, nil
}

// estimateTokens is a crude pre-flight estimate (~4 chars per token).
// Real CountTokens lives on the LLM adapter; bench keeps zero deps.
func estimateTokens(s string) int {
	if s == "" {
		return 0
	}
	return int(math.Ceil(float64(len(s)) / 4.0))
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:])
}

// fetchCapabilities probes /status to confirm the AI process is up and to
// stamp ai_version into every row. Provider/model come from /capabilities if
// the server exposes it; otherwise we fall back to "unknown".
func fetchCapabilities(ctx context.Context, cfg benchConfig) capabilities {
	caps := capabilities{Provider: "unknown", Model: "unknown", AIVersion: "unknown"}
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, cfg.httpAddr+"/status", nil)
	resp, err := client.Do(req)
	if err != nil {
		return caps
	}
	defer func() { _ = resp.Body.Close() }()
	var body struct {
		AIVersion string `json:"ai_version"`
		Provider  string `json:"provider"`
		Model     string `json:"model"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err == nil {
		if body.AIVersion != "" {
			caps.AIVersion = body.AIVersion
		}
		if body.Provider != "" {
			caps.Provider = body.Provider
		}
		if body.Model != "" {
			caps.Model = body.Model
		}
	}
	return caps
}

// ── Summary ────────────────────────────────────────────────────────────────

type promptStat struct {
	PromptID    string  `json:"prompt_id"`
	Count       int     `json:"count"`
	SuccessRate float64 `json:"success_rate"`
	TTFTP50     int64   `json:"ttft_p50"`
	TTFTP95     int64   `json:"ttft_p95"`
	TTFTP99     int64   `json:"ttft_p99"`
	TotalP50    int64   `json:"total_p50"`
	TotalP95    int64   `json:"total_p95"`
	TotalP99    int64   `json:"total_p99"`
	AvgCPS      float64 `json:"avg_chars_per_sec"`
}

type summaryEvent struct {
	SchemaVersion  int          `json:"schema_version"`
	TS             string       `json:"ts"`
	EventType      string       `json:"event_type"`
	Tag            string       `json:"tag"`
	Provider       string       `json:"provider"`
	Model          string       `json:"model"`
	AIVersion      string       `json:"ai_version"`
	TotalPrompts   int          `json:"total_prompts"`
	TotalIters     int          `json:"total_iterations"`
	ErrorRate      float64      `json:"error_rate"`
	TTFTP50        int64        `json:"ttft_p50"`
	TTFTP95        int64        `json:"ttft_p95"`
	TTFTP99        int64        `json:"ttft_p99"`
	TotalP50       int64        `json:"total_p50"`
	TotalP95       int64        `json:"total_p95"`
	TotalP99       int64        `json:"total_p99"`
	PerPrompt      []promptStat `json:"per_prompt"`
}

func summarize(rows []wideEvent, cfg benchConfig, caps capabilities) summaryEvent {
	byPrompt := map[string][]wideEvent{}
	order := []string{}
	for _, r := range rows {
		if _, ok := byPrompt[r.PromptID]; !ok {
			order = append(order, r.PromptID)
		}
		byPrompt[r.PromptID] = append(byPrompt[r.PromptID], r)
	}

	stats := make([]promptStat, 0, len(order))
	for _, id := range order {
		group := byPrompt[id]
		var ttfts, totals []int64
		var cps []float64
		successes := 0
		for _, r := range group {
			if r.Result == "success" {
				successes++
				if r.TTFTMs > 0 {
					ttfts = append(ttfts, r.TTFTMs)
				}
				totals = append(totals, r.TotalMs)
				if r.CharsPerSec > 0 {
					cps = append(cps, r.CharsPerSec)
				}
			}
		}
		stats = append(stats, promptStat{
			PromptID:    id,
			Count:       len(group),
			SuccessRate: ratio(successes, len(group)),
			TTFTP50:     percentileInt(ttfts, 50),
			TTFTP95:     percentileInt(ttfts, 95),
			TTFTP99:     percentileInt(ttfts, 99),
			TotalP50:    percentileInt(totals, 50),
			TotalP95:    percentileInt(totals, 95),
			TotalP99:    percentileInt(totals, 99),
			AvgCPS:      avgFloat(cps),
		})
	}

	var allTTFT, allTotal []int64
	errs := 0
	for _, r := range rows {
		if r.Result != "success" {
			errs++
			continue
		}
		if r.TTFTMs > 0 {
			allTTFT = append(allTTFT, r.TTFTMs)
		}
		allTotal = append(allTotal, r.TotalMs)
	}

	return summaryEvent{
		SchemaVersion: schemaVersion,
		TS:            time.Now().UTC().Format(time.RFC3339Nano),
		EventType:     "bench.summary",
		Tag:           cfg.tag,
		Provider:      caps.Provider,
		Model:         caps.Model,
		AIVersion:     caps.AIVersion,
		TotalPrompts:  len(order),
		TotalIters:    len(rows),
		ErrorRate:     ratio(errs, len(rows)),
		TTFTP50:       percentileInt(allTTFT, 50),
		TTFTP95:       percentileInt(allTTFT, 95),
		TTFTP99:       percentileInt(allTTFT, 99),
		TotalP50:      percentileInt(allTotal, 50),
		TotalP95:      percentileInt(allTotal, 95),
		TotalP99:      percentileInt(allTotal, 99),
		PerPrompt:     stats,
	}
}

func ratio(n, d int) float64 {
	if d == 0 {
		return 0
	}
	return float64(n) / float64(d)
}

func avgFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var sum float64
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

// percentileInt uses the nearest-rank method: index = ceil(p/100 * N) - 1.
// Stable, no interpolation, no surprises on tiny samples.
func percentileInt(xs []int64, p int) int64 {
	if len(xs) == 0 {
		return 0
	}
	sorted := make([]int64, len(xs))
	copy(sorted, xs)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := int(math.Ceil(float64(p)/100.0*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func printSummary(w io.Writer, s summaryEvent) {
	fmt.Fprintf(w, "\n=== bench summary [tag=%s provider=%s model=%s ai=%s] ===\n",
		s.Tag, s.Provider, s.Model, s.AIVersion)
	fmt.Fprintf(w, "prompts=%d  iterations=%d  error_rate=%.2f%%\n",
		s.TotalPrompts, s.TotalIters, s.ErrorRate*100)
	fmt.Fprintf(w, "ttft  ms  p50=%d  p95=%d  p99=%d\n", s.TTFTP50, s.TTFTP95, s.TTFTP99)
	fmt.Fprintf(w, "total ms  p50=%d  p95=%d  p99=%d\n", s.TotalP50, s.TotalP95, s.TotalP99)
	fmt.Fprintln(w, "per-prompt:")
	for _, p := range s.PerPrompt {
		fmt.Fprintf(w, "  %-32s n=%d  ok=%.0f%%  ttft p50/95=%d/%d  total p50/95=%d/%d  cps=%.0f\n",
			p.PromptID, p.Count, p.SuccessRate*100,
			p.TTFTP50, p.TTFTP95, p.TotalP50, p.TotalP95, p.AvgCPS)
	}
}
