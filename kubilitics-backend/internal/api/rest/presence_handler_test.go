package rest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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

// presenceHandlerTest_UnusedImport ensures http import is referenced even if
// the test shape changes; Go's unused-import rule is strict.
var _ = http.StatusOK
