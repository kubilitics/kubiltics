// Package service: unified metrics service. All metrics flow through ResourceIdentity;
// controller metrics are resolved and aggregated from pods (no resource-specific branches in API).
package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// UnifiedMetricsService exposes a single GetSummary(ResourceIdentity) and uses
// MetricsProvider + ControllerMetricsResolver + cache. Observable: every query is logged.
type UnifiedMetricsService struct {
	clusterService ClusterService
	provider       metrics.MetricsProvider
	resolver       *metrics.ControllerMetricsResolver
	cache          metrics.MetricsCache
	history        *metrics.MetricsHistoryStore
	repo           *repository.SQLiteRepository

	// clusterAggregateFn is an optional test seam used by GetClusterAggregate.
	// When nil, the production code path queries metrics.k8s.io.
	clusterAggregateFn func(ctx context.Context, clusterID string, topN int) (*models.ClusterMetricsAggregate, error)
}

// NewUnifiedMetricsService builds the service with the default provider and resolver.
func NewUnifiedMetricsService(
	clusterService ClusterService,
	provider metrics.MetricsProvider,
	resolver *metrics.ControllerMetricsResolver,
	cache metrics.MetricsCache,
	repo ...*repository.SQLiteRepository,
) *UnifiedMetricsService {
	if provider == nil {
		provider = metrics.NewMetricsServerProvider()
	}
	if resolver == nil {
		resolver = metrics.NewControllerMetricsResolver()
	}
	if cache == nil {
		cache = metrics.NewInMemoryMetricsCache(30 * time.Second)
	}
	var sqlRepo *repository.SQLiteRepository
	if len(repo) > 0 && repo[0] != nil {
		sqlRepo = repo[0]
	}
	return &UnifiedMetricsService{
		clusterService: clusterService,
		provider:       provider,
		resolver:       resolver,
		cache:          cache,
		history:        metrics.NewMetricsHistoryStore(),
		repo:           sqlRepo,
	}
}

// GetSummary returns metrics for the given identity (pod, node, or controller).
// Controllers are resolved to owned pods and aggregated; errors and latency are logged.
func (s *UnifiedMetricsService) GetSummary(ctx context.Context, id models.ResourceIdentity) models.MetricsQueryResult {
	start := time.Now()
	result := models.MetricsQueryResult{}

	if !id.Valid() {
		result.Error = "invalid resource identity: missing cluster_id, resource_type, resource_name, or namespace for namespaced resource"
		result.ErrorCode = "INVALID_IDENTITY"
		logMetricsQuery(ctx, id, 0, false, result.ErrorCode, result.Error)
		return result
	}

	key := metrics.CacheKey(id.ClusterID, id.Namespace, id.ResourceType, id.ResourceName)
	if summary, ok := s.cache.Get(key); ok {
		result.Summary = summary
		result.QueryMs = time.Since(start).Milliseconds()
		result.CacheHit = true
		// Still record to history on cache hits so the ring buffer accumulates data
		s.history.Record(key, metrics.SummaryToHistoryPoint(summary))
		logMetricsQuery(ctx, id, result.QueryMs, true, "", "")
		return result
	}

	client, err := s.clusterService.GetClient(id.ClusterID)
	if err != nil {
		result.Error = err.Error()
		result.ErrorCode = "CLUSTER_NOT_FOUND"
		result.QueryMs = time.Since(start).Milliseconds()
		logMetricsQuery(ctx, id, result.QueryMs, false, result.ErrorCode, result.Error)
		return result
	}

	summary, err := s.resolveAndFetch(ctx, client, id)
	if err != nil {
		result.Error = err.Error()
		result.ErrorCode = "METRICS_FETCH_FAILED"
		result.QueryMs = time.Since(start).Milliseconds()
		logMetricsQuery(ctx, id, result.QueryMs, false, result.ErrorCode, result.Error)
		return result
	}

	result.Summary = summary
	result.QueryMs = time.Since(start).Milliseconds()
	s.cache.Set(key, summary, 0)
	// Record to history ring buffer
	s.history.Record(key, metrics.SummaryToHistoryPoint(summary))
	logMetricsQuery(ctx, id, result.QueryMs, false, "", "")
	return result
}

// GetHistory returns stored history points from SQLite (persistent) or in-memory ring buffer.
func (s *UnifiedMetricsService) GetHistory(ctx context.Context, id models.ResourceIdentity, duration time.Duration) *models.MetricsHistoryResponse {
	now := time.Now()
	since := now.Add(-duration)

	// Determine aggregation interval based on requested duration
	intervalSec := 30
	if duration > 6*time.Hour {
		intervalSec = 300 // 5-min averages for 6h+
	} else if duration > 1*time.Hour {
		intervalSec = 60 // 1-min averages for 1-6h
	}

	resp := &models.MetricsHistoryResponse{
		ClusterID:    id.ClusterID,
		Namespace:    id.Namespace,
		ResourceType: id.ResourceType,
		ResourceName: id.ResourceName,
		IntervalSec:  intervalSec,
		MaxDuration:  "7d",
	}

	// For pods: query SQLite directly by pod name
	if id.ResourceType == models.ResourceTypePod && s.repo != nil {
		var rows []repository.MetricsHistoryRow
		var err error
		if intervalSec > 30 {
			rows, err = s.repo.QueryAggregatedMetricsHistory(ctx, id.ClusterID, id.Namespace, id.ResourceName, since, now, intervalSec)
		} else {
			rows, err = s.repo.QueryMetricsHistory(ctx, id.ClusterID, id.Namespace, id.ResourceName, since, now)
		}
		if err == nil && len(rows) > 0 {
			resp.Points = make([]models.MetricsHistoryPoint, 0, len(rows))
			for _, r := range rows {
				resp.Points = append(resp.Points, models.MetricsHistoryPoint{
					Timestamp: r.Timestamp,
					CPUMilli:  r.CPUMilli,
					MemoryMiB: r.MemoryMiB,
					NetworkRx: r.NetworkRx,
					NetworkTx: r.NetworkTx,
				})
			}
			return resp
		}
	}

	// For controllers or if SQLite has no data: try resolving pod names and aggregating
	if id.ResourceType.IsController() && s.repo != nil {
		client, err := s.clusterService.GetClient(id.ClusterID)
		if err == nil {
			podRefs, err := s.resolver.ResolvePods(ctx, client, id)
			if err == nil && len(podRefs) > 0 {
				podNames := make([]string, 0, len(podRefs))
				for _, pr := range podRefs {
					podNames = append(podNames, pr.Name)
				}
				rows, err := s.repo.QueryControllerMetricsHistory(ctx, id.ClusterID, id.Namespace, podNames, since, now, intervalSec)
				if err == nil && len(rows) > 0 {
					resp.Points = make([]models.MetricsHistoryPoint, 0, len(rows))
					for _, r := range rows {
						resp.Points = append(resp.Points, models.MetricsHistoryPoint{
							Timestamp: r.Timestamp,
							CPUMilli:  r.CPUMilli,
							MemoryMiB: r.MemoryMiB,
							NetworkRx: r.NetworkRx,
							NetworkTx: r.NetworkTx,
						})
					}
					return resp
				}
			}
		}
	}

	// Fallback: in-memory ring buffer (for nodes or when SQLite has no data yet)
	key := metrics.CacheKey(id.ClusterID, id.Namespace, id.ResourceType, id.ResourceName)
	s.history.MarkWatched(key)
	points := s.history.Query(key, duration)
	if points == nil {
		points = []models.MetricsHistoryPoint{}
	}
	resp.Points = points
	return resp
}

// StartCollector starts a background goroutine that periodically re-fetches
// metrics for watched resources to accumulate history.
func (s *UnifiedMetricsService) StartCollector(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		pruneTicker := time.NewTicker(5 * time.Minute)
		defer pruneTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, key := range s.history.WatchedKeys() {
					id := parseKeyToIdentity(key)
					if !id.Valid() {
						continue
					}
					fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
					_ = s.GetSummary(fetchCtx, id)
					cancel()
				}
			case <-pruneTicker.C:
				s.history.Prune()
			}
		}
	}()
	slog.Info("metrics history collector started", "interval", interval.String())
}

func parseKeyToIdentity(key string) models.ResourceIdentity {
	// key format: "clusterID:namespace:resourceType:resourceName"
	parts := make([]string, 0, 4)
	start := 0
	count := 0
	for i := 0; i < len(key) && count < 3; i++ {
		if key[i] == ':' {
			parts = append(parts, key[start:i])
			start = i + 1
			count++
		}
	}
	parts = append(parts, key[start:])
	if len(parts) != 4 {
		return models.ResourceIdentity{}
	}
	return models.ResourceIdentity{
		ClusterID: parts[0], Namespace: parts[1],
		ResourceType: models.ResourceType(parts[2]), ResourceName: parts[3],
	}
}

// resolveAndFetch builds MetricsSummary from provider (+ resolver for controllers).
func (s *UnifiedMetricsService) resolveAndFetch(ctx context.Context, client *k8s.Client, id models.ResourceIdentity) (*models.MetricsSummary, error) {
	summary := &models.MetricsSummary{
		ClusterID:    id.ClusterID,
		Namespace:    id.Namespace,
		ResourceType: id.ResourceType,
		ResourceName: id.ResourceName,
		Source:       "metrics_server",
	}

	switch id.ResourceType {
	case models.ResourceTypePod:
		usage, err := s.provider.GetPodUsage(ctx, client, id.Namespace, id.ResourceName)
		if err != nil {
			return nil, err
		}
		// Best-effort network stats from kubelet stats/summary API
		rx, tx, _ := s.provider.GetPodNetworkStats(ctx, client, id.Namespace, id.ResourceName)
		usage.NetworkRxBytes = rx
		usage.NetworkTxBytes = tx
		summary.TotalCPU = usage.CPU
		summary.TotalMemory = usage.Memory
		summary.TotalNetworkRx = rx
		summary.TotalNetworkTx = tx
		summary.PodCount = 1
		summary.Pods = []models.PodUsage{*usage}
		return summary, nil

	case models.ResourceTypeNode:
		cpu, mem, err := s.provider.GetNodeUsage(ctx, client, id.ResourceName)
		if err != nil {
			return nil, err
		}
		summary.TotalCPU = cpu
		summary.TotalMemory = mem
		summary.PodCount = 0
		return summary, nil
	}

	// Controller: resolve pods, fetch each, aggregate (no double-counting: resolver returns disjoint set).
	podRefs, err := s.resolver.ResolvePods(ctx, client, id)
	if err != nil {
		return nil, err
	}

	var usages []*models.PodUsage
	var skipped int
	for _, ref := range podRefs {
		u, err := s.provider.GetPodUsage(ctx, client, ref.Namespace, ref.Name)
		if err != nil {
			skipped++
			continue
		}
		// Best-effort network stats
		rx, tx, _ := s.provider.GetPodNetworkStats(ctx, client, ref.Namespace, ref.Name)
		u.NetworkRxBytes = rx
		u.NetworkTxBytes = tx
		usages = append(usages, u)
	}
	if skipped > 0 {
		summary.Warning = "some pods skipped (no metrics yet or not scheduled)"
	}
	totalCPU, totalMemory := metrics.AggregatePodUsages(usages)
	summary.TotalCPU = totalCPU
	summary.TotalMemory = totalMemory
	summary.PodCount = len(usages)
	summary.Pods = make([]models.PodUsage, 0, len(usages))
	var totalRx, totalTx int64
	for _, u := range usages {
		totalRx += u.NetworkRxBytes
		totalTx += u.NetworkTxBytes
		summary.Pods = append(summary.Pods, *u)
	}
	summary.TotalNetworkRx = totalRx
	summary.TotalNetworkTx = totalTx
	return summary, nil
}

func logMetricsQuery(ctx context.Context, id models.ResourceIdentity, queryMs int64, cacheHit bool, errorCode, errMsg string) {
	slog.InfoContext(ctx, "metrics query",
		"cluster_id", id.ClusterID,
		"namespace", id.Namespace,
		"resource_type", string(id.ResourceType),
		"resource_name", id.ResourceName,
		"query_ms", queryMs,
		"cache_hit", cacheHit,
		"error_code", errorCode,
		"error", errMsg,
	)
}
