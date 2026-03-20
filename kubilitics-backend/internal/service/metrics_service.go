package service

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
)

// ClusterUtilization holds aggregated cluster-wide CPU/memory usage and capacity.
type ClusterUtilization struct {
	CPUUsedCores    float64
	MemoryUsedGiB   float64
	CPUCapacityCores float64
	MemoryCapacityGiB float64
}

// MetricsService provides access to cluster metrics
type MetricsService interface {
	GetPodMetrics(ctx context.Context, clusterID, namespace, podName string) (*PodMetrics, error)
	GetNodeMetrics(ctx context.Context, clusterID, nodeName string) (*NodeMetrics, error)
	GetClusterUtilization(ctx context.Context, clusterID string) (*ClusterUtilization, error)
	GetClusterUtilizationWithClient(ctx context.Context, client *k8s.Client) (*ClusterUtilization, error)
	GetNamespaceMetrics(ctx context.Context, clusterID, namespace string) (*NamespaceMetrics, error)
	GetNamespaceMetricsWithClient(ctx context.Context, client *k8s.Client, namespace string) (*NamespaceMetrics, error)
	GetDeploymentMetrics(ctx context.Context, clusterID, namespace, deploymentName string) (*DeploymentMetrics, error)
	GetDeploymentMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, deploymentName string) (*DeploymentMetrics, error)
	GetReplicaSetMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error)
	GetReplicaSetMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error)
	GetStatefulSetMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error)
	GetStatefulSetMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error)
	GetDaemonSetMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error)
	GetDaemonSetMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error)
	GetJobMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error)
	GetJobMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error)
	GetCronJobMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error)
	GetCronJobMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error)
	GetPodMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, podName string) (*PodMetrics, error)
	GetNodeMetricsWithClient(ctx context.Context, client *k8s.Client, nodeName string) (*NodeMetrics, error)
}

type metricsService struct {
	clusterService *clusterService
}

// ContainerMetrics holds per-container CPU/memory usage.
type ContainerMetrics struct {
	Name   string `json:"name"`
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
}

type PodMetrics struct {
	Name       string             `json:"name"`
	Namespace  string             `json:"namespace"`
	CPU        string             `json:"CPU"`
	Memory     string             `json:"Memory"`
	Containers []ContainerMetrics `json:"containers,omitempty"`
}

type NodeMetrics struct {
	Name   string
	CPU    string
	Memory string
}

type NamespaceMetrics struct {
	Namespace   string
	PodCount    int
	TotalCPU    string
	TotalMemory string
}

// DeploymentMetrics holds aggregated metrics for a deployment's pods plus per-pod breakdown.
type DeploymentMetrics struct {
	DeploymentName string        `json:"deploymentName"`
	Namespace      string        `json:"namespace"`
	PodCount       int           `json:"podCount"`
	TotalCPU       string        `json:"totalCPU"`
	TotalMemory    string        `json:"totalMemory"`
	Pods           []PodMetrics  `json:"pods"`
}

// NewMetricsService creates a new metrics service
func NewMetricsService(cs ClusterService) MetricsService {
	return &metricsService{
		clusterService: cs.(*clusterService),
	}
}

// formatCPUUsage formats millicores with 2 decimal places (e.g. "2.79m", "37.00m") for list/detail display.
func formatCPUUsage(millicores float64) string {
	return fmt.Sprintf("%.2fm", millicores)
}

// formatMemoryUsageMi formats mebibytes with 2 decimal places (e.g. "35.60Mi", "28.00Mi") for list/detail display.
func formatMemoryUsageMi(mi float64) string {
	return fmt.Sprintf("%.2fMi", mi)
}

func (s *metricsService) GetPodMetrics(ctx context.Context, clusterID, namespace, podName string) (*PodMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	podMetrics, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod metrics: %w", err)
	}

	var totalCPUMilli, totalMemoryMi float64
	containers := make([]ContainerMetrics, 0, len(podMetrics.Containers))
	for _, c := range podMetrics.Containers {
		cpuCores := c.Usage.Cpu().AsApproximateFloat64()
		cpuMilli := cpuCores * 1000
		memBytes := float64(c.Usage.Memory().Value())
		memMi := memBytes / (1024 * 1024)
		totalCPUMilli += cpuMilli
		totalMemoryMi += memMi
		containers = append(containers, ContainerMetrics{
			Name:   c.Name,
			CPU:    formatCPUUsage(cpuMilli),
			Memory: formatMemoryUsageMi(memMi),
		})
	}

	return &PodMetrics{
		Name:       podName,
		Namespace:  namespace,
		CPU:        formatCPUUsage(totalCPUMilli),
		Memory:     formatMemoryUsageMi(totalMemoryMi),
		Containers: containers,
	}, nil
}

func (s *metricsService) GetPodMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, podName string) (*PodMetrics, error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	podMetrics, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod metrics: %w", err)
	}
	var totalCPUMilli, totalMemoryMi float64
	containers := make([]ContainerMetrics, 0, len(podMetrics.Containers))
	for _, c := range podMetrics.Containers {
		cpuCores := c.Usage.Cpu().AsApproximateFloat64()
		cpuMilli := cpuCores * 1000
		memBytes := float64(c.Usage.Memory().Value())
		memMi := memBytes / (1024 * 1024)
		totalCPUMilli += cpuMilli
		totalMemoryMi += memMi
		containers = append(containers, ContainerMetrics{
			Name:   c.Name,
			CPU:    formatCPUUsage(cpuMilli),
			Memory: formatMemoryUsageMi(memMi),
		})
	}
	return &PodMetrics{
		Name:       podName,
		Namespace:  namespace,
		CPU:        formatCPUUsage(totalCPUMilli),
		Memory:     formatMemoryUsageMi(totalMemoryMi),
		Containers: containers,
	}, nil
}

func (s *metricsService) GetNodeMetrics(ctx context.Context, clusterID, nodeName string) (*NodeMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	nodeMetrics, err := metricsClient.MetricsV1beta1().NodeMetricses().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get node metrics: %w", err)
	}

	cpuCores := nodeMetrics.Usage.Cpu().AsApproximateFloat64()
	memMi := float64(nodeMetrics.Usage.Memory().Value()) / (1024 * 1024)
	return &NodeMetrics{
		Name:   nodeName,
		CPU:    formatCPUUsage(cpuCores * 1000),
		Memory: formatMemoryUsageMi(memMi),
	}, nil
}

func (s *metricsService) GetNodeMetricsWithClient(ctx context.Context, client *k8s.Client, nodeName string) (*NodeMetrics, error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	nodeMetrics, err := metricsClient.MetricsV1beta1().NodeMetricses().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get node metrics: %w", err)
	}
	cpuCores := nodeMetrics.Usage.Cpu().AsApproximateFloat64()
	memMi := float64(nodeMetrics.Usage.Memory().Value()) / (1024 * 1024)
	return &NodeMetrics{
		Name:   nodeName,
		CPU:    formatCPUUsage(cpuCores * 1000),
		Memory: formatMemoryUsageMi(memMi),
	}, nil
}

// GetClusterUtilization returns aggregated cluster-wide CPU/memory usage and capacity.
// Returns nil when Metrics Server is unavailable.
func (s *metricsService) GetClusterUtilization(ctx context.Context, clusterID string) (*ClusterUtilization, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	nodeMetricsList, err := metricsClient.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list node metrics: %w", err)
	}

	nodeList, err := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}

	usageByNode := make(map[string]struct{ cpuCores, memGiB float64 })
	for _, nm := range nodeMetricsList.Items {
		cpuCores := nm.Usage.Cpu().AsApproximateFloat64()
		memGiB := float64(nm.Usage.Memory().Value()) / (1024 * 1024 * 1024)
		usageByNode[nm.Name] = struct{ cpuCores, memGiB float64 }{cpuCores, memGiB}
	}

	var cpuUsed, memUsed, cpuCap, memCap float64
	for _, node := range nodeList.Items {
		cpuAlloc := node.Status.Allocatable[corev1.ResourceCPU]
		memAlloc := node.Status.Allocatable[corev1.ResourceMemory]
		cpuCap += cpuAlloc.AsApproximateFloat64()
		memCap += float64(memAlloc.Value()) / (1024 * 1024 * 1024)

		if u, ok := usageByNode[node.Name]; ok {
			cpuUsed += u.cpuCores
			memUsed += u.memGiB
		}
	}

	return &ClusterUtilization{
		CPUUsedCores:       cpuUsed,
		MemoryUsedGiB:      memUsed,
		CPUCapacityCores:   cpuCap,
		MemoryCapacityGiB: memCap,
	}, nil
}

// GetClusterUtilizationWithClient returns aggregated cluster-wide CPU/memory using the given client (Headlamp/Lens model).
func (s *metricsService) GetClusterUtilizationWithClient(ctx context.Context, client *k8s.Client) (*ClusterUtilization, error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	nodeMetricsList, err := metricsClient.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list node metrics: %w", err)
	}
	nodeList, err := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}
	usageByNode := make(map[string]struct{ cpuCores, memGiB float64 })
	for _, nm := range nodeMetricsList.Items {
		cpuCores := nm.Usage.Cpu().AsApproximateFloat64()
		memGiB := float64(nm.Usage.Memory().Value()) / (1024 * 1024 * 1024)
		usageByNode[nm.Name] = struct{ cpuCores, memGiB float64 }{cpuCores, memGiB}
	}
	var cpuUsed, memUsed, cpuCap, memCap float64
	for _, node := range nodeList.Items {
		cpuAlloc := node.Status.Allocatable[corev1.ResourceCPU]
		memAlloc := node.Status.Allocatable[corev1.ResourceMemory]
		cpuCap += cpuAlloc.AsApproximateFloat64()
		memCap += float64(memAlloc.Value()) / (1024 * 1024 * 1024)
		if u, ok := usageByNode[node.Name]; ok {
			cpuUsed += u.cpuCores
			memUsed += u.memGiB
		}
	}
	return &ClusterUtilization{
		CPUUsedCores:        cpuUsed,
		MemoryUsedGiB:       memUsed,
		CPUCapacityCores:    cpuCap,
		MemoryCapacityGiB:  memCap,
	}, nil
}

func (s *metricsService) GetNamespaceMetrics(ctx context.Context, clusterID, namespace string) (*NamespaceMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	podMetricsList, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list pod metrics: %w", err)
	}

	var totalCPUMilli, totalMemoryMi float64
	for _, podMetrics := range podMetricsList.Items {
		for _, container := range podMetrics.Containers {
			totalCPUMilli += container.Usage.Cpu().AsApproximateFloat64() * 1000
			totalMemoryMi += float64(container.Usage.Memory().Value()) / (1024 * 1024)
		}
	}

	return &NamespaceMetrics{
		Namespace:   namespace,
		PodCount:    len(podMetricsList.Items),
		TotalCPU:    formatCPUUsage(totalCPUMilli),
		TotalMemory: formatMemoryUsageMi(totalMemoryMi),
	}, nil
}

func (s *metricsService) GetNamespaceMetricsWithClient(ctx context.Context, client *k8s.Client, namespace string) (*NamespaceMetrics, error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	podMetricsList, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list pod metrics: %w", err)
	}
	var totalCPUMilli, totalMemoryMi float64
	for _, podMetrics := range podMetricsList.Items {
		for _, container := range podMetrics.Containers {
			totalCPUMilli += container.Usage.Cpu().AsApproximateFloat64() * 1000
			totalMemoryMi += float64(container.Usage.Memory().Value()) / (1024 * 1024)
		}
	}
	return &NamespaceMetrics{
		Namespace:   namespace,
		PodCount:    len(podMetricsList.Items),
		TotalCPU:    formatCPUUsage(totalCPUMilli),
		TotalMemory: formatMemoryUsageMi(totalMemoryMi),
	}, nil
}

func (s *metricsService) GetDeploymentMetrics(ctx context.Context, clusterID, namespace, deploymentName string) (*DeploymentMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	dep, err := client.Clientset.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("deployment not found: %w", err)
	}

	selector, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid deployment selector: %w", err)
	}

	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: selector.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list deployment pods: %w", err)
	}

	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}

	var totalCPUMilli, totalMemoryMi float64
	podMetricsList := make([]PodMetrics, 0, len(podList.Items))
	for _, pod := range podList.Items {
		pm, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, pod.Name, metav1.GetOptions{})
		if err != nil {
			continue // skip pods without metrics (e.g. not yet scheduled)
		}
		var podCPUMilli, podMemoryMi float64
		containers := make([]ContainerMetrics, 0, len(pm.Containers))
		for _, c := range pm.Containers {
			cpuMilli := c.Usage.Cpu().AsApproximateFloat64() * 1000
			memMi := float64(c.Usage.Memory().Value()) / (1024 * 1024)
			podCPUMilli += cpuMilli
			podMemoryMi += memMi
			containers = append(containers, ContainerMetrics{
				Name:   c.Name,
				CPU:    formatCPUUsage(cpuMilli),
				Memory: formatMemoryUsageMi(memMi),
			})
		}
		totalCPUMilli += podCPUMilli
		totalMemoryMi += podMemoryMi
		podMetricsList = append(podMetricsList, PodMetrics{
			Name:       pod.Name,
			Namespace:  namespace,
			CPU:        formatCPUUsage(podCPUMilli),
			Memory:     formatMemoryUsageMi(podMemoryMi),
			Containers: containers,
		})
	}

	return &DeploymentMetrics{
		DeploymentName: deploymentName,
		Namespace:      namespace,
		PodCount:       len(podMetricsList),
		TotalCPU:       formatCPUUsage(totalCPUMilli),
		TotalMemory:    formatMemoryUsageMi(totalMemoryMi),
		Pods:           podMetricsList,
	}, nil
}

func (s *metricsService) GetDeploymentMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, deploymentName string) (*DeploymentMetrics, error) {
	dep, err := client.Clientset.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("deployment not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid deployment selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list deployment pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, deploymentName, podList.Items)
}

// getMetricsForPods fetches metrics for the given pods and returns per-pod metrics plus totals.
func (s *metricsService) getMetricsForPods(ctx context.Context, metricsClient *versioned.Clientset, namespace, workloadName string, pods []corev1.Pod) (*DeploymentMetrics, error) {
	var totalCPUMilli, totalMemoryMi float64
	podMetricsList := make([]PodMetrics, 0, len(pods))
	for _, pod := range pods {
		pm, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, pod.Name, metav1.GetOptions{})
		if err != nil {
			continue
		}
		var podCPUMilli, podMemoryMi float64
		containers := make([]ContainerMetrics, 0, len(pm.Containers))
		for _, c := range pm.Containers {
			cpuMilli := c.Usage.Cpu().AsApproximateFloat64() * 1000
			memMi := float64(c.Usage.Memory().Value()) / (1024 * 1024)
			podCPUMilli += cpuMilli
			podMemoryMi += memMi
			containers = append(containers, ContainerMetrics{
				Name:   c.Name,
				CPU:    formatCPUUsage(cpuMilli),
				Memory: formatMemoryUsageMi(memMi),
			})
		}
		totalCPUMilli += podCPUMilli
		totalMemoryMi += podMemoryMi
		podMetricsList = append(podMetricsList, PodMetrics{
			Name:       pod.Name,
			Namespace:  namespace,
			CPU:        formatCPUUsage(podCPUMilli),
			Memory:     formatMemoryUsageMi(podMemoryMi),
			Containers: containers,
		})
	}
	return &DeploymentMetrics{
		DeploymentName: workloadName,
		Namespace:      namespace,
		PodCount:       len(podMetricsList),
		TotalCPU:       formatCPUUsage(totalCPUMilli),
		TotalMemory:    formatMemoryUsageMi(totalMemoryMi),
		Pods:           podMetricsList,
	}, nil
}

func (s *metricsService) GetReplicaSetMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	rs, err := client.Clientset.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("replicaset not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid replicaset selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list replicaset pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetReplicaSetMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error) {
	rs, err := client.Clientset.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("replicaset not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid replicaset selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list replicaset pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetStatefulSetMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	sts, err := client.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("statefulset not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(sts.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid statefulset selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list statefulset pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetStatefulSetMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error) {
	sts, err := client.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("statefulset not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(sts.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid statefulset selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list statefulset pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetDaemonSetMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	ds, err := client.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("daemonset not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid daemonset selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list daemonset pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetDaemonSetMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error) {
	ds, err := client.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("daemonset not found: %w", err)
	}
	selector, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
	if err != nil {
		return nil, fmt.Errorf("invalid daemonset selector: %w", err)
	}
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("failed to list daemonset pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetJobMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	job, err := client.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("job not found: %w", err)
	}
	// Pods created by a Job have label job-name=<job.Name>
	selector := metav1.FormatLabelSelector(&metav1.LabelSelector{MatchLabels: map[string]string{"job-name": job.Name}})
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("failed to list job pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetJobMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error) {
	job, err := client.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("job not found: %w", err)
	}
	selector := metav1.FormatLabelSelector(&metav1.LabelSelector{MatchLabels: map[string]string{"job-name": job.Name}})
	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("failed to list job pods: %w", err)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, podList.Items)
}

func (s *metricsService) GetCronJobMetrics(ctx context.Context, clusterID, namespace, name string) (*DeploymentMetrics, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	_, err = client.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("cronjob not found: %w", err)
	}
	// List Jobs owned by this CronJob
	jobList, err := client.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}
	var pods []corev1.Pod
	for i := range jobList.Items {
		job := &jobList.Items[i]
		owner := metav1.GetControllerOf(job)
		if owner == nil || owner.Kind != "CronJob" || owner.Name != name {
			continue
		}
		selector := metav1.FormatLabelSelector(&metav1.LabelSelector{MatchLabels: map[string]string{"job-name": job.Name}})
		podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			continue
		}
		pods = append(pods, podList.Items...)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, pods)
}

func (s *metricsService) GetCronJobMetricsWithClient(ctx context.Context, client *k8s.Client, namespace, name string) (*DeploymentMetrics, error) {
	_, err := client.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("cronjob not found: %w", err)
	}
	jobList, err := client.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}
	var pods []corev1.Pod
	for i := range jobList.Items {
		job := &jobList.Items[i]
		owner := metav1.GetControllerOf(job)
		if owner == nil || owner.Kind != "CronJob" || owner.Name != name {
			continue
		}
		selector := metav1.FormatLabelSelector(&metav1.LabelSelector{MatchLabels: map[string]string{"job-name": job.Name}})
		podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			continue
		}
		pods = append(pods, podList.Items...)
	}
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to create metrics client: %w", err)
	}
	return s.getMetricsForPods(ctx, metricsClient, namespace, name, pods)
}
