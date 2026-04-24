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
