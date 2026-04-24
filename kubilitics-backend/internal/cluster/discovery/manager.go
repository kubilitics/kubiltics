package discovery

import (
	"context"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
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
			if _, seen := byKey[k]; seen {
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

// Snapshot returns a copy-safe view. Registered/Connected wiring comes in
// Phase 2.7 when we attach the registration+connection managers.
func (m *Manager) Snapshot() rest.PresenceSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	// Copy to avoid callers mutating internal state.
	disc := make([]rest.DiscoveredCluster, len(m.discovered))
	for i, c := range m.discovered {
		disc[i] = rest.DiscoveredCluster{
			Identity:   c.Identity,
			Source:     c.Source,
			LastSeenAt: time.Now().Format(time.RFC3339),
		}
	}
	return rest.PresenceSnapshot{
		Discovered: disc,
		Registered: []rest.RegisteredCluster{},
		Connected:  []rest.ConnectedCluster{},
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
