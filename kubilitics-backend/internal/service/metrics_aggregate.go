// Package service: cluster-wide metrics aggregate helper.
//
// Provides GetClusterAggregate for GET /metrics/summary when no
// resource_type / resource_name is supplied. Brain tools
// (observe_pod_metrics unscoped, observe_top_pods_by_metric) consume this
// shape directly: {"pods":[{namespace,name,cpu_millicores,memory_mib}],
// "nodes":[...]}. Degrades gracefully when metrics-server is not
// installed/reachable by emitting {metrics_unavailable:true, reason:"..."}
// with HTTP 200 so the brain doesn't black-box the user.
//
// The aggregation function is split out behind an unexported seam
// (clusterAggregateFn) so tests can inject synthetic data without standing
// up a real metrics.k8s.io client.
package service

import (
	"context"
	"fmt"
	"sort"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

// defaultClusterAggregateTopN caps the pod list in the aggregate response
// so huge clusters do not ship multi-MB payloads to the brain.
const defaultClusterAggregateTopN = 100

// GetClusterAggregate returns a cluster-wide metrics snapshot: up to topN
// pods by CPU + all nodes. When metrics-server is unavailable, returns a
// (non-nil, nil-error) response with MetricsUnavailable=true so callers can
// render a clean "metrics off" banner instead of an opaque 5xx.
func (s *UnifiedMetricsService) GetClusterAggregate(ctx context.Context, clusterID string, topN int) (*models.ClusterMetricsAggregate, error) {
	if topN <= 0 {
		topN = defaultClusterAggregateTopN
	}
	out := &models.ClusterMetricsAggregate{
		ClusterID: clusterID,
		Pods:      []models.ClusterAggregatePod{},
		Nodes:     []models.ClusterAggregateNode{},
		TopN:      topN,
	}

	// Allow tests to pre-seed an aggregator that doesn't require real metrics-server.
	if s.clusterAggregateFn != nil {
		agg, err := s.clusterAggregateFn(ctx, clusterID, topN)
		if err != nil {
			return nil, err
		}
		return agg, nil
	}

	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, fmt.Errorf("cluster not found: %w", err)
	}
	if client == nil || client.Config == nil {
		out.MetricsUnavailable = true
		out.Reason = "cluster client has no REST config; metrics-server cannot be queried"
		return out, nil
	}

	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		out.MetricsUnavailable = true
		out.Reason = "failed to build metrics client: " + err.Error()
		return out, nil
	}

	// Pods across all namespaces
	podMetricsList, err := metricsClient.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
	if err != nil {
		out.MetricsUnavailable = true
		out.Reason = "metrics-server unavailable: " + err.Error()
		return out, nil
	}
	allPods := make([]models.ClusterAggregatePod, 0, len(podMetricsList.Items))
	for _, pm := range podMetricsList.Items {
		var cpuMilli, memMi float64
		for _, c := range pm.Containers {
			cpuMilli += c.Usage.Cpu().AsApproximateFloat64() * 1000
			memMi += float64(c.Usage.Memory().Value()) / (1024 * 1024)
		}
		allPods = append(allPods, models.ClusterAggregatePod{
			Namespace:     pm.Namespace,
			Name:          pm.Name,
			CPUMillicores: cpuMilli,
			MemoryMiB:     memMi,
		})
	}
	// Top N by CPU desc — stable tie-break on name for determinism.
	sort.SliceStable(allPods, func(i, j int) bool {
		if allPods[i].CPUMillicores != allPods[j].CPUMillicores {
			return allPods[i].CPUMillicores > allPods[j].CPUMillicores
		}
		return allPods[i].Namespace+"/"+allPods[i].Name < allPods[j].Namespace+"/"+allPods[j].Name
	})
	if len(allPods) > topN {
		allPods = allPods[:topN]
	}
	out.Pods = allPods

	// Nodes (cluster-scoped)
	nodeMetricsList, err := metricsClient.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err == nil {
		nodes := make([]models.ClusterAggregateNode, 0, len(nodeMetricsList.Items))
		for _, nm := range nodeMetricsList.Items {
			cpuMilli := nm.Usage.Cpu().AsApproximateFloat64() * 1000
			memMi := float64(nm.Usage.Memory().Value()) / (1024 * 1024)
			nodes = append(nodes, models.ClusterAggregateNode{
				Name:          nm.Name,
				CPUMillicores: cpuMilli,
				MemoryMiB:     memMi,
			})
		}
		sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
		out.Nodes = nodes
	}
	// If both lists are empty here (metrics-server empty, not errored), still
	// flag unavailable so the brain doesn't think the cluster has zero pods.
	if len(out.Pods) == 0 && len(out.Nodes) == 0 {
		out.MetricsUnavailable = true
		out.Reason = "metrics-server returned zero pods and zero nodes"
	}
	return out, nil
}

// SetClusterAggregateFn installs a test seam. Production code must not call this.
func (s *UnifiedMetricsService) SetClusterAggregateFn(fn func(ctx context.Context, clusterID string, topN int) (*models.ClusterMetricsAggregate, error)) {
	s.clusterAggregateFn = fn
}
