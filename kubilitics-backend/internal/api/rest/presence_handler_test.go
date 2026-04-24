package rest

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/discovery"
	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

func TestPresenceEndpoint_InitialSnapshotShape(t *testing.T) {
	h := NewPresenceHandler(&nullDiscoveryManager{})
	req := httptest.NewRequest("GET", "/api/v1/presence", nil)
	rec := httptest.NewRecorder()
	h.GetSnapshot(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	var snap PresenceSnapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if snap.Discovered == nil {
		t.Fatal("discovered must be []DiscoveredCluster not null")
	}
	if snap.Registered == nil {
		t.Fatal("registered must be [] not null")
	}
	if snap.Connected == nil {
		t.Fatal("connected must be [] not null")
	}
}

// nullDiscoveryManager is a placeholder used until Phase 2 wires the real one.
type nullDiscoveryManager struct{}

func (n *nullDiscoveryManager) Snapshot() PresenceSnapshot {
	return PresenceSnapshot{
		Discovered: []DiscoveredCluster{},
		Registered: []RegisteredCluster{},
		Connected:  []ConnectedCluster{},
	}
}

func (n *nullDiscoveryManager) Events(ctx context.Context) <-chan discovery.DiscoveryEvent {
	ch := make(chan discovery.DiscoveryEvent)
	close(ch)
	return ch
}

// stubStreamer satisfies DiscoveryManager and forwards injected events on
// the provided channel. Used by TestPresenceSSE_ForwardsEvents.
type stubStreamer struct {
	events chan discovery.DiscoveryEvent
}

func (s *stubStreamer) Snapshot() PresenceSnapshot {
	return PresenceSnapshot{
		Discovered: []DiscoveredCluster{},
		Registered: []RegisteredCluster{},
		Connected:  []ConnectedCluster{},
	}
}

func (s *stubStreamer) Events(ctx context.Context) <-chan discovery.DiscoveryEvent {
	return s.events
}

func TestPresenceSSE_ForwardsEvents(t *testing.T) {
	mgr := &stubStreamer{events: make(chan discovery.DiscoveryEvent, 4)}
	h := NewPresenceHandler(mgr)
	srv := httptest.NewServer(http.HandlerFunc(h.StreamEvents))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("sse: %v", err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("expected SSE content-type, got %q", resp.Header.Get("Content-Type"))
	}

	// Inject an event.
	mgr.events <- discovery.DiscoveryEvent{
		Kind: discovery.EventAdd,
		Cluster: discovery.DiscoveredCluster{
			Identity: identity.LogicalIdentity{Name: "c1", ServerURL: "https://c1"},
		},
	}

	scanner := bufio.NewScanner(resp.Body)
	seen := false
	deadline := time.After(2 * time.Second)
	for !seen {
		select {
		case <-deadline:
			t.Fatal("no SSE frame within 2s")
		default:
			if scanner.Scan() && strings.HasPrefix(scanner.Text(), "data: ") {
				seen = true
			}
		}
	}
}

// presenceHandlerTest_UnusedImport ensures http import is referenced even if
// the test shape changes; Go's unused-import rule is strict.
var _ = http.StatusOK
