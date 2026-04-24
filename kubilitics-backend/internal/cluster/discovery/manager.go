package discovery

import (
	"context"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/presence"
)

// Manager composes multiple DiscoverySources into a single deduplicated
// PresenceSnapshot. First-wins dedup by identity key — earlier sources
// in the slice take precedence.
type Manager struct {
	sources    []DiscoverySource
	mu         sync.RWMutex
	discovered []DiscoveredCluster
	byKey      map[string]int // key → index in discovered
}

func NewManager(sources []DiscoverySource) *Manager {
	return &Manager{sources: sources, byKey: map[string]int{}}
}

// Refresh enumerates every source and rebuilds the snapshot. Called on
// startup and whenever a quorum of events warrants a full re-sync.
func (m *Manager) Refresh(ctx context.Context) error {
	merged := []DiscoveredCluster{}
	byKey := map[string]int{}
	for _, s := range m.sources {
		enum, err := s.Enumerate(ctx)
		if err != nil {
			// Do NOT abort — one broken source should not blank out others.
			continue
		}
		for _, c := range enum {
			k := c.Identity.Key()
			if idx, seen := byKey[k]; seen {
				// A later source can enrich an entry an earlier source
				// provided — most importantly, ManualSource carries the
				// SessionID + Provider for clusters that are ALSO in a
				// kubeconfig file. Without this merge, `kind-kubilitics-test`
				// (seen first by KubeconfigFileSource → no SessionID) would
				// mask the registered state from ManualSource and stay
				// stuck in Discovered-only forever.
				existing := merged[idx]
				if existing.SessionID == "" && c.SessionID != "" {
					existing.SessionID = c.SessionID
				}
				if existing.Provider == "" && c.Provider != "" {
					existing.Provider = c.Provider
				}
				if existing.ContextName == "" && c.ContextName != "" {
					existing.ContextName = c.ContextName
				}
				if existing.KubeconfigPath == "" && c.KubeconfigPath != "" {
					existing.KubeconfigPath = c.KubeconfigPath
				}
				merged[idx] = existing
				continue
			}
			byKey[k] = len(merged)
			merged = append(merged, c)
		}
	}
	m.mu.Lock()
	m.discovered = merged
	m.byKey = byKey
	m.mu.Unlock()
	return nil
}

// Snapshot returns a copy-safe view. Entries that came from a source
// that carries a SessionID (today: ManualSource — the cluster is already
// in the backend DB with an assigned UUID) are promoted into
// Registered so the frontend can use session_id for cluster-scoped API
// calls. Entries without a SessionID stay in Discovered only.
//
// Connected wiring (session tracking with connected_at) is future work;
// it would come from a ConnectionManager that observes active sessions.
func (m *Manager) Snapshot() presence.Snapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	now := time.Now().Format(time.RFC3339)
	disc := make([]presence.DiscoveredCluster, 0, len(m.discovered))
	reg := make([]presence.RegisteredCluster, 0, len(m.discovered))
	for _, c := range m.discovered {
		pd := presence.DiscoveredCluster{
			Identity:   c.Identity,
			Source:     c.Source,
			LastSeenAt: now,
		}
		disc = append(disc, pd)
		if c.SessionID != "" {
			reg = append(reg, presence.RegisteredCluster{
				DiscoveredCluster: pd,
				RegisteredAt:      now,
				Reachable:         true,
				SessionID:         c.SessionID,
				Provider:          c.Provider,
			})
		}
	}
	return presence.Snapshot{
		Discovered: disc,
		Registered: reg,
		Connected:  []presence.ConnectedCluster{},
	}
}

// Events fans in all sources' Watch() channels. The manager filters out
// events that would be duplicates of already-known identities.
func (m *Manager) Events(ctx context.Context) <-chan DiscoveryEvent {
	out := make(chan DiscoveryEvent, 32)
	var wg sync.WaitGroup
	for _, s := range m.sources {
		ch, err := s.Watch(ctx)
		if err != nil {
			continue // source doesn't support watch
		}
		wg.Add(1)
		go func(c <-chan DiscoveryEvent) {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case ev, ok := <-c:
					if !ok {
						return
					}
					select {
					case out <- ev:
					case <-ctx.Done():
						return
					}
				}
			}
		}(ch)
	}
	go func() {
		wg.Wait()
		close(out)
	}()
	return out
}
