package analysis

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// When args carry cluster_id (e.g. because runtime.clusterIDInjectingExecutor
// populated it from the chat session's focus cluster), resolveClusterID must
// use it verbatim and NEVER consult the REST endpoint. The regression this
// protects: analyze_* tools silently calling /api/v1/clusters and picking the
// first-registered one, ignoring which cluster the operator asked about.
func TestResolveClusterID_PrefersArgsClusterID(t *testing.T) {
	// Server that would return a different cluster if called — if the test
	// function reaches it, we've leaked past the args short-circuit.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("resolveClusterID must not fetch from backend when args has cluster_id; called %s", r.URL.Path)
	}))
	defer srv.Close()

	tool := &AnalysisTools{restCli: newRestClient(srv.URL)}
	id, err := tool.resolveClusterID(context.Background(), map[string]interface{}{
		"cluster_id": "session-focus-cluster",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "session-focus-cluster" {
		t.Fatalf("want session-focus-cluster, got %q", id)
	}
}

func TestResolveClusterID_FallsBackToFirstClusterID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/api/v1/clusters") {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[{"id":"first-reg-cluster"}]`))
	}))
	defer srv.Close()

	tool := &AnalysisTools{restCli: newRestClient(srv.URL)}
	id, err := tool.resolveClusterID(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "first-reg-cluster" {
		t.Fatalf("want first-reg-cluster, got %q", id)
	}
}

func TestResolveClusterID_EmptyArgsClusterIDFallsBack(t *testing.T) {
	// The LLM sometimes emits an empty string for cluster_id. That must be
	// treated as "not provided" so the REST fallback picks up, rather than
	// propagating "" into a GET /api/v1/clusters//resources/... URL that
	// would 404.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"id":"first-reg-cluster"}]`))
	}))
	defer srv.Close()

	tool := &AnalysisTools{restCli: newRestClient(srv.URL)}
	id, err := tool.resolveClusterID(context.Background(), map[string]interface{}{
		"cluster_id": "",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "first-reg-cluster" {
		t.Fatalf("want first-reg-cluster, got %q", id)
	}
}

func TestResolveClusterID_ErrorsWhenNoClustersAndNoArgs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	tool := &AnalysisTools{restCli: newRestClient(srv.URL)}
	_, err := tool.resolveClusterID(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error when no args cluster_id and no clusters registered")
	}
}
