package cli

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestParseEventTime(t *testing.T) {
	e := k8sEvent{}
	e.LastTimestamp = "2026-02-16T10:00:00Z"
	e.EventTime = "2026-02-16T09:00:00Z"
	got := parseEventTime(e)
	if got.IsZero() {
		t.Fatalf("expected parsed timestamp")
	}
	if got.Format(time.RFC3339) != "2026-02-16T10:00:00Z" {
		t.Fatalf("expected lastTimestamp preference, got %s", got.Format(time.RFC3339))
	}
}

func TestFilterEventsByRecent(t *testing.T) {
	now := time.Date(2026, 2, 16, 12, 0, 0, 0, time.UTC)
	records := []eventRecord{
		{Timestamp: now.Add(-10 * time.Minute), Type: "Warning", Namespace: "default", Object: "Pod/a"},
		{Timestamp: now.Add(-3 * time.Hour), Type: "Warning", Namespace: "default", Object: "Pod/b"},
		{Timestamp: time.Time{}, Type: "Normal", Namespace: "default", Object: "Pod/c"},
	}
	got := filterEventsByRecent(records, 2*time.Hour, now)
	if len(got) != 2 {
		t.Fatalf("expected 2 records within window (+zero-time), got %d", len(got))
	}
	if got[0].Object != "Pod/a" {
		t.Fatalf("unexpected first record: %+v", got[0])
	}
}

func TestFilterEventsByType(t *testing.T) {
	records := []eventRecord{{Type: "Warning"}, {Type: "Normal"}, {Type: "warning"}}
	got := filterEventsByType(records, "warning")
	if len(got) != 2 {
		t.Fatalf("expected 2 warning records, got %d", len(got))
	}
}

func TestFilterEventsByResource(t *testing.T) {
	records := []eventRecord{
		{Object: "Pod/nginx-abc", Type: "Warning"},
		{Object: "Deployment/api-gateway", Type: "Normal"},
		{Object: "Pod/redis-xyz", Type: "Warning"},
	}
	got := filterEventsByResource(records, "pod/nginx")
	if len(got) != 1 || got[0].Object != "Pod/nginx-abc" {
		t.Fatalf("expected 1 matching record, got %d: %+v", len(got), got)
	}
	// Exact match
	got2 := filterEventsByResource(records, "Deployment/api-gateway")
	if len(got2) != 1 {
		t.Fatalf("expected 1 exact match, got %d", len(got2))
	}
}

func TestBuildRestartRecords(t *testing.T) {
	now := time.Now().UTC()
	raw := `{
  "items": [
    {
      "metadata": { "namespace": "default", "name": "api" },
      "spec": { "nodeName": "n1" },
      "status": {
        "phase": "Running",
        "containerStatuses": [
          {
            "name": "app",
            "restartCount": 3,
            "state": { "waiting": { "reason": "CrashLoopBackOff" } },
            "lastState": { "terminated": { "reason": "OOMKilled", "exitCode": 137, "finishedAt": "` + now.Format(time.RFC3339) + `" } }
          }
        ]
      }
    },
    {
      "metadata": { "namespace": "default", "name": "worker" },
      "spec": { "nodeName": "n2" },
      "status": {
        "phase": "Running",
        "containerStatuses": [
          {
            "name": "c",
            "restartCount": 1
          }
        ]
      }
    }
  ]
}`
	var list k8sPodList
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		t.Fatalf("unmarshal test pod list: %v", err)
	}
	got := buildRestartRecords(&list, 2, now.Add(-1*time.Hour))
	if len(got) != 1 {
		t.Fatalf("expected 1 restart record, got %d", len(got))
	}
	if got[0].Name != "api" {
		t.Fatalf("expected pod 'api', got %q", got[0].Name)
	}
	if got[0].Container != "app" {
		t.Errorf("expected container 'app', got %q", got[0].Container)
	}
	if got[0].Reason != "OOMKilled" {
		t.Errorf("expected reason 'OOMKilled', got %q", got[0].Reason)
	}
	if got[0].ExitCode != 137 {
		t.Errorf("expected exitCode 137, got %d", got[0].ExitCode)
	}
}

func TestBuildRestartRecords_FallbackToWaitingReason(t *testing.T) {
	raw := `{
  "items": [
    {
      "metadata": { "namespace": "prod", "name": "crash" },
      "spec": { "nodeName": "n1" },
      "status": {
        "phase": "Running",
        "containerStatuses": [
          {
            "name": "main",
            "restartCount": 5,
            "state": { "waiting": { "reason": "CrashLoopBackOff" } },
            "lastState": { "terminated": { "finishedAt": "" } }
          }
        ]
      }
    }
  ]
}`
	var list k8sPodList
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		t.Fatal(err)
	}
	got := buildRestartRecords(&list, 1, time.Time{})
	if len(got) != 1 {
		t.Fatalf("expected 1 record, got %d", len(got))
	}
	if got[0].Reason != "CrashLoopBackOff" {
		t.Errorf("expected reason 'CrashLoopBackOff', got %q", got[0].Reason)
	}
}

func TestHealthScoreBounds(t *testing.T) {
	pods := podHealthSummary{CrashLoop: 50, RestartPods: 50, Failed: 10, Pending: 20}
	nodes := nodeHealthSummary{Total: 3, NotReady: 3, MemoryPress: 2, DiskPress: 2, PIDPress: 2}
	score := healthScore(pods, nodes)
	if score < 0 || score > 100 {
		t.Fatalf("score out of bounds: %d", score)
	}
	// With capped penalties: 20+10+10+10+15+4+4+2=75, so score=25
	if score != 25 {
		t.Fatalf("expected 25, got %d", score)
	}
}

func TestHealthScoreBounds_Floor(t *testing.T) {
	// Extreme values should floor at 0
	pods := podHealthSummary{CrashLoop: 100, RestartPods: 100, Failed: 100, Pending: 100}
	nodes := nodeHealthSummary{Total: 10, NotReady: 10, MemoryPress: 10, DiskPress: 10, PIDPress: 10}
	score := healthScore(pods, nodes)
	if score != 0 {
		t.Fatalf("expected 0 for extreme cluster, got %d", score)
	}
}

func TestHealthScore_AllHealthy(t *testing.T) {
	pods := podHealthSummary{Total: 10, Running: 10}
	nodes := nodeHealthSummary{Total: 3, Ready: 3}
	score := healthScore(pods, nodes)
	if score != 100 {
		t.Fatalf("expected 100 for healthy cluster, got %d", score)
	}
}

func TestHealthScore_CrashLoopPods(t *testing.T) {
	pods := podHealthSummary{Total: 10, Running: 8, CrashLoop: 2}
	nodes := nodeHealthSummary{Total: 3, Ready: 3}
	score := healthScore(pods, nodes)
	// 2 CrashLoop × 3 = 6 penalty
	if score != 94 {
		t.Fatalf("expected 94, got %d", score)
	}
}

func TestHealthScore_NotReadyNode(t *testing.T) {
	pods := podHealthSummary{Total: 10, Running: 10}
	nodes := nodeHealthSummary{Total: 3, Ready: 2, NotReady: 1}
	score := healthScore(pods, nodes)
	// 1 NotReady × 5 = 5 penalty
	if score != 95 {
		t.Fatalf("expected 95, got %d", score)
	}
}

func TestHealthScore_MultipleIssues(t *testing.T) {
	pods := podHealthSummary{Total: 20, Running: 15, CrashLoop: 3, Pending: 2, RestartPods: 4}
	nodes := nodeHealthSummary{Total: 5, Ready: 4, NotReady: 1, MemoryPress: 1}
	score := healthScore(pods, nodes)
	// NotReady: 1×5=5, CrashLoop: 3×3=9, Pending: 2, MemoryPress: 1×2=2, RestartPods: 4
	// 100 - 5 - 9 - 2 - 2 - 4 = 78
	if score != 78 {
		t.Fatalf("expected 78, got %d", score)
	}
}

func TestCollectHealthIssues(t *testing.T) {
	pods := podHealthSummary{CrashLoop: 2, Failed: 1, Pending: 3}
	nodes := nodeHealthSummary{NotReady: 1, MemoryPress: 1}
	issues := collectHealthIssues(nil, nil, pods, nodes)

	severityCounts := map[string]int{}
	for _, iss := range issues {
		severityCounts[iss.Severity]++
	}
	if severityCounts["CRITICAL"] != 2 { // NotReady + CrashLoop
		t.Errorf("expected 2 CRITICAL issues, got %d", severityCounts["CRITICAL"])
	}
	if severityCounts["WARNING"] != 2 { // MemoryPressure + Failed
		t.Errorf("expected 2 WARNING issues, got %d", severityCounts["WARNING"])
	}
	if severityCounts["INFO"] != 1 { // Pending
		t.Errorf("expected 1 INFO issue, got %d", severityCounts["INFO"])
	}
}

func TestHealthResult_JSONOutput(t *testing.T) {
	result := healthResult{
		Context:   "test-context",
		Timestamp: time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC),
		Score:     87,
		Pods:      podHealthSummary{Total: 10, Running: 9, CrashLoop: 1},
		Nodes:     nodeHealthSummary{Total: 3, Ready: 3},
		Issues: []HealthIssue{
			{Severity: "CRITICAL", Resource: "1 pod(s)", Message: "CrashLoopBackOff"},
		},
	}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["score"].(float64) != 87 {
		t.Errorf("expected score 87 in JSON, got %v", parsed["score"])
	}
	if parsed["context"] != "test-context" {
		t.Errorf("expected context in JSON, got %v", parsed["context"])
	}
	issues, ok := parsed["issues"].([]any)
	if !ok || len(issues) != 1 {
		t.Errorf("expected 1 issue in JSON, got %v", parsed["issues"])
	}
}

func TestEventRecord_SourceField(t *testing.T) {
	raw := `{
  "items": [{
    "type": "Warning",
    "reason": "Unhealthy",
    "message": "Readiness probe failed",
    "count": 3,
    "firstTimestamp": "2026-03-18T10:00:00Z",
    "lastTimestamp": "2026-03-18T10:05:00Z",
    "involvedObject": { "kind": "Pod", "name": "api-abc", "namespace": "prod" },
    "source": { "component": "kubelet", "host": "node1" },
    "metadata": { "name": "ev1", "namespace": "prod", "creationTimestamp": "2026-03-18T10:00:00Z" }
  }]
}`
	var list k8sEventList
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		t.Fatal(err)
	}
	// Simulate what fetchEvents does
	item := list.Items[0]
	source := item.Source.Component
	if source != "kubelet" {
		t.Errorf("expected source 'kubelet', got %q", source)
	}
}

func TestPrintRestartTableTo_Empty(t *testing.T) {
	var buf bytes.Buffer
	printRestartTableTo(&buf, nil)
	if buf.String() != "No restarted pods found.\n" {
		t.Errorf("unexpected output for empty: %q", buf.String())
	}
}

func TestPrintEventTableTo_Empty(t *testing.T) {
	var buf bytes.Buffer
	printEventTableTo(&buf, nil)
	if buf.String() != "No events found.\n" {
		t.Errorf("unexpected output for empty: %q", buf.String())
	}
}

func TestParseMillicores(t *testing.T) {
	tests := []struct {
		input string
		want  int64
	}{
		{"42m", 42},
		{"1", 1000},
		{"0m", 0},
		{"250m", 250},
		{"", 0},
		{"bogus", 0},
		{"1024Xi", 0},
	}
	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := parseMillicores(tc.input)
			if got != tc.want {
				t.Errorf("parseMillicores(%q) = %d, want %d", tc.input, got, tc.want)
			}
		})
	}
}

func TestParseMiBytes(t *testing.T) {
	tests := []struct {
		input string
		want  int64
	}{
		{"128Mi", 128 * 1024 * 1024},
		{"1Gi", 1024 * 1024 * 1024},
		{"512Ki", 512 * 1024},
		{"0Mi", 0},
		{"", 0},
		{"bogus", 0},
		{"1024Xi", 0},
	}
	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			got := parseMiBytes(tc.input)
			if got != tc.want {
				t.Errorf("parseMiBytes(%q) = %d, want %d", tc.input, got, tc.want)
			}
		})
	}
}
