package toolrouter

import (
	"fmt"
	"testing"

	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/llm/types"
)

// TestSpotCheck_IncidentScenarios20 is a non-asserting probe used to see
// which topics + tool counts fire on the real bench suite. Run with
//
//	go test -run SpotCheck -v ./internal/llm/toolrouter/...
//
// It exists so we can eyeball the classifier during tuning; it never fails.
func TestSpotCheck_IncidentScenarios20(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	all := newMockTaxonomy()
	r := NewKeywordRouter()
	prompts := []string{
		"Give me a quick health check of the whole cluster.",
		"Is anything unhealthy in the demo namespace?",
		"Show me the web deployment in demo — how many replicas, are they all ready?",
		"Any pods that have restarted more than once in the last hour?",
		"Grab the latest logs from one of the web pods in demo.",
		"What errors or warnings are showing up in redis in the data namespace?",
		"What happened in the demo namespace in the last 15 minutes?",
		"Have any pods been OOMKilled or evicted cluster-wide recently?",
		"Are any of my nodes under pressure — CPU, memory, disk?",
		"How is the kubilitics-test-control-plane node doing?",
		"Do I have enough capacity to scale the web deployment from 3 to 10 replicas?",
		"Who has permission to delete pods in the demo namespace?",
		"Are any service accounts granted cluster-admin by accident?",
		"Are my PVCs healthy in the data namespace?",
		"What is my biggest cost driver this month?",
	}
	for _, p := range prompts {
		sel := r.SelectTools(p, all)
		fmt.Printf("%-80s -> %v (%d tools)\n", short(p, 80), sel.Topics, len(sel.Tools))
	}
	_ = types.Tool{}
}

func short(s string, n int) string {
	if len(s) > n-3 {
		return s[:n-3] + "..."
	}
	return s
}
