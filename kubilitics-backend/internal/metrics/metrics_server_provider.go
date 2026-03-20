// MetricsServerProvider implements MetricsProvider using the Kubernetes metrics-server API.
// This is the primary implementation; Prometheus/OTel providers can be added later.
package metrics

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

func formatCPU(millicores float64) string {
	return fmt.Sprintf("%.2fm", millicores)
}
func formatMemoryMi(mi float64) string {
	return fmt.Sprintf("%.2fMi", mi)
}

// MetricsServerProvider fetches pod/node usage from metrics.k8s.io/v1beta1.
type MetricsServerProvider struct{}

// NewMetricsServerProvider returns the default in-cluster metrics provider.
func NewMetricsServerProvider() *MetricsServerProvider {
	return &MetricsServerProvider{}
}

// GetPodUsage returns current CPU/memory for the given pod.
func (p *MetricsServerProvider) GetPodUsage(ctx context.Context, client *k8s.Client, namespace, podName string) (*models.PodUsage, error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("metrics client: %w", err)
	}
	pm, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("pod metrics: %w", err)
	}
	var totalCPUMilli, totalMemoryMi float64
	containers := make([]models.ContainerUsage, 0, len(pm.Containers))
	for _, c := range pm.Containers {
		cpuMilli := c.Usage.Cpu().AsApproximateFloat64() * 1000
		memMi := float64(c.Usage.Memory().Value()) / (1024 * 1024)
		totalCPUMilli += cpuMilli
		totalMemoryMi += memMi
		containers = append(containers, models.ContainerUsage{
			Name:   c.Name,
			CPU:    formatCPU(cpuMilli),
			Memory: formatMemoryMi(memMi),
		})
	}
	return &models.PodUsage{
		Name:       podName,
		Namespace:  namespace,
		CPU:        formatCPU(totalCPUMilli),
		Memory:     formatMemoryMi(totalMemoryMi),
		Containers: containers,
	}, nil
}

// GetNodeUsage returns current CPU and memory for the given node.
func (p *MetricsServerProvider) GetNodeUsage(ctx context.Context, client *k8s.Client, nodeName string) (cpu, memory string, err error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return "", "", fmt.Errorf("metrics client: %w", err)
	}
	nm, err := metricsClient.MetricsV1beta1().NodeMetricses().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return "", "", fmt.Errorf("node metrics: %w", err)
	}
	cpuMilli := nm.Usage.Cpu().AsApproximateFloat64() * 1000
	memMi := float64(nm.Usage.Memory().Value()) / (1024 * 1024)
	return formatCPU(cpuMilli), formatMemoryMi(memMi), nil
}
