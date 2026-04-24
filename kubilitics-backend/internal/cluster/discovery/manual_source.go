package discovery

import (
	"context"
	"sync"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
)

// StoredCluster is the minimum shape from the cluster DB that this
// source needs. Decouples from the full Cluster model.
//
// SessionID and Provider are carried through to the presence snapshot so
// the frontend can (a) use SessionID as the UUID for cluster-scoped API
// calls without keeping a second store, and (b) render cloud-provider
// chips without a second lookup.
type StoredCluster struct {
	Name      string
	ServerURL string
	SessionID string
	Provider  string
}

// ClusterRepository is the read port onto the cluster DB.
type ClusterRepository interface {
	ListAll() ([]StoredCluster, error)
}

// ManualSource tracks clusters registered via POST /api/v1/clusters.
// Unlike the file/secret sources, updates come from explicit NotifyAdd /
// NotifyRemove calls driven by the AddCluster/DeleteCluster HTTP handlers.
type ManualSource struct {
	db   ClusterRepository
	mu   sync.Mutex
	subs []chan DiscoveryEvent
}

func NewManualSource(db ClusterRepository) *ManualSource {
	return &ManualSource{db: db}
}

func (s *ManualSource) Name() string { return "manual" }

func (s *ManualSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	rows, err := s.db.ListAll()
	if err != nil {
		return nil, err
	}
	out := make([]DiscoveredCluster, 0, len(rows))
	for _, r := range rows {
		out = append(out, DiscoveredCluster{
			Identity:  identity.LogicalIdentity{Name: r.Name, ServerURL: r.ServerURL},
			Source:    s.Name(),
			SessionID: r.SessionID,
			Provider:  r.Provider,
		})
	}
	return out, nil
}

func (s *ManualSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	ch := make(chan DiscoveryEvent, 16)
	s.mu.Lock()
	s.subs = append(s.subs, ch)
	s.mu.Unlock()
	go func() {
		<-ctx.Done()
		s.mu.Lock()
		defer s.mu.Unlock()
		for i, c := range s.subs {
			if c == ch {
				s.subs = append(s.subs[:i], s.subs[i+1:]...)
				close(ch)
				break
			}
		}
	}()
	return ch, nil
}

// NotifyAdd is called by the AddCluster HTTP handler.
func (s *ManualSource) NotifyAdd(c StoredCluster) {
	s.emit(EventAdd, c)
}

// NotifyRemove is called by the DeleteCluster HTTP handler.
func (s *ManualSource) NotifyRemove(c StoredCluster) {
	s.emit(EventRemove, c)
}

func (s *ManualSource) emit(kind EventKind, c StoredCluster) {
	evt := DiscoveryEvent{
		Kind: kind,
		Cluster: DiscoveredCluster{
			Identity:  identity.LogicalIdentity{Name: c.Name, ServerURL: c.ServerURL},
			Source:    s.Name(),
			SessionID: c.SessionID,
			Provider:  c.Provider,
		},
	}
	s.mu.Lock()
	subs := append([]chan DiscoveryEvent(nil), s.subs...)
	s.mu.Unlock()
	for _, ch := range subs {
		select {
		case ch <- evt:
		default:
		}
	}
}
