package discovery

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

type fakeSource struct {
	clusters []DiscoveredCluster
	events   chan DiscoveryEvent
}

func (f *fakeSource) Name() string { return "fake" }
func (f *fakeSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	return f.clusters, nil
}
func (f *fakeSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	return f.events, nil
}

func TestDiscoveryEvent_AllKinds(t *testing.T) {
	for _, k := range []EventKind{EventAdd, EventUpdate, EventRemove} {
		evt := DiscoveryEvent{Kind: k, Cluster: DiscoveredCluster{
			Identity: identity.LogicalIdentity{Name: "c1", ServerURL: "https://x"},
			Source:   "test",
		}}
		if evt.Kind == "" {
			t.Fatalf("kind %q serialized to empty", k)
		}
	}
}

func TestDiscoverySource_InterfaceShape(t *testing.T) {
	var s DiscoverySource = &fakeSource{
		clusters: []DiscoveredCluster{
			{Identity: identity.LogicalIdentity{Name: "a", ServerURL: "https://x"}, Source: "fake"},
		},
		events: make(chan DiscoveryEvent, 1),
	}
	got, err := s.Enumerate(context.Background())
	if err != nil || len(got) != 1 {
		t.Fatalf("enumerate: %+v err=%v", got, err)
	}
	ch, err := s.Watch(context.Background())
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	select {
	case <-ch:
	case <-time.After(10 * time.Millisecond):
	}
}
