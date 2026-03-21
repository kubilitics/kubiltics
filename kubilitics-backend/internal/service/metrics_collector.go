// Package service: MetricsCollector continuously collects metrics for all pods
// across all connected clusters and persists them to SQLite for historical charts.
// One API call per cluster fetches all pod metrics — no per-pod overhead.
package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	collectInterval = 30 * time.Second
	purgeInterval   = 1 * time.Hour
	maxHistoryAge   = 7 * 24 * time.Hour // keep 7 days
)

// MetricsCollector runs a background goroutine that fetches all pod metrics
// from every connected cluster and stores them in SQLite.
type MetricsCollector struct {
	clusterService ClusterService
	provider       *metrics.MetricsServerProvider
	repo           *repository.SQLiteRepository
}

// NewMetricsCollector creates a new collector.
func NewMetricsCollector(
	clusterService ClusterService,
	provider *metrics.MetricsServerProvider,
	repo *repository.SQLiteRepository,
) *MetricsCollector {
	return &MetricsCollector{
		clusterService: clusterService,
		provider:       provider,
		repo:           repo,
	}
}

// Start begins the collection loop. Call this at server startup.
func (mc *MetricsCollector) Start(ctx context.Context) {
	go func() {
		// Initial collection after a short delay (let clusters connect first)
		time.Sleep(5 * time.Second)
		mc.collectAll(ctx)

		ticker := time.NewTicker(collectInterval)
		defer ticker.Stop()
		purgeTicker := time.NewTicker(purgeInterval)
		defer purgeTicker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				mc.collectAll(ctx)
			case <-purgeTicker.C:
				mc.purgeOld(ctx)
			}
		}
	}()
	slog.Info("metrics collector started", "interval", collectInterval.String(), "retention", maxHistoryAge.String())
}

func (mc *MetricsCollector) collectAll(ctx context.Context) {
	clusters, err := mc.clusterService.ListClusters(ctx)
	if err != nil {
		slog.Warn("metrics collector: failed to list clusters", "error", err)
		return
	}

	now := time.Now().Unix()
	totalPods := 0

	for _, cluster := range clusters {
		if cluster.Status != "connected" {
			continue
		}
		client, err := mc.clusterService.GetClient(cluster.ID)
		if err != nil {
			continue // skip clusters without active client
		}

		fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		podMetrics, err := mc.provider.GetAllPodMetrics(fetchCtx, client)
		cancel()

		if err != nil {
			slog.Debug("metrics collector: skip cluster", "cluster", cluster.Name, "error", err)
			continue
		}

		if len(podMetrics) == 0 {
			continue
		}

		// Best-effort: fetch per-node network stats from kubelet
		netStats := mc.fetchNetworkStats(ctx, client)

		rows := make([]repository.MetricsHistoryRow, 0, len(podMetrics))
		for _, pm := range podMetrics {
			row := repository.MetricsHistoryRow{
				ClusterID: cluster.ID,
				Namespace: pm.Namespace,
				PodName:   pm.Name,
				Timestamp: now,
				CPUMilli:  pm.CPUMilli,
				MemoryMiB: pm.MemoryMiB,
			}
			// Attach network stats if available
			key := pm.Namespace + "/" + pm.Name
			if ns, ok := netStats[key]; ok {
				row.NetworkRx = ns.rx
				row.NetworkTx = ns.tx
			}
			rows = append(rows, row)
		}

		if err := mc.repo.InsertMetricsHistory(ctx, rows); err != nil {
			slog.Warn("metrics collector: failed to insert", "cluster", cluster.Name, "error", err)
			continue
		}
		totalPods += len(rows)
	}

	if totalPods > 0 {
		slog.Debug("metrics collected", "pods", totalPods)
	}
}

type podNetStats struct {
	rx, tx int64
}

// fetchNetworkStats gets network rx/tx for all pods by calling kubelet stats/summary per node.
func (mc *MetricsCollector) fetchNetworkStats(ctx context.Context, client *k8s.Client) map[string]podNetStats {
	result := make(map[string]podNetStats)
	nodes, err := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return result
	}
	for _, node := range nodes.Items {
		statsCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		raw, err := client.Clientset.CoreV1().RESTClient().Get().
			AbsPath("/api/v1/nodes/" + node.Name + "/proxy/stats/summary").
			DoRaw(statsCtx)
		cancel()
		if err != nil {
			continue
		}
		var summary struct {
			Pods []struct {
				PodRef struct {
					Name      string `json:"name"`
					Namespace string `json:"namespace"`
				} `json:"podRef"`
				Network struct {
					RxBytes    int64 `json:"rxBytes"`
					TxBytes    int64 `json:"txBytes"`
					Interfaces []struct {
						RxBytes int64 `json:"rxBytes"`
						TxBytes int64 `json:"txBytes"`
					} `json:"interfaces"`
				} `json:"network"`
			} `json:"pods"`
		}
		if err := json.Unmarshal(raw, &summary); err != nil {
			continue
		}
		for _, pod := range summary.Pods {
			rx := pod.Network.RxBytes
			tx := pod.Network.TxBytes
			if rx == 0 && tx == 0 {
				for _, iface := range pod.Network.Interfaces {
					rx += iface.RxBytes
					tx += iface.TxBytes
				}
			}
			result[pod.PodRef.Namespace+"/"+pod.PodRef.Name] = podNetStats{rx: rx, tx: tx}
		}
	}
	return result
}

func (mc *MetricsCollector) purgeOld(ctx context.Context) {
	deleted, err := mc.repo.PurgeOldMetrics(ctx, maxHistoryAge)
	if err != nil {
		slog.Warn("metrics purge failed", "error", err)
		return
	}
	if deleted > 0 {
		slog.Info("metrics purged", "deleted_rows", deleted)
	}
}
