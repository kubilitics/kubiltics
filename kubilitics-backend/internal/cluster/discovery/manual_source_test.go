package discovery

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// fakeClusterDB implements the subset of ClusterRepository the source needs.
type fakeClusterDB struct {
	clusters []StoredCluster
}

func (f *fakeClusterDB) ListAll() ([]StoredCluster, error) {
	return f.clusters, nil
}

func TestManualSource_Enumerate(t *testing.T) {
	db := &fakeClusterDB{clusters: []StoredCluster{
		{Name: "a", ServerURL: "https://a"},
		{Name: "b", ServerURL: "https://b"},
	}}
	s := NewManualSource(db)
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enum: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2: %+v", got)
	}
	want := identity.LogicalIdentity{Name: "a", ServerURL: "https://a"}
	if !got[0].Identity.Equal(want) {
		t.Fatalf("identity mismatch: %+v", got[0].Identity)
	}
}

func TestManualSource_WatchEmitsOnNotify(t *testing.T) {
	db := &fakeClusterDB{}
	s := NewManualSource(db)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch, _ := s.Watch(ctx)
	c := StoredCluster{Name: "new", ServerURL: "https://new"}
	s.NotifyAdd(c)
	select {
	case ev := <-ch:
		if ev.Kind != EventAdd || ev.Cluster.Identity.Name != "new" {
			t.Fatalf("unexpected: %+v", ev)
		}
	}
}

// Task A regression: SessionID + Provider must propagate from the stored
// cluster row through Enumerate. These become the UUID used by cluster-
// scoped APIs and the provider chip respectively.
func TestManualSource_EnumerateCarriesSessionIDAndProvider(t *testing.T) {
	db := &fakeClusterDB{clusters: []StoredCluster{
		{Name: "prod", ServerURL: "https://prod", SessionID: "uuid-123", Provider: "eks"},
	}}
	s := NewManualSource(db)
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enum: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 entry: %+v", got)
	}
	if got[0].SessionID != "uuid-123" {
		t.Fatalf("SessionID not propagated: %q", got[0].SessionID)
	}
	if got[0].Provider != "eks" {
		t.Fatalf("Provider not propagated: %q", got[0].Provider)
	}
}

// Task A regression: NotifyAdd must also emit SessionID + Provider so
// SSE consumers (the frontend presence store) see the full shape, not
// just the logical identity.
func TestManualSource_WatchEmitsSessionIDAndProvider(t *testing.T) {
	db := &fakeClusterDB{}
	s := NewManualSource(db)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch, _ := s.Watch(ctx)
	s.NotifyAdd(StoredCluster{
		Name: "new", ServerURL: "https://new",
		SessionID: "uuid-789", Provider: "kind",
	})
	ev := <-ch
	if ev.Cluster.SessionID != "uuid-789" || ev.Cluster.Provider != "kind" {
		t.Fatalf("SessionID/Provider lost in event: %+v", ev.Cluster)
	}
	_ = identity.LogicalIdentity{} // keep identity import used
}
