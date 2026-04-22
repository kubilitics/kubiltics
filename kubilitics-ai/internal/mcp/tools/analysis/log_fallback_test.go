package analysis_test

// log_fallback_test.go — regression test for gap 5 of the 2026-04-22 bench.
//
// The brain was returning "proxy not initialized" on scen-logs-48 because
// analyze_log_patterns unconditionally called the gRPC proxy. This test
// proves the REST fallback now takes over when the proxy is unavailable.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	pb "github.com/vellankikoti/kotg.ai/kubilitics-ai/api/proto/v1"
	"github.com/vellankikoti/kotg.ai/kubilitics-ai/internal/mcp/tools/analysis"
)

// proxyDeadFake simulates a proxy that is not initialized.
type proxyDeadFake struct{ *fakeProxy }

func (p *proxyDeadFake) ExecuteCommand(_ context.Context, _ string, _ *pb.Resource, _ []byte, _ bool) (*pb.CommandResult, error) {
	return nil, fmt.Errorf("proxy not initialized")
}

func TestAnalyzeLogPatterns_RESTFallback(t *testing.T) {
	// Fake REST backend: serves /clusters and /logs/ns/pod
	fb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/clusters":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"c1"}]`))
		case "/api/v1/clusters/c1/logs/demo/web-1":
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("line1\nerror: boom\nwarn: deprecated\n"))
		default:
			http.Error(w, "not found: "+r.URL.Path, 404)
		}
	}))
	defer fb.Close()

	fp := &proxyDeadFake{fakeProxy: newFakeProxy()}
	at := analysis.NewAnalysisToolsWithProxyAndREST(fp, fb.URL)

	out, err := at.AnalyzeLogPatterns(context.Background(), map[string]interface{}{
		"namespace": "demo",
		"pod_name":  "web-1",
		"tail_lines": 100,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := out.(map[string]interface{})
	if m["pod"] != "web-1" {
		t.Errorf("pod mismatch: %v", m["pod"])
	}
	if ec, _ := m["error_count"].(int); ec == 0 {
		t.Errorf("expected error_count > 0, got %v", m["error_count"])
	}
}

func TestAnalyzeLogPatterns_PropagatesNonProxyErrors(t *testing.T) {
	// Non "proxy not initialized" errors must still propagate (don't mask real bugs).
	fp := &fakeProxy{resources: make(map[string][]*pb.Resource), cmdErr: fmt.Errorf("backend down: 500")}
	at := analysis.NewAnalysisToolsWithProxy(fp)
	_, err := at.AnalyzeLogPatterns(context.Background(), map[string]interface{}{
		"namespace": "demo",
		"pod_name":  "web-1",
	})
	if err == nil {
		t.Fatal("expected error to propagate")
	}
}
