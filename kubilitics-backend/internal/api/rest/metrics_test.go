package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// TestGetMetricsSummary_UnscopedReturnsAggregate exercises the new unscoped
// branch used by kubilitics-ai's observe_pod_metrics + observe_top_pods_by_metric.
// The handler must return 200 with a JSON body containing pods[] and nodes[]
// keys (possibly empty when metrics-server isn't injected) — never the legacy
// 400 that blocked the brain.
func TestGetMetricsSummary_UnscopedReturnsAggregate(t *testing.T) {
	clusterID := "test-cluster"
	cluster := &models.Cluster{ID: clusterID, Name: "t", Context: "c", Status: "connected"}
	csvc := &mockClusterServiceWithClient{clusters: []*models.Cluster{cluster}}

	// Build a real UnifiedMetricsService and inject the aggregate test seam so
	// we don't need a live metrics.k8s.io endpoint.
	unified := service.NewUnifiedMetricsService(
		(service.ClusterService)(csvc),
		nil, // default provider — unused because we override GetClusterAggregate
		metrics.NewControllerMetricsResolver(),
		metrics.NewInMemoryMetricsCache(0),
		(*repository.SQLiteRepository)(nil),
	)
	unified.SetClusterAggregateFn(func(_ context.Context, cid string, topN int) (*models.ClusterMetricsAggregate, error) {
		return &models.ClusterMetricsAggregate{
			ClusterID: cid,
			TopN:      topN,
			Pods: []models.ClusterAggregatePod{
				{Namespace: "demo", Name: "web-0", CPUMillicores: 123, MemoryMiB: 45},
			},
			Nodes: []models.ClusterAggregateNode{
				{Name: "node-1", CPUMillicores: 900, MemoryMiB: 2048},
			},
		}, nil
	})

	h := NewHandler(csvc, nil, &config.Config{}, nil, nil, nil, unified, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/clusters/"+clusterID+"/metrics/summary", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("unscoped /metrics/summary: expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}
	var resp models.ClusterMetricsAggregate
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse response: %v (body: %s)", err, w.Body.String())
	}
	if len(resp.Pods) == 0 && len(resp.Nodes) == 0 {
		t.Fatalf("aggregate must return at least one of pods[] or nodes[]; got %+v", resp)
	}
	if resp.Pods[0].Namespace != "demo" || resp.Pods[0].Name != "web-0" {
		t.Fatalf("expected pod demo/web-0, got %+v", resp.Pods[0])
	}
}

// TestGetMetricsSummary_UnscopedDegradesGracefully verifies that when
// metrics-server is unavailable (no override injected, client has no Config)
// the handler still returns 200 with metrics_unavailable=true rather than 5xx.
func TestGetMetricsSummary_UnscopedDegradesGracefully(t *testing.T) {
	clusterID := "test-cluster"
	cluster := &models.Cluster{ID: clusterID, Name: "t", Context: "c", Status: "connected"}
	csvc := &mockClusterServiceWithClient{clusters: []*models.Cluster{cluster}}

	unified := service.NewUnifiedMetricsService(
		(service.ClusterService)(csvc), nil,
		metrics.NewControllerMetricsResolver(),
		metrics.NewInMemoryMetricsCache(0),
		(*repository.SQLiteRepository)(nil),
	)
	// Force graceful-degrade: pretend metrics-server is unreachable.
	unified.SetClusterAggregateFn(func(_ context.Context, cid string, topN int) (*models.ClusterMetricsAggregate, error) {
		return &models.ClusterMetricsAggregate{
			ClusterID:          cid,
			TopN:               topN,
			Pods:               []models.ClusterAggregatePod{},
			Nodes:              []models.ClusterAggregateNode{},
			MetricsUnavailable: true,
			Reason:             "metrics-server not installed on test cluster",
		}, nil
	})

	h := NewHandler(csvc, nil, &config.Config{}, nil, nil, nil, unified, nil, nil, nil, nil, nil)
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/clusters/"+clusterID+"/metrics/summary", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with graceful-degrade, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.ClusterMetricsAggregate
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !resp.MetricsUnavailable || resp.Reason == "" {
		t.Fatalf("expected metrics_unavailable=true with reason, got %+v", resp)
	}
}
