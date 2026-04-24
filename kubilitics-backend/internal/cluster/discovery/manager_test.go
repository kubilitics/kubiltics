package discovery

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

func TestManager_SnapshotDedupesAcrossSources(t *testing.T) {
	a := &fakeSource{clusters: []DiscoveredCluster{
		{Identity: identity.LogicalIdentity{Name: "prod", ServerURL: "https://x"}, Source: "kubeconfig"},
	}}
	b := &fakeSource{clusters: []DiscoveredCluster{
		{Identity: identity.LogicalIdentity{Name: "prod", ServerURL: "https://x/"}, Source: "secret"},
	}}
	m := NewManager([]DiscoverySource{a, b})
	if err := m.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	snap := m.Snapshot()
	if len(snap.Discovered) != 1 {
		t.Fatalf("dedup failed: %+v", snap.Discovered)
	}
	if snap.Discovered[0].Source != "kubeconfig" {
		t.Fatalf("expected first-wins (kubeconfig); got %q", snap.Discovered[0].Source)
	}
}

// Task A regression: a DiscoveredCluster carrying SessionID must be
// promoted into presence.RegisteredCluster with SessionID + Provider
// preserved. Discovered-only entries (no SessionID) appear in Discovered
// but NOT in Registered.
func TestManager_SnapshotPromotesManualSourceToRegistered(t *testing.T) {
	src := &fakeSource{clusters: []DiscoveredCluster{
		{
			Identity:  identity.LogicalIdentity{Name: "prod", ServerURL: "https://prod"},
			Source:    "manual",
			SessionID: "uuid-prod",
			Provider:  "eks",
		},
		{
			Identity: identity.LogicalIdentity{Name: "dev", ServerURL: "https://dev"},
			Source:   "kubeconfig",
			// no SessionID — file-sourced only, not yet registered.
		},
	}}
	m := NewManager([]DiscoverySource{src})
	if err := m.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	snap := m.Snapshot()
	if len(snap.Discovered) != 2 {
		t.Fatalf("both entries must appear in discovered: %+v", snap.Discovered)
	}
	if len(snap.Registered) != 1 {
		t.Fatalf("only the manual entry with SessionID should be promoted: %+v", snap.Registered)
	}
	if snap.Registered[0].SessionID != "uuid-prod" {
		t.Fatalf("SessionID not promoted: %q", snap.Registered[0].SessionID)
	}
	if snap.Registered[0].Provider != "eks" {
		t.Fatalf("Provider not promoted: %q", snap.Registered[0].Provider)
	}
	if snap.Registered[0].Identity.Name != "prod" {
		t.Fatalf("identity not promoted: %+v", snap.Registered[0].Identity)
	}
}

func TestManager_WatchFansInFromSources(t *testing.T) {
	a := &fakeSource{events: make(chan DiscoveryEvent, 4)}
	m := NewManager([]DiscoverySource{a})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events := m.Events(ctx)
	a.events <- DiscoveryEvent{Kind: EventAdd, Cluster: DiscoveredCluster{
		Identity: identity.LogicalIdentity{Name: "c1", ServerURL: "https://c1"}, Source: "fake",
	}}
	select {
	case e := <-events:
		if e.Kind != EventAdd || e.Cluster.Identity.Name != "c1" {
			t.Fatalf("unexpected: %+v", e)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("event not forwarded within 500ms")
	}
}
