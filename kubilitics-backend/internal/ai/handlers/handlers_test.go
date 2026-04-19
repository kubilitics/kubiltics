package handlers

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/ai/aiclient"
	"github.com/kubilitics/kubilitics-backend/internal/ai/proxy"

	kotgv1 "github.com/vellankikoti/kotg-schema/gen/go/kotg/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type stubHandlersSrv struct {
	kotgv1.UnimplementedChatServer
	kotgv1.UnimplementedAIControlServer
}

func (s *stubHandlersSrv) Capabilities(_ context.Context, _ *kotgv1.Empty) (*kotgv1.AICapabilities, error) {
	return &kotgv1.AICapabilities{SchemaVersion: "1.0.1", AiVersion: "test"}, nil
}

func (s *stubHandlersSrv) CreateSession(_ context.Context, req *kotgv1.CreateSessionRequest) (*kotgv1.Session, error) {
	return &kotgv1.Session{SessionId: "sess-1", Title: req.GetTitle(), FocusClusterId: req.GetFocusClusterId()}, nil
}

func newHandlerStack(t *testing.T, enabled bool) (*httptest.Server, func()) {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	gsrv := grpc.NewServer()
	stub := &stubHandlersSrv{}
	kotgv1.RegisterChatServer(gsrv, stub)
	kotgv1.RegisterAIControlServer(gsrv, stub)
	go func() { _ = gsrv.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(_ context.Context, _ string) (net.Conn, error) {
			return lis.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	gc := aiclient.NewGRPCClientFromConn(conn)

	// Stub HTTP /status server.
	httpsrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"state":"ready","version":"test","engines":["llm"]}`))
	}))
	hc := aiclient.NewHTTPClient(httpsrv.URL, aiclient.DefaultOpts())

	p := proxy.New(gc, hc, 60)
	h := New(p, Config{Enabled: enabled, ChatMaxDuration: 30 * time.Second})
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	return srv, func() {
		srv.Close()
		httpsrv.Close()
		_ = gc.Close()
		gsrv.Stop()
		_ = lis.Close()
	}
}

func TestStatusEndpoint(t *testing.T) {
	srv, cleanup := newHandlerStack(t, true)
	defer cleanup()

	resp, err := http.Get(srv.URL + "/ai/status")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status code = %d", resp.StatusCode)
	}
	var st map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st["state"] != "ready" {
		t.Errorf("state = %v, want ready", st["state"])
	}
}

func TestStatusWhenAIDisabled(t *testing.T) {
	srv, cleanup := newHandlerStack(t, false)
	defer cleanup()

	resp, _ := http.Get(srv.URL + "/ai/status")
	var st map[string]any
	json.NewDecoder(resp.Body).Decode(&st)
	if st["disabled_reason"] != "ai_disabled" {
		t.Errorf("DisabledReason = %v, want ai_disabled", st["disabled_reason"])
	}
}

func TestCapabilitiesAIDisabled(t *testing.T) {
	srv, cleanup := newHandlerStack(t, false)
	defer cleanup()

	resp, _ := http.Get(srv.URL + "/ai/capabilities?cluster_id=c1")
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
	srv, cleanup := newHandlerStack(t, true)
	defer cleanup()

	resp, _ := http.Get(srv.URL + "/ai/capabilities")
	if resp.StatusCode != 400 {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestCapabilitiesHappy(t *testing.T) {
	srv, cleanup := newHandlerStack(t, true)
	defer cleanup()

	resp, err := http.Get(srv.URL + "/ai/capabilities?cluster_id=c1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	if body["ready"] != true {
		t.Errorf("ready = %v, want true", body["ready"])
	}
	if body["capabilities"] == nil {
		t.Errorf("capabilities should be populated")
	}
}

func TestSessionsRequiresAIEnabled(t *testing.T) {
	srv, cleanup := newHandlerStack(t, false)
	defer cleanup()

	body := strings.NewReader(`{"focus_cluster_id":"c1"}`)
	req, _ := http.NewRequest("POST", srv.URL+"/ai/sessions", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
}

func TestSessionsRejectsMissingCluster(t *testing.T) {
	srv, cleanup := newHandlerStack(t, true)
	defer cleanup()

	body := strings.NewReader(`{}`)
	req, _ := http.NewRequest("POST", srv.URL+"/ai/sessions", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestSessionsHappyPath(t *testing.T) {
	srv, cleanup := newHandlerStack(t, true)
	defer cleanup()

	body := strings.NewReader(`{"focus_cluster_id":"c1","title":"test"}`)
	req, _ := http.NewRequest("POST", srv.URL+"/ai/sessions", body)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got map[string]any
	json.NewDecoder(resp.Body).Decode(&got)
	if got["session_id"] == nil || got["session_id"] == "" {
		t.Errorf("session_id missing in response: %v", got)
	}
}

func TestChatMissingClusterID(t *testing.T) {
	srv, cleanup := newHandlerStack(t, true)
	defer cleanup()

	wsURL := "ws" + srv.URL[len("http"):] + "/ai/chat"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatalf("expected dial failure, got success")
	}
	if resp == nil || resp.StatusCode != 400 {
		t.Fatalf("status = %v, want 400", resp)
	}
}
