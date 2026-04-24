package discovery

import (
	"context"
	"fmt"
	"os"

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

// Watch is implemented in Phase 2.3.
func (s *KubeconfigFileSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	return nil, ErrNotSupported
}
