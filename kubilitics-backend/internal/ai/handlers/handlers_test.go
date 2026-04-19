package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/ai/gate"
	"github.com/kubilitics/kubilitics-backend/internal/ai/proxy"
	"github.com/kubilitics/kubilitics-backend/internal/ai/supervisor"
	"github.com/kubilitics/kubilitics-backend/internal/ai/types"
)

func stubBinary(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../supervisor/testdata/stubsidecar/stub"))
}

func newTestServer(t *testing.T) (*httptest.Server, supervisor.Supervisor) {
	sup := supervisor.New(supervisor.Config{
		BinaryPath:         stubBinary(t),
		IdleShutdown:       30 * time.Second,
		MaxRestartAttempts: 3,
		RestartWindow:      5 * time.Second,
	})
	p := proxy.New(sup, gate.NoOpGate{}, 60)
	h := New(sup, p, Config{Enabled: true, ChatMaxDuration: 30 * time.Second})
	mux := http.NewServeMux()
	h.Register(mux)
	return httptest.NewServer(mux), sup
}

func TestStatusEndpoint(t *testing.T) {
	srv, sup := newTestServer(t)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	resp, err := http.Get(srv.URL + "/api/v1/ai/status")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status code = %d", resp.StatusCode)
	}
	var st types.SidecarStatus
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

func TestRefreshEndpoint(t *testing.T) {
	srv, sup := newTestServer(t)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/ai/refresh", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode != 202 {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}
}

func TestStatusWhenAIDisabled(t *testing.T) {
	sup := supervisor.New(supervisor.Config{BinaryPath: stubBinary(t)})
	p := proxy.New(sup, gate.NoOpGate{}, 60)
	h := New(sup, p, Config{Enabled: false, ChatMaxDuration: 30 * time.Second})
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	resp, _ := http.Get(srv.URL + "/api/v1/ai/status")
	var st types.SidecarStatus
	json.NewDecoder(resp.Body).Decode(&st)
	if st.DisabledReason != types.DisabledReasonAIDisabled {
		t.Errorf("DisabledReason = %q, want %q", st.DisabledReason, types.DisabledReasonAIDisabled)
	}
}

func TestCapabilitiesAIDisabled(t *testing.T) {
	sup := supervisor.New(supervisor.Config{BinaryPath: stubBinary(t)})
	p := proxy.New(sup, gate.NoOpGate{}, 60)
	h := New(sup, p, Config{Enabled: false, ChatMaxDuration: 30 * time.Second})
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	resp, _ := http.Get(srv.URL + "/api/v1/ai/capabilities?cluster_id=c1")
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	if body["disabled_reason"] != "ai_disabled" {
		t.Errorf("disabled_reason = %v, want ai_disabled", body["disabled_reason"])
	}
	if body["ready"] != false {
		t.Errorf("ready = %v, want false", body["ready"])
	}
}

func TestCapabilitiesMissingClusterID(t *testing.T) {
	srv, sup := newTestServer(t)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	resp, _ := http.Get(srv.URL + "/api/v1/ai/capabilities")
	if resp.StatusCode != 400 {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCapabilitiesNeverStarted(t *testing.T) {
	srv, sup := newTestServer(t)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	resp, _ := http.Get(srv.URL + "/api/v1/ai/capabilities?cluster_id=c1")
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	if body["ready"] != false {
		t.Errorf("ready = %v, want false (sidecar never spawned)", body["ready"])
	}
	if body["disabled_reason"] != "never_started" {
		t.Errorf("disabled_reason = %v, want never_started", body["disabled_reason"])
	}
}

func TestCapabilitiesWarm(t *testing.T) {
	srv, sup := newTestServer(t)
	defer srv.Close()
	defer sup.Shutdown(context.Background())

	resp, err := http.Get(srv.URL + "/api/v1/ai/capabilities?cluster_id=c1&warm=true")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	if body["ready"] != true {
		t.Errorf("ready = %v, want true", body["ready"])
	}
	if body["capabilities"] == nil {
		t.Errorf("capabilities should be populated after warm")
	}
}
