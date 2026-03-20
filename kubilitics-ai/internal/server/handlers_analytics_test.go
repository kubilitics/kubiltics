package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics"
)

// ─── Helpers ─────────────────────────────────────────────────────────────────

// buildAnalyticsServer creates a minimal Server with a live analytics pipeline.
// The pipeline has a nil fetcher so background scraping is a no-op.
func buildAnalyticsServer(t *testing.T) *Server {
	t.Helper()
	srv := &Server{
		analyticsPipeline: analytics.NewPipeline(nil),
	}
	return srv
}

// buildAnalyticsServerNoPipeline creates a Server without an analytics pipeline.
func buildAnalyticsServerNoPipeline(t *testing.T) *Server {
	t.Helper()
	return &Server{}
}

// seedMetrics ingests a deterministic ramp of values for a resource+metric.
func seedMetrics(t *testing.T, p *analytics.Pipeline, resourceID, metricName string, count int, baseVal float64) {
	t.Helper()
	ctx := context.Background()
	ts := p.GetTimeSeriesEngine()
	for i := 0; i < count; i++ {
		val := baseVal + float64(i)*0.5
		_ = ts.StoreMetric(ctx, resourceID, metricName, time.Now().Add(-time.Duration(count-i)*time.Minute), val)
	}
}

// doRequest creates an httptest request/response pair and calls the handler.
func doRequest(t *testing.T, handler http.HandlerFunc, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader *bytes.Reader
	if body != "" {
		bodyReader = bytes.NewReader([]byte(body))
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// ─── Anomalies endpoint ───────────────────────────────────────────────────────

func TestHandlePipelineAnomalies_NoPipeline(t *testing.T) {
	srv := buildAnalyticsServerNoPipeline(t)
	rr := doRequest(t, srv.handlePipelineAnomalies, http.MethodGet, "/api/v1/analytics/pipeline/anomalies", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if note, _ := resp["note"].(string); note == "" {
		t.Error("expected 'note' field when pipeline is nil")
	}
}

func TestHandlePipelineAnomalies_Empty(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineAnomalies, http.MethodGet, "/api/v1/analytics/pipeline/anomalies", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	total, _ := resp["total"].(float64)
	if total != 0 {
		t.Errorf("expected total=0, got %v", total)
	}
}

func TestHandlePipelineAnomalies_MethodNotAllowed(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineAnomalies, http.MethodPost, "/api/v1/analytics/pipeline/anomalies", "{}")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

func TestHandlePipelineAnomalies_WithIngestedAnomaly(t *testing.T) {
	srv := buildAnalyticsServer(t)
	ctx := context.Background()

	// Seed a tightly-clustered baseline (low variance) so the spike is very anomalous.
	ts := srv.analyticsPipeline.GetTimeSeriesEngine()
	for i := 0; i < 60; i++ {
		_ = ts.StoreMetric(ctx, "default/Pod/stress", "cpu_usage",
			time.Now().Add(-time.Duration(60-i)*time.Minute), 10.0+float64(i%3)*0.01)
	}
	// Ingest via IngestMetric which runs anomaly check (value 50x baseline → z-score >> threshold).
	// The anomaly detector needs the baseline to be established first.
	// IngestMetric calls ad.CheckMetricAnomaly internally.
	if err := srv.analyticsPipeline.IngestMetric(ctx, "default/Pod/stress", "cpu_usage", 50000.0); err != nil {
		t.Fatalf("ingest: %v", err)
	}

	rr := doRequest(t, srv.handlePipelineAnomalies, http.MethodGet, "/api/v1/analytics/pipeline/anomalies", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	total, _ := resp["total"].(float64)
	if total < 1 {
		t.Errorf("expected at least 1 anomaly after 5000x spike over tight baseline, got %v", total)
	}
}

func TestHandlePipelineAnomalies_NamespaceFilter(t *testing.T) {
	srv := buildAnalyticsServer(t)
	ctx := context.Background()
	ts := srv.analyticsPipeline.GetTimeSeriesEngine()
	for i := 0; i < 30; i++ {
		_ = ts.StoreMetric(ctx, "prod/Pod/api", "cpu_usage",
			time.Now().Add(-time.Duration(30-i)*time.Minute), 10.0)
	}
	_ = srv.analyticsPipeline.IngestMetric(ctx, "prod/Pod/api", "cpu_usage", 9999.0)

	// Filter for "staging" — should return nothing relevant
	rr := doRequest(t, srv.handlePipelineAnomalies, http.MethodGet,
		"/api/v1/analytics/pipeline/anomalies?namespace=staging", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	total, _ := resp["total"].(float64)
	if total != 0 {
		t.Errorf("expected 0 anomalies for staging namespace, got %v", total)
	}
}

// ─── Scores endpoint ─────────────────────────────────────────────────────────

func TestHandlePipelineScores_NoPipeline(t *testing.T) {
	srv := buildAnalyticsServerNoPipeline(t)
	rr := doRequest(t, srv.handlePipelineScores, http.MethodGet, "/api/v1/analytics/pipeline/scores?resource_id=x", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
}

func TestHandlePipelineScores_NoResourceID(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineScores, http.MethodGet, "/api/v1/analytics/pipeline/scores", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 with message, got %d", rr.Code)
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if _, hasMsg := resp["message"]; !hasMsg {
		t.Error("expected 'message' field when resource_id missing")
	}
}

func TestHandlePipelineScores_WithResourceID(t *testing.T) {
	srv := buildAnalyticsServer(t)
	seedMetrics(t, srv.analyticsPipeline, "default/Pod/web", "cpu_usage", 20, 30.0)

	rr := doRequest(t, srv.handlePipelineScores, http.MethodGet,
		"/api/v1/analytics/pipeline/scores?resource_id=default%2FPod%2Fweb", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if _, ok := resp["health"]; !ok {
		t.Error("response missing 'health' key")
	}
}

// ─── Trends endpoint ─────────────────────────────────────────────────────────

func TestHandlePipelineTrends_MissingResourceID(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineTrends, http.MethodGet, "/api/v1/analytics/pipeline/trends", "")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHandlePipelineTrends_WithData(t *testing.T) {
	srv := buildAnalyticsServer(t)
	seedMetrics(t, srv.analyticsPipeline, "default/Pod/web", "cpu_usage", 30, 50.0)

	rr := doRequest(t, srv.handlePipelineTrends, http.MethodGet,
		"/api/v1/analytics/pipeline/trends?resource_id=default%2FPod%2Fweb&metric=cpu_usage", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if _, ok := resp["trend"]; !ok {
		t.Error("response missing 'trend' key")
	}
}

func TestHandlePipelineTrends_MethodNotAllowed(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineTrends, http.MethodPost, "/api/v1/analytics/pipeline/trends", "{}")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

// ─── Ingest endpoint ─────────────────────────────────────────────────────────

func TestHandlePipelineIngest_Success(t *testing.T) {
	srv := buildAnalyticsServer(t)
	body := `{"resource_id":"default/Pod/web","metric_name":"cpu_usage","value":42.5}`
	rr := doRequest(t, srv.handlePipelineIngest, http.MethodPost, "/api/v1/analytics/pipeline/ingest", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if status, _ := resp["status"].(string); status != "ingested" {
		t.Errorf("expected status=ingested, got %v", status)
	}
	if val, _ := resp["value"].(float64); val != 42.5 {
		t.Errorf("expected value=42.5, got %v", val)
	}
}

func TestHandlePipelineIngest_MissingFields(t *testing.T) {
	srv := buildAnalyticsServer(t)
	body := `{"resource_id":"default/Pod/web"}`
	rr := doRequest(t, srv.handlePipelineIngest, http.MethodPost, "/api/v1/analytics/pipeline/ingest", body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHandlePipelineIngest_BadJSON(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineIngest, http.MethodPost, "/api/v1/analytics/pipeline/ingest", "not json")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHandlePipelineIngest_MethodNotAllowed(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineIngest, http.MethodGet, "/api/v1/analytics/pipeline/ingest", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

// ─── Forecast endpoint ────────────────────────────────────────────────────────

func TestHandlePipelineForecast_InsufficientData(t *testing.T) {
	srv := buildAnalyticsServer(t)
	body := `{"resource_id":"default/Pod/web","metric_name":"cpu_usage","horizon":"1h"}`
	rr := doRequest(t, srv.handlePipelineForecast, http.MethodPost, "/api/v1/analytics/pipeline/forecast", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	if _, ok := resp["forecast"]; !ok {
		t.Error("response missing 'forecast' key")
	}
}

func TestHandlePipelineForecast_WithData(t *testing.T) {
	srv := buildAnalyticsServer(t)
	seedMetrics(t, srv.analyticsPipeline, "default/Pod/web", "cpu_usage", 30, 60.0)

	body := `{"resource_id":"default/Pod/web","metric_name":"cpu_usage","horizon":"2h","capacity":100.0,"threshold":80.0}`
	rr := doRequest(t, srv.handlePipelineForecast, http.MethodPost, "/api/v1/analytics/pipeline/forecast", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, key := range []string{"forecast", "trend", "capacity_comparison", "threshold_crossing"} {
		if _, ok := resp[key]; !ok {
			t.Errorf("response missing %q key", key)
		}
	}
}

func TestHandlePipelineForecast_MissingResourceID(t *testing.T) {
	srv := buildAnalyticsServer(t)
	body := `{"metric_name":"cpu_usage"}`
	rr := doRequest(t, srv.handlePipelineForecast, http.MethodPost, "/api/v1/analytics/pipeline/forecast", body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestHandlePipelineForecast_MethodNotAllowed(t *testing.T) {
	srv := buildAnalyticsServer(t)
	rr := doRequest(t, srv.handlePipelineForecast, http.MethodGet, "/api/v1/analytics/pipeline/forecast", "")
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

func TestHandleAnalyticsPipeline_Dispatch(t *testing.T) {
	srv := buildAnalyticsServer(t)

	paths := []struct {
		path   string
		method string
		body   string
		want   int
	}{
		{"/api/v1/analytics/pipeline/anomalies", http.MethodGet, "", http.StatusOK},
		{"/api/v1/analytics/pipeline/scores", http.MethodGet, "", http.StatusOK},
		{"/api/v1/analytics/pipeline/trends?resource_id=x", http.MethodGet, "", http.StatusOK},
		{"/api/v1/analytics/pipeline/ingest", http.MethodPost,
			`{"resource_id":"x","metric_name":"m","value":1.0}`, http.StatusOK},
		{"/api/v1/analytics/pipeline/forecast", http.MethodPost,
			`{"resource_id":"x","metric_name":"m"}`, http.StatusOK},
		{"/api/v1/analytics/pipeline/unknown", http.MethodGet, "", http.StatusNotFound},
	}

	for _, tc := range paths {
		req := httptest.NewRequest(tc.method, tc.path, bytes.NewReader([]byte(tc.body)))
		if tc.method == http.MethodPost {
			req.Header.Set("Content-Type", "application/json")
		}
		rr := httptest.NewRecorder()
		srv.handleAnalyticsPipeline(rr, req)
		if rr.Code != tc.want {
			t.Errorf("path %s: expected %d, got %d; body: %s", tc.path, tc.want, rr.Code, rr.Body.String())
		}
	}
}

// ─── Forecasting predictor helpers (unit) ─────────────────────────────────────

func TestAnalyticsPipeline_IngestAndRetrieve(t *testing.T) {
	p := analytics.NewPipeline(nil)
	ctx := context.Background()

	if err := p.IngestMetric(ctx, "ns/Pod/foo", "cpu", 42.0); err != nil {
		t.Fatalf("ingest: %v", err)
	}

	anomalies, err := p.GetAnomalies(ctx, "")
	if err != nil {
		t.Fatalf("GetAnomalies: %v", err)
	}
	// No anomaly expected for a single value (no baseline yet)
	_ = anomalies
}

func TestAnalyticsPipeline_GetPredictorNotNil(t *testing.T) {
	p := analytics.NewPipeline(nil)
	if p.GetPredictor() == nil {
		t.Error("expected non-nil predictor")
	}
}

func TestAnalyticsPipeline_ForecastInsufficientData(t *testing.T) {
	p := analytics.NewPipeline(nil)
	ctx := context.Background()
	pred := p.GetPredictor()

	result, err := pred.ForecastMetric(ctx, "ns/Pod/foo", "cpu", "1h")
	if err != nil {
		t.Fatalf("ForecastMetric: %v", err)
	}
	rm, ok := result.(map[string]interface{})
	if !ok {
		t.Fatalf("unexpected type %T", result)
	}
	if method, _ := rm["method"].(string); method != "insufficient_data" {
		t.Errorf("expected method=insufficient_data, got %v", method)
	}
}
