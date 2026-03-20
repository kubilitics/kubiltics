// Package metrics provides the metrics domain layer: provider abstraction,
// controller resolution, and caching. All metrics queries flow through ResourceIdentity.
package metrics

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// MetricsProvider abstracts the metrics source (Metrics Server today; Prometheus/OTel later).
// Implementations fetch raw usage only; they do not resolve controllers to pods.
type MetricsProvider interface {
	// GetPodUsage returns current CPU/memory for a single pod from the cluster.
	// Returns error if metrics-server is unavailable or pod has no metrics yet.
	GetPodUsage(ctx context.Context, client *k8s.Client, namespace, podName string) (*models.PodUsage, error)
	// GetNodeUsage returns current CPU/memory for a node.
	GetNodeUsage(ctx context.Context, client *k8s.Client, nodeName string) (cpu, memory string, err error)
}
