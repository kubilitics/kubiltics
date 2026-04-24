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
