package discovery

import (
	"context"
	"log"

	"github.com/kubilitics/kubilitics-backend/internal/cluster/identity"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
)

const secretDiscoveryLabel = "kubilitics.io/cluster-kubeconfig=true"

// KubernetesSecretSource watches Secrets with a specific label in the
// Kubilitics control-plane namespace. Each such Secret is a kubeconfig
// for a registered downstream cluster (in-cluster Helm mode).
type KubernetesSecretSource struct {
	cs        kubernetes.Interface
	namespace string
}

func NewKubernetesSecretSource(cs kubernetes.Interface, namespace string) *KubernetesSecretSource {
	return &KubernetesSecretSource{cs: cs, namespace: namespace}
}

func (s *KubernetesSecretSource) Name() string { return "secret" }

func (s *KubernetesSecretSource) Enumerate(ctx context.Context) ([]DiscoveredCluster, error) {
	list, err := s.cs.CoreV1().Secrets(s.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: secretDiscoveryLabel,
	})
	if err != nil {
		return nil, err
	}
	out := make([]DiscoveredCluster, 0, len(list.Items))
	for _, sec := range list.Items {
		if c, ok := secretToDiscovered(&sec); ok {
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *KubernetesSecretSource) Watch(ctx context.Context) (<-chan DiscoveryEvent, error) {
	w, err := s.cs.CoreV1().Secrets(s.namespace).Watch(ctx, metav1.ListOptions{
		LabelSelector: secretDiscoveryLabel,
		FieldSelector: fields.Everything().String(),
	})
	if err != nil {
		return nil, err
	}
	out := make(chan DiscoveryEvent, 32)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				w.Stop()
				return
			case ev, ok := <-w.ResultChan():
				if !ok {
					return
				}
				sec, ok := ev.Object.(*corev1.Secret)
				if !ok {
					continue
				}
				cluster, ok := secretToDiscovered(sec)
				if !ok {
					continue
				}
				var kind EventKind
				switch ev.Type {
				case watch.Added:
					kind = EventAdd
				case watch.Modified:
					kind = EventUpdate
				case watch.Deleted:
					kind = EventRemove
				default:
					continue
				}
				select {
				case out <- DiscoveryEvent{Kind: kind, Cluster: cluster}:
				case <-ctx.Done():
					w.Stop()
					return
				}
			}
		}
	}()
	return out, nil
}

func secretToDiscovered(s *corev1.Secret) (DiscoveredCluster, bool) {
	name := s.Annotations["kubilitics.io/cluster-name"]
	server := s.Annotations["kubilitics.io/cluster-server-url"]
	if name == "" || server == "" {
		log.Printf("secret %s/%s missing name/server annotations, skipping", s.Namespace, s.Name)
		return DiscoveredCluster{}, false
	}
	return DiscoveredCluster{
		Identity:    identity.LogicalIdentity{Name: name, ServerURL: server},
		Source:      "secret",
		ContextName: name,
	}, true
}
