package discovery

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
	"k8s.io/client-go/tools/clientcmd"
)

// KubeconfigFileSource reads cluster contexts from one or more kubeconfig
// files. In Phase 2.3 we add an fsnotify-backed Watch() for live updates.
type KubeconfigFileSource struct {
	paths []string
}

// NewKubeconfigFileSource takes an ordered list of kubeconfig paths (KUBECONFIG
// env is colon-split by caller). Missing files are silently skipped;
// malformed YAML in a present file bubbles up as an error.
func NewKubeconfigFileSource(paths []string) *KubeconfigFileSource {
	return &KubeconfigFileSource{paths: paths}
}

func (s *KubeconfigFileSource) Name() string { return "kubeconfig" }

func (s *KubeconfigFileSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	var out []DiscoveredCluster
	seen := make(map[string]bool) // dedupe by LogicalIdentity.Key()

	for _, p := range s.paths {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return nil, fmt.Errorf("stat %s: %w", p, err)
		}
		cfg, err := clientcmd.LoadFromFile(p)
		if err != nil {
			return nil, fmt.Errorf("load %s: %w", p, err)
		}
		for ctxName, kctx := range cfg.Contexts {
			cluster, ok := cfg.Clusters[kctx.Cluster]
			if !ok || cluster == nil {
				continue
			}
			id := identity.LogicalIdentity{
				Name:      ctxName,
				ServerURL: cluster.Server,
			}
			if seen[id.Key()] {
				continue
			}
			seen[id.Key()] = true
			out = append(out, DiscoveredCluster{
				Identity:       id,
				Source:         s.Name(),
				ContextName:    ctxName,
				KubeconfigPath: p,
			})
		}
	}
	return out, nil
}

func (s *KubeconfigFileSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("fsnotify: %w", err)
	}
	for _, p := range s.paths {
		// Watch the containing directory — editors like vim rename-on-save,
		// which would drop a direct file watcher.
		if err := w.Add(filepath.Dir(p)); err != nil {
			// Non-fatal: dir might not exist yet. Best effort.
			log.Printf("kubeconfig watcher: add %s: %v", p, err)
		}
	}

	out := make(chan DiscoveryEvent, 32)
	go func() {
		defer close(out)
		defer func() { _ = w.Close() }()

		prev, _ := s.Enumerate(ctx)
		prevByKey := byKey(prev)

		var debounce *time.Timer
		for {
			select {
			case <-ctx.Done():
				return
			case ev := <-w.Events:
				if !s.isRelevant(ev.Name) {
					continue
				}
				if debounce != nil {
					debounce.Stop()
				}
				debounce = time.AfterFunc(500*time.Millisecond, func() {
					curr, err := s.Enumerate(ctx)
					if err != nil {
						log.Printf("kubeconfig watcher: re-enumerate: %v", err)
						return
					}
					currByKey := byKey(curr)
					for k, c := range currByKey {
						if _, had := prevByKey[k]; !had {
							select {
							case out <- DiscoveryEvent{Kind: EventAdd, Cluster: c}:
							case <-ctx.Done():
								return
							}
						}
					}
					for k, c := range prevByKey {
						if _, still := currByKey[k]; !still {
							select {
							case out <- DiscoveryEvent{Kind: EventRemove, Cluster: c}:
							case <-ctx.Done():
								return
							}
						}
					}
					prevByKey = currByKey
				})
			case err := <-w.Errors:
				log.Printf("kubeconfig watcher: %v", err)
			}
		}
	}()
	return out, nil
}

func (s *KubeconfigFileSource) isRelevant(path string) bool {
	for _, p := range s.paths {
		if path == p {
			return true
		}
	}
	return false
}

func byKey(cs []DiscoveredCluster) map[string]DiscoveredCluster {
	m := make(map[string]DiscoveredCluster, len(cs))
	for _, c := range cs {
		m[c.Identity.Key()] = c
	}
	return m
}
