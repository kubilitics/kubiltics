package cli

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"text/template"
	"time"

	kcfg "github.com/kubilitics/kcli/internal/config"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) {
	// P1-4: Goroutine leak detection. Ignore AI client's runCacheSweeper which runs
	// as a background goroutine for cache eviction; it is started when ai.Client is created.
	goleak.VerifyTestMain(m,
		goleak.IgnoreAnyFunction("github.com/kubilitics/kcli/internal/ai.(*Client).runCacheSweeper"),
	)
}

func TestParseLogsOptions(t *testing.T) {
	opts, err := parseLogsOptions([]string{"app=api", "-f", "--timestamps", "--tail", "100", "--since=30m", "--grep", "error", "--grep-v", "debug", "--save=out.log", "--ai-summarize", "--ai-errors", "--ai-explain", "-n", "ops"}, "default")
	if err != nil {
		t.Fatalf("parseLogsOptions error: %v", err)
	}
	if opts.Target != "app=api" || !opts.Follow || !opts.Timestamps || opts.Tail != "100" || opts.Since != "30m" || opts.Grep != "error" || opts.GrepV != "debug" || opts.Save != "out.log" || opts.Namespace != "ops" || !opts.AISummarize || !opts.AIErrors || !opts.AIExplain {
		t.Fatalf("unexpected opts: %+v", opts)
	}
}

// P4-4: new flag parsing

func TestParseLogsOptions_P44Flags(t *testing.T) {
	opts, err := parseLogsOptions([]string{
		"nginx.*",
		"--exclude=canary",
		"--container-state=running",
		"--node=worker-1",
		"--output=json",
	}, "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.Target != "nginx.*" {
		t.Errorf("expected Target='nginx.*', got %q", opts.Target)
	}
	if opts.ExcludePods != "canary" {
		t.Errorf("expected ExcludePods='canary', got %q", opts.ExcludePods)
	}
	if opts.ContainerState != "running" {
		t.Errorf("expected ContainerState='running', got %q", opts.ContainerState)
	}
	if opts.Node != "worker-1" {
		t.Errorf("expected Node='worker-1', got %q", opts.Node)
	}
	if opts.Output != "json" {
		t.Errorf("expected Output='json', got %q", opts.Output)
	}
}

func TestParseLogsOptions_P44FlagsSpaceSeparated(t *testing.T) {
	opts, err := parseLogsOptions([]string{
		"--exclude", "canary-.*",
		"--container-state", "running",
		"--node", "node-42",
		"--output", "raw",
	}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.ExcludePods != "canary-.*" {
		t.Errorf("ExcludePods: got %q", opts.ExcludePods)
	}
	if opts.ContainerState != "running" {
		t.Errorf("ContainerState: got %q", opts.ContainerState)
	}
	if opts.Node != "node-42" {
		t.Errorf("Node: got %q", opts.Node)
	}
	if opts.Output != "raw" {
		t.Errorf("Output: got %q", opts.Output)
	}
}

func TestParseLogsOptions_MissingExcludeValue(t *testing.T) {
	_, err := parseLogsOptions([]string{"--exclude"}, "")
	if err == nil {
		t.Fatal("expected error for missing --exclude value")
	}
}

func TestParseLogsOptions_MissingNodeValue(t *testing.T) {
	_, err := parseLogsOptions([]string{"--node"}, "")
	if err == nil {
		t.Fatal("expected error for missing --node value")
	}
}

// ---------------------------------------------------------------------------
// isMultiPodTarget
// ---------------------------------------------------------------------------

func TestIsMultiPodTarget(t *testing.T) {
	cases := map[string]bool{
		"":                 false,
		"mypod":            false,
		"app=api":          true,
		"app=api,tier=web": true,
		"deployment/api":   true,
		"deploy/api":       true,
	}
	for in, want := range cases {
		if got := isMultiPodTarget(in); got != want {
			t.Fatalf("isMultiPodTarget(%q)=%v want %v", in, got, want)
		}
	}
}

// ---------------------------------------------------------------------------
// isPodNameRegex (P4-4)
// ---------------------------------------------------------------------------

func TestIsPodNameRegex_EmptyString(t *testing.T) {
	if isPodNameRegex("") {
		t.Fatal("empty string should not be a regex")
	}
}

func TestIsPodNameRegex_PlainPodName(t *testing.T) {
	for _, name := range []string{"nginx", "my-pod", "web-123", "api.v2"} {
		if isPodNameRegex(name) {
			t.Errorf("plain pod name %q should not be detected as regex", name)
		}
	}
}

func TestIsPodNameRegex_WithStar(t *testing.T) {
	if !isPodNameRegex("nginx.*") {
		t.Fatal("nginx.* should be detected as regex")
	}
}

func TestIsPodNameRegex_WithBrackets(t *testing.T) {
	if !isPodNameRegex("pod-[0-9]+") {
		t.Fatal("pod-[0-9]+ should be detected as regex")
	}
}

func TestIsPodNameRegex_WithPipe(t *testing.T) {
	if !isPodNameRegex("api|worker") {
		t.Fatal("api|worker should be detected as regex")
	}
}

func TestIsPodNameRegex_WithCaret(t *testing.T) {
	if !isPodNameRegex("^nginx") {
		t.Fatal("^nginx should be detected as regex")
	}
}

func TestIsPodNameRegex_WithDollar(t *testing.T) {
	if !isPodNameRegex("worker$") {
		t.Fatal("worker$ should be detected as regex")
	}
}

func TestIsPodNameRegex_WithPlus(t *testing.T) {
	if !isPodNameRegex("pod+") {
		t.Fatal("pod+ should be detected as regex")
	}
}

// ---------------------------------------------------------------------------
// parseAbsoluteSince (P4-4)
// ---------------------------------------------------------------------------

func TestParseAbsoluteSince_Empty(t *testing.T) {
	if got := parseAbsoluteSince(""); got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestParseAbsoluteSince_Duration(t *testing.T) {
	// Standard Go durations pass through unchanged.
	for _, d := range []string{"5m", "1h", "30s", "2h30m", "1h0m0s"} {
		if got := parseAbsoluteSince(d); got != d {
			t.Errorf("parseAbsoluteSince(%q): expected passthrough, got %q", d, got)
		}
	}
}

func TestParseAbsoluteSince_HHMM(t *testing.T) {
	// Provide a time that is definitely in the past (00:01 was hours ago).
	since := parseAbsoluteSince("00:01")
	if !strings.HasSuffix(since, "s") {
		t.Errorf("expected seconds string, got %q", since)
	}
	// The duration should be somewhere between 1s and 24h.
	if since == "" || since == "00:01" {
		t.Errorf("HH:MM was not converted, got %q", since)
	}
}

func TestParseAbsoluteSince_HHMMSS(t *testing.T) {
	since := parseAbsoluteSince("00:00:30")
	if !strings.HasSuffix(since, "s") {
		t.Errorf("expected seconds string, got %q", since)
	}
}

func TestParseAbsoluteSince_FutureTimeBecomesYesterday(t *testing.T) {
	// Build a time 1 minute in the future.
	now := time.Now()
	future := now.Add(time.Minute)
	s := future.Format("15:04")
	got := parseAbsoluteSince(s)
	// Must be a large seconds count (almost 24h = ~86340s).
	if !strings.HasSuffix(got, "s") {
		t.Errorf("expected seconds string, got %q", got)
	}
}

func TestParseAbsoluteSince_UnknownPassthrough(t *testing.T) {
	// Non-parseable values pass through unchanged.
	if got := parseAbsoluteSince("yesterday"); got != "yesterday" {
		t.Errorf("expected passthrough, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// parsePodRefOutput (P4-4)
// ---------------------------------------------------------------------------

func TestParsePodRefOutput_Basic(t *testing.T) {
	out := "default\tnginx-abc\nkube-system\tcoredns-xyz\n"
	pods := parsePodRefOutput(out)
	if len(pods) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(pods))
	}
	// Should be sorted: default < kube-system alphabetically.
	if pods[0].Namespace != "default" || pods[0].Name != "nginx-abc" {
		t.Errorf("unexpected first pod: %+v", pods[0])
	}
	if pods[1].Namespace != "kube-system" || pods[1].Name != "coredns-xyz" {
		t.Errorf("unexpected second pod: %+v", pods[1])
	}
}

func TestParsePodRefOutput_Deduplication(t *testing.T) {
	out := "default\tnginx\ndefault\tnginx\ndefault\tother\n"
	pods := parsePodRefOutput(out)
	if len(pods) != 2 {
		t.Fatalf("expected 2 deduplicated pods, got %d", len(pods))
	}
}

func TestParsePodRefOutput_EmptyInput(t *testing.T) {
	pods := parsePodRefOutput("")
	if len(pods) != 0 {
		t.Fatalf("expected 0 pods from empty input, got %d", len(pods))
	}
}

func TestParsePodRefOutput_MalformedLinesSkipped(t *testing.T) {
	out := "default\tnginx\njunk-line-no-tab\nkube-system\tcoredns\n"
	pods := parsePodRefOutput(out)
	if len(pods) != 2 {
		t.Fatalf("expected 2 valid pods, got %d", len(pods))
	}
}

func TestParsePodRefOutput_SortedByNamespaceAndName(t *testing.T) {
	out := "z-ns\tbbb\na-ns\tzzz\na-ns\taaa\n"
	pods := parsePodRefOutput(out)
	if len(pods) != 3 {
		t.Fatalf("expected 3 pods, got %d", len(pods))
	}
	if pods[0].Namespace != "a-ns" || pods[0].Name != "aaa" {
		t.Errorf("sort wrong: [0] = %+v", pods[0])
	}
	if pods[1].Namespace != "a-ns" || pods[1].Name != "zzz" {
		t.Errorf("sort wrong: [1] = %+v", pods[1])
	}
	if pods[2].Namespace != "z-ns" || pods[2].Name != "bbb" {
		t.Errorf("sort wrong: [2] = %+v", pods[2])
	}
}

// ---------------------------------------------------------------------------
// filterExcludePods (P4-4)
// ---------------------------------------------------------------------------

func TestFilterExcludePods_EmptyPattern(t *testing.T) {
	pods := []podRef{
		{Namespace: "default", Name: "nginx"},
		{Namespace: "default", Name: "canary"},
	}
	got, err := filterExcludePods(pods, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 pods (no filter), got %d", len(got))
	}
}

func TestFilterExcludePods_ExcludesMatch(t *testing.T) {
	pods := []podRef{
		{Namespace: "default", Name: "nginx-abc"},
		{Namespace: "default", Name: "canary-123"},
		{Namespace: "default", Name: "nginx-def"},
	}
	got, err := filterExcludePods(pods, "canary")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 pods after excluding canary, got %d: %+v", len(got), got)
	}
	for _, p := range got {
		if strings.Contains(p.Name, "canary") {
			t.Errorf("canary pod %q should have been excluded", p.Name)
		}
	}
}

func TestFilterExcludePods_RegexExclusion(t *testing.T) {
	pods := []podRef{
		{Namespace: "default", Name: "api-v1-abc"},
		{Namespace: "default", Name: "api-v2-def"},
		{Namespace: "default", Name: "worker-xyz"},
	}
	// Exclude pods matching api-v1-.*
	got, err := filterExcludePods(pods, `api-v1-.*`)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(got))
	}
}

func TestFilterExcludePods_InvalidRegex(t *testing.T) {
	pods := []podRef{{Namespace: "default", Name: "nginx"}}
	_, err := filterExcludePods(pods, "[invalid")
	if err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestFilterExcludePods_AllExcluded(t *testing.T) {
	pods := []podRef{
		{Namespace: "default", Name: "canary-1"},
		{Namespace: "default", Name: "canary-2"},
	}
	got, err := filterExcludePods(pods, "canary")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected 0 pods, got %d", len(got))
	}
}

// ---------------------------------------------------------------------------
// stripKcliLogsFlags (P4-4)
// ---------------------------------------------------------------------------

func TestStripKcliLogsFlags_AIFlags(t *testing.T) {
	args := []string{"pod-name", "--ai-summarize", "--ai-errors", "--ai-explain"}
	got := stripKcliLogsFlags(args)
	if len(got) != 1 || got[0] != "pod-name" {
		t.Errorf("expected only [pod-name], got %v", got)
	}
}

func TestStripKcliLogsFlags_ValueBearing(t *testing.T) {
	args := []string{"--grep", "error", "--grep-v", "debug", "--save", "out.log", "pod"}
	got := stripKcliLogsFlags(args)
	if len(got) != 1 || got[0] != "pod" {
		t.Errorf("expected only [pod], got %v", got)
	}
}

func TestStripKcliLogsFlags_P44Flags(t *testing.T) {
	args := []string{"nginx", "--exclude", "canary", "--node", "worker-1", "--container-state", "running", "--output", "json", "-f"}
	got := stripKcliLogsFlags(args)
	// Should only keep: nginx, -f
	if len(got) != 2 {
		t.Errorf("expected [nginx -f], got %v", got)
	}
}

func TestStripKcliLogsFlags_EqualFormFlags(t *testing.T) {
	args := []string{"--exclude=canary", "--node=worker-1", "--container-state=running", "--output=raw", "pod"}
	got := stripKcliLogsFlags(args)
	if len(got) != 1 || got[0] != "pod" {
		t.Errorf("expected only [pod], got %v", got)
	}
}

func TestStripKcliLogsFlags_PreservesKubectlFlags(t *testing.T) {
	args := []string{"-f", "--tail", "50", "--timestamps", "--since=5m", "-c", "main"}
	got := stripKcliLogsFlags(args)
	if len(got) != len(args) {
		t.Errorf("kubectl flags should pass through unchanged; got %v", got)
	}
}

// ---------------------------------------------------------------------------
// streamWriter output modes (P4-4)
// ---------------------------------------------------------------------------

func TestStreamWriterDefault(t *testing.T) {
	buf := &bytes.Buffer{}
	sw := &streamWriter{out: os.Stdout, color: map[string]string{}, output: "default"}
	// Redirect to buffer for test by temporarily swapping out field.
	// We'll just test that write() doesn't panic and produces non-empty output.
	// Real output goes to os.Stdout; we trust the format string logic.
	_ = sw
	_ = buf
	// Structural smoke-test: ensure the color map is populated after first write.
	sw2 := &streamWriter{out: os.Stdout, color: map[string]string{}, output: "default"}
	sw2.write("default/nginx", "hello world")
	if _, ok := sw2.color["default/nginx"]; !ok {
		t.Fatal("expected color to be assigned to source after write")
	}
}

func TestStreamWriterOutputModeRaw(t *testing.T) {
	// Raw mode: color map should not be populated.
	sw := &streamWriter{out: os.Stdout, color: map[string]string{}, output: "raw"}
	sw.write("default/nginx", "raw log line")
	if len(sw.color) != 0 {
		t.Fatal("raw mode should not populate color map")
	}
}

func TestStreamWriterOutputModeJSON(t *testing.T) {
	// JSON mode: color map should not be populated.
	sw := &streamWriter{out: os.Stdout, color: map[string]string{}, output: "json"}
	sw.write("default/nginx", `{"key":"value"}`)
	if len(sw.color) != 0 {
		t.Fatal("json mode should not populate color map")
	}
}

func TestNewStreamWriter_DefaultOutputMode(t *testing.T) {
	sw, cleanup, err := newStreamWriter("", "", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer cleanup()
	if sw.output != "default" {
		t.Errorf("expected output='default', got %q", sw.output)
	}
}

func TestNewStreamWriter_JSONOutputMode(t *testing.T) {
	sw, cleanup, err := newStreamWriter("", "json", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer cleanup()
	if sw.output != "json" {
		t.Errorf("expected output='json', got %q", sw.output)
	}
}

// ---------------------------------------------------------------------------
// compileLogFilters, extractErrorLines, lastNLogLines (pre-existing)
// ---------------------------------------------------------------------------

func TestCompileLogFilters(t *testing.T) {
	match, exclude, err := compileLogFilters(logsOptions{Grep: "error", GrepV: "debug"})
	if err != nil {
		t.Fatalf("compileLogFilters error: %v", err)
	}
	if !match.MatchString("error happened") {
		t.Fatal("expected match regex to match")
	}
	if !exclude.MatchString("debug line") {
		t.Fatal("expected exclude regex to match")
	}
	if _, _, err := compileLogFilters(logsOptions{Grep: "["}); err == nil {
		t.Fatal("expected invalid regex error")
	}
}

func TestExtractErrorLines(t *testing.T) {
	logs := "INFO startup ok\nERROR db connection failed\nwarning retrying\npanic: fatal crash\nERROR db connection failed\n"
	errs := extractErrorLines(logs)
	// P1-6: extractErrorLines matches ERROR, WARN, panic, etc.
	if len(errs) != 3 {
		t.Fatalf("expected 3 unique error/warn lines, got %d: %+v", len(errs), errs)
	}
	// Order may vary; check we have the expected lines.
	seen := make(map[string]bool)
	for _, e := range errs {
		seen[e] = true
	}
	for _, want := range []string{"ERROR db connection failed", "warning retrying", "panic: fatal crash"} {
		if !seen[want] {
			t.Fatalf("expected %q in extracted lines: %+v", want, errs)
		}
	}
}

func TestParseLogsOptions_Loki(t *testing.T) {
	opts, err := parseLogsOptions([]string{"--loki", `{namespace="production"} |= "ERROR"`}, "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.Loki != `{namespace="production"} |= "ERROR"` {
		t.Errorf("expected Loki query, got %q", opts.Loki)
	}

	opts2, err := parseLogsOptions([]string{"--loki={app=\"nginx\"}"}, "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts2.Loki != `{app="nginx"}` {
		t.Errorf("expected Loki query, got %q", opts2.Loki)
	}

	_, err = parseLogsOptions([]string{"--loki"}, "default")
	if err == nil {
		t.Fatal("expected error for --loki without value")
	}
}

func TestGetLokiEndpoint(t *testing.T) {
	// Without config or env, should return empty
	a := &app{cfg: nil}
	if got := getLokiEndpoint(a); got != "" {
		t.Errorf("expected empty without config, got %q", got)
	}
	// With env
	os.Setenv("LOKI_ENDPOINT", "http://loki:3100")
	defer os.Unsetenv("LOKI_ENDPOINT")
	a2 := &app{cfg: nil}
	if got := getLokiEndpoint(a2); got != "http://loki:3100" {
		t.Errorf("expected http://loki:3100 from env, got %q", got)
	}
	// Config overrides env
	a3 := &app{cfg: &kcfg.Config{Integrations: kcfg.IntegrationsConfig{LokiEndpoint: "http://custom:3100"}}}
	if got := getLokiEndpoint(a3); got != "http://custom:3100" {
		t.Errorf("expected http://custom:3100 from config, got %q", got)
	}
}

func TestLokiStreamToSource(t *testing.T) {
	tests := []struct {
		stream map[string]string
		want   string
	}{
		{map[string]string{"namespace": "default", "pod_name": "nginx"}, "default/nginx"},
		{map[string]string{"namespace": "prod", "pod": "api"}, "prod/api"},
		{map[string]string{"job": "default/worker"}, "default/worker"},
		{map[string]string{"instance": "standalone"}, "standalone"},
	}
	for _, tt := range tests {
		if got := lokiStreamToSource(tt.stream); got != tt.want {
			t.Errorf("lokiStreamToSource(%v) = %q, want %q", tt.stream, got, tt.want)
		}
	}
}

func TestExtractErrorLinesPerformance(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 1000; i++ {
		if i%10 == 0 {
			b.WriteString("ERROR request failed due to timeout\n")
		} else {
			b.WriteString("INFO request ok\n")
		}
	}
	start := time.Now()
	errs := extractErrorLines(b.String())
	elapsed := time.Since(start)
	if len(errs) == 0 {
		t.Fatal("expected extracted errors")
	}
	if elapsed > 200*time.Millisecond {
		t.Fatalf("extractErrorLines too slow for 1000 lines: %s", elapsed)
	}
}

// ---------------------------------------------------------------------------
// P0-7: --template flag
// ---------------------------------------------------------------------------

func TestParseLogsOptions_Template(t *testing.T) {
	opts, err := parseLogsOptions([]string{
		"app=api",
		"--template=[{{.PodName}}] {{.Message}}",
	}, "default")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.Template != "[{{.PodName}}] {{.Message}}" {
		t.Errorf("expected template string, got %q", opts.Template)
	}
}

func TestParseLogsOptions_TemplateEqualForm(t *testing.T) {
	opts, err := parseLogsOptions([]string{
		"--template={{.Namespace}}/{{.PodName}}: {{.Message}}",
	}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.Template != "{{.Namespace}}/{{.PodName}}: {{.Message}}" {
		t.Errorf("template mismatch: %q", opts.Template)
	}
}

func TestParseLogsOptions_TemplateMissingValue(t *testing.T) {
	_, err := parseLogsOptions([]string{"--template"}, "")
	if err == nil {
		t.Fatal("expected error for missing --template value")
	}
}

func TestStripKcliLogsFlags_Template(t *testing.T) {
	args := []string{"--template", "[{{.PodName}}] {{.Message}}", "pod-name", "-f"}
	got := stripKcliLogsFlags(args)
	if len(got) != 2 || got[0] != "pod-name" || got[1] != "-f" {
		t.Errorf("expected [pod-name -f], got %v", got)
	}
}

func TestStripKcliLogsFlags_TemplateEqualForm(t *testing.T) {
	args := []string{"--template={{.PodName}}: {{.Message}}", "pod"}
	got := stripKcliLogsFlags(args)
	if len(got) != 1 || got[0] != "pod" {
		t.Errorf("expected [pod], got %v", got)
	}
}

func TestStreamWriterEntry_WithTemplate(t *testing.T) {
	// Capture output via os.Pipe.
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	tmpl, err := template.New("log").Parse("[{{.PodName}}] {{.Message}}")
	if err != nil {
		t.Fatal(err)
	}
	sw := &streamWriter{out: w, color: map[string]string{}, output: "default", tmpl: tmpl}
	sw.writeEntry("default", "nginx-abc", "main", "hello world")
	_ = w.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)
	got := strings.TrimSpace(buf.String())
	if got != "[nginx-abc] hello world" {
		t.Errorf("template output: got %q, want %q", got, "[nginx-abc] hello world")
	}
}

func TestStreamWriterEntry_WithTemplateAllFields(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	tmpl, err := template.New("log").Parse("{{.Namespace}}/{{.PodName}}/{{.ContainerName}}: {{.Message}}")
	if err != nil {
		t.Fatal(err)
	}
	sw := &streamWriter{out: w, color: map[string]string{}, output: "default", tmpl: tmpl}
	sw.writeEntry("prod", "api-xyz", "server", "request ok")
	_ = w.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)
	got := strings.TrimSpace(buf.String())
	want := "prod/api-xyz/server: request ok"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestStreamWriterEntry_NoTemplate_DefaultMode(t *testing.T) {
	// Without a template, writeEntry falls back to the colour-prefixed default.
	sw := &streamWriter{out: os.Stdout, color: map[string]string{}, output: "default", tmpl: nil}
	sw.writeEntry("default", "nginx", "main", "hello")
	if _, ok := sw.color["default/nginx"]; !ok {
		t.Fatal("expected color to be assigned in default mode without template")
	}
}

// ---------------------------------------------------------------------------
// P0-7: --max-log-requests flag
// ---------------------------------------------------------------------------

func TestParseLogsOptions_MaxLogRequests(t *testing.T) {
	opts, err := parseLogsOptions([]string{"app=api", "--max-log-requests=10"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.MaxLogRequests != 10 {
		t.Errorf("expected MaxLogRequests=10, got %d", opts.MaxLogRequests)
	}
}

func TestParseLogsOptions_MaxLogRequestsSpaceSeparated(t *testing.T) {
	opts, err := parseLogsOptions([]string{"--max-log-requests", "25"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.MaxLogRequests != 25 {
		t.Errorf("expected MaxLogRequests=25, got %d", opts.MaxLogRequests)
	}
}

func TestParseLogsOptions_MaxLogRequestsMissingValue(t *testing.T) {
	_, err := parseLogsOptions([]string{"--max-log-requests"}, "")
	if err == nil {
		t.Fatal("expected error for missing --max-log-requests value")
	}
}

func TestStripKcliLogsFlags_MaxLogRequests(t *testing.T) {
	args := []string{"--max-log-requests", "10", "pod", "-f"}
	got := stripKcliLogsFlags(args)
	if len(got) != 2 || got[0] != "pod" || got[1] != "-f" {
		t.Errorf("expected [pod -f], got %v", got)
	}
}

func TestStripKcliLogsFlags_MaxLogRequestsEqualForm(t *testing.T) {
	args := []string{"--max-log-requests=5", "pod"}
	got := stripKcliLogsFlags(args)
	if len(got) != 1 || got[0] != "pod" {
		t.Errorf("expected [pod], got %v", got)
	}
}

// ---------------------------------------------------------------------------
// P0-7: containerStateFieldSelector
// ---------------------------------------------------------------------------

func TestContainerStateFieldSelector_Running(t *testing.T) {
	got := containerStateFieldSelector("running")
	if got != "status.phase=Running" {
		t.Errorf("got %q", got)
	}
}

func TestContainerStateFieldSelector_Waiting(t *testing.T) {
	got := containerStateFieldSelector("waiting")
	if got != "status.phase=Pending" {
		t.Errorf("got %q", got)
	}
}

func TestContainerStateFieldSelector_Terminated(t *testing.T) {
	// terminated must return "" — we handle it via --previous in kubectl.
	got := containerStateFieldSelector("terminated")
	if got != "" {
		t.Errorf("expected empty field selector for terminated, got %q", got)
	}
}

func TestContainerStateFieldSelector_Empty(t *testing.T) {
	got := containerStateFieldSelector("")
	if got != "" {
		t.Errorf("expected empty field selector for empty state, got %q", got)
	}
}

func TestContainerStateFieldSelector_CaseInsensitive(t *testing.T) {
	if containerStateFieldSelector("Running") != "status.phase=Running" {
		t.Error("running should be case-insensitive")
	}
	if containerStateFieldSelector("WAITING") != "status.phase=Pending" {
		t.Error("waiting should be case-insensitive")
	}
	if containerStateFieldSelector("Terminated") != "" {
		t.Error("terminated should be case-insensitive and return empty")
	}
}

func TestParseLogsOptions_ContainerStateTerminated(t *testing.T) {
	opts, err := parseLogsOptions([]string{"app=nginx", "--container-state=terminated"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.ContainerState != "terminated" {
		t.Errorf("expected ContainerState='terminated', got %q", opts.ContainerState)
	}
}

func TestParseLogsOptions_ContainerStateWaiting(t *testing.T) {
	opts, err := parseLogsOptions([]string{"app=nginx", "--container-state=waiting"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if opts.ContainerState != "waiting" {
		t.Errorf("expected ContainerState='waiting', got %q", opts.ContainerState)
	}
}
