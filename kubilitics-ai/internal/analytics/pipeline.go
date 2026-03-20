package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/analytics/anomaly"
	"github.com/kubilitics/kubilitics-ai/internal/analytics/forecasting"
	"github.com/kubilitics/kubilitics-ai/internal/analytics/scoring"
	"github.com/kubilitics/kubilitics-ai/internal/analytics/timeseries"
)

// MetricsFetcher is the minimal interface needed to pull metrics from the backend.
type MetricsFetcher interface {
	ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error)
	GetResourceMetrics(ctx context.Context, kind, namespace, name string) (map[string]float64, error)
}

// Pipeline orchestrates metric ingestion, anomaly detection, and scoring.
type Pipeline struct {
	mu sync.RWMutex

	ts        timeseries.TimeSeriesEngine
	ad        anomaly.AnomalyDetector
	scorer    scoring.ResourceScorer
	engine    *Engine
	predictor forecasting.Predictor
	fetcher   MetricsFetcher

	scrapeInterval time.Duration
	stopCh         chan struct{}
	doneCh         chan struct{}

	// Recent anomalies cache (last 1000)
	recentAnomalies []map[string]interface{}
}

// NewPipeline creates a metrics ingestion + anomaly detection pipeline.
func NewPipeline(fetcher MetricsFetcher) *Pipeline {
	ts := timeseries.NewTimeSeriesEngine()
	ad := anomaly.NewAnomalyDetector(ts)
	sc := scoring.NewResourceScorer(ts)
	pred := forecasting.NewPredictorWithTS(ts)

	return &Pipeline{
		ts:              ts,
		ad:              ad,
		scorer:          sc,
		engine:          NewEngine(),
		predictor:       pred,
		fetcher:         fetcher,
		scrapeInterval:  30 * time.Second,
		stopCh:          make(chan struct{}),
		doneCh:          make(chan struct{}),
		recentAnomalies: make([]map[string]interface{}, 0, 1000),
	}
}

// Start begins background metric scraping.
func (p *Pipeline) Start(ctx context.Context) {
	go func() {
		defer close(p.doneCh)
		ticker := time.NewTicker(p.scrapeInterval)
		defer ticker.Stop()

		// Initial scrape
		p.scrape(ctx)

		for {
			select {
			case <-ticker.C:
				p.scrape(ctx)
			case <-p.stopCh:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
}

// Stop halts the pipeline.
func (p *Pipeline) Stop() {
	close(p.stopCh)
	<-p.doneCh
}

// IngestMetric ingests a single metric from an external source.
// After storing the value it refreshes the anomaly baseline from the last hour
// of data and then checks whether the new value is anomalous.
func (p *Pipeline) IngestMetric(ctx context.Context, resourceID, metricName string, value float64) error {
	if err := p.ts.StoreMetric(ctx, resourceID, metricName, time.Now(), value); err != nil {
		return err
	}
	// Refresh the baseline cache so CheckMetricAnomaly has up-to-date statistics.
	// This is a no-op when there are fewer than 5 data points.
	_, _ = p.ad.GetBaseline(ctx, resourceID, metricName, time.Now().Add(-time.Hour), time.Now())

	// Check for anomaly
	isAnomaly, confidence, reason, _ := p.ad.CheckMetricAnomaly(ctx, resourceID, metricName, value)
	if isAnomaly && confidence > 60 {
		p.recordAnomaly(map[string]interface{}{
			"timestamp":   time.Now(),
			"resource_id": resourceID,
			"metric_name": metricName,
			"value":       value,
			"confidence":  confidence,
			"reason":      reason,
		})
	}
	return nil
}

// GetAnomalies returns recently detected anomalies, optionally filtered by namespace.
func (p *Pipeline) GetAnomalies(ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if namespace == "" {
		result := make([]map[string]interface{}, len(p.recentAnomalies))
		copy(result, p.recentAnomalies)
		return result, nil
	}

	var filtered []map[string]interface{}
	for _, a := range p.recentAnomalies {
		if rid, ok := a["resource_id"].(string); ok {
			// resource_id format: "namespace/kind/name" or "kind/name"
			if len(namespace) > 0 {
				// Check if resource_id starts with namespace
				if len(rid) > len(namespace) && rid[:len(namespace)+1] == namespace+"/" {
					filtered = append(filtered, a)
				}
			}
		}
	}
	return filtered, nil
}

// GetResourceHealth returns health information for a specific resource.
func (p *Pipeline) GetResourceHealth(ctx context.Context, resourceID string) (map[string]interface{}, error) {
	score, status, details, err := p.scorer.ComputeHealthScore(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"resource_id": resourceID,
		"score":       score,
		"status":      status,
		"details":     details,
	}, nil
}

// GetOverallScore returns the overall score for a resource.
func (p *Pipeline) GetOverallScore(ctx context.Context, resourceID string) (int, interface{}, error) {
	return p.scorer.ComputeOverallScore(ctx, resourceID)
}

// GetTimeSeriesEngine returns the underlying time-series engine.
func (p *Pipeline) GetTimeSeriesEngine() timeseries.TimeSeriesEngine {
	return p.ts
}

// GetAnomalyDetector returns the underlying anomaly detector.
func (p *Pipeline) GetAnomalyDetector() anomaly.AnomalyDetector {
	return p.ad
}

// GetResourceScorer returns the underlying resource scorer.
func (p *Pipeline) GetResourceScorer() scoring.ResourceScorer {
	return p.scorer
}

// GetAnalyticsEngine returns the core analytics engine.
func (p *Pipeline) GetAnalyticsEngine() *Engine {
	return p.engine
}

// GetPredictor returns the forecasting predictor.
func (p *Pipeline) GetPredictor() forecasting.Predictor {
	return p.predictor
}

// ─── Internal ─────────────────────────────────────────────────────────────────

// scrape pulls metrics from the backend for all known resources.
func (p *Pipeline) scrape(ctx context.Context) {
	if p.fetcher == nil {
		return
	}

	// Scrape key workload kinds
	kinds := []string{"Pod", "Node"}
	for _, kind := range kinds {
		resources, err := p.fetcher.ListResources(ctx, kind, "")
		if err != nil {
			continue
		}
		for _, r := range resources {
			p.scrapeResource(ctx, r)
		}
	}
}

// scrapeResource fetches metrics for a single resource.
func (p *Pipeline) scrapeResource(ctx context.Context, r *pb.Resource) {
	ns := r.Namespace
	resourceID := fmt.Sprintf("%s/%s/%s", ns, r.Kind, r.Name)

	// Try to get metrics from backend
	if p.fetcher != nil {
		metrics, err := p.fetcher.GetResourceMetrics(ctx, r.Kind, ns, r.Name)
		if err == nil {
			for metricName, value := range metrics {
				_ = p.ts.StoreMetric(ctx, resourceID, metricName, time.Now(), value)
			}
			return
		}
	}

	// Fallback: parse metrics from resource Data field
	if len(r.Data) > 0 {
		var parsed map[string]interface{}
		if err := json.Unmarshal(r.Data, &parsed); err == nil {
			p.extractMetricsFromResourceData(ctx, resourceID, parsed)
		}
	}
}

// extractMetricsFromResourceData extracts metrics from resource spec/status.
func (p *Pipeline) extractMetricsFromResourceData(ctx context.Context, resourceID string, data map[string]interface{}) {
	status, _ := data["status"].(map[string]interface{})
	if status == nil {
		return
	}

	// Pod: extract container resource metrics
	if containerStatuses, ok := status["containerStatuses"].([]interface{}); ok {
		restarts := 0
		for _, cs := range containerStatuses {
			if csMap, ok := cs.(map[string]interface{}); ok {
				if rc, ok := csMap["restartCount"].(float64); ok {
					restarts += int(rc)
				}
			}
		}
		_ = p.ts.StoreMetric(ctx, resourceID, "restart_count", time.Now(), float64(restarts))
	}

	// Pod phase
	if phase, ok := status["phase"].(string); ok {
		phaseVal := 1.0
		if phase != "Running" {
			phaseVal = 0.0
		}
		_ = p.ts.StoreMetric(ctx, resourceID, "availability", time.Now(), phaseVal)
	}
}

func (p *Pipeline) recordAnomaly(a map[string]interface{}) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.recentAnomalies) >= 1000 {
		p.recentAnomalies = p.recentAnomalies[100:]
	}
	p.recentAnomalies = append(p.recentAnomalies, a)
}
