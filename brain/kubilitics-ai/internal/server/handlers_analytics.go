package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ─── Analytics Pipeline Endpoints (A-CORE-010) ────────────────────────────────
//
// GET  /api/v1/analytics/pipeline/anomalies  — list recent anomalies
// GET  /api/v1/analytics/pipeline/scores     — resource health scores
// GET  /api/v1/analytics/pipeline/trends     — time-series trend analysis
// POST /api/v1/analytics/pipeline/ingest     — ingest a single metric value
// POST /api/v1/analytics/pipeline/forecast   — forecast future metric value

// handleAnalyticsPipeline is the single dispatcher for /api/v1/analytics/pipeline/...
func (s *Server) handleAnalyticsPipeline(w http.ResponseWriter, r *http.Request) {
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v1/analytics/pipeline")
	suffix = strings.TrimPrefix(suffix, "/")

	switch suffix {
	case "anomalies":
		s.handlePipelineAnomalies(w, r)
	case "scores":
		s.handlePipelineScores(w, r)
	case "trends":
		s.handlePipelineTrends(w, r)
	case "ingest":
		s.handlePipelineIngest(w, r)
	case "forecast":
		s.handlePipelineForecast(w, r)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// handlePipelineAnomalies — GET /api/v1/analytics/pipeline/anomalies
//
//	Query params:
//	  namespace  — filter by namespace (optional)
//	  limit      — max results (default 50)
func (s *Server) handlePipelineAnomalies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.analyticsPipeline == nil {
		jsonOK(w, map[string]interface{}{
			"anomalies": []interface{}{},
			"total":     0,
			"timestamp": time.Now(),
			"note":      "analytics pipeline not initialised",
		})
		return
	}

	namespace := r.URL.Query().Get("namespace")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}

	anomalies, err := s.analyticsPipeline.GetAnomalies(r.Context(), namespace)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Apply limit (newest first — pipeline appends newest last)
	if len(anomalies) > limit {
		anomalies = anomalies[len(anomalies)-limit:]
	}

	// Reverse so newest comes first in response
	for i, j := 0, len(anomalies)-1; i < j; i, j = i+1, j-1 {
		anomalies[i], anomalies[j] = anomalies[j], anomalies[i]
	}

	jsonOK(w, map[string]interface{}{
		"anomalies": anomalies,
		"total":     len(anomalies),
		"namespace": namespace,
		"timestamp": time.Now(),
	})
}

// handlePipelineScores — GET /api/v1/analytics/pipeline/scores
//
//	Query params:
//	  resource_id — resource ID string (required)
func (s *Server) handlePipelineScores(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.analyticsPipeline == nil {
		jsonOK(w, map[string]interface{}{
			"note": "analytics pipeline not initialised",
		})
		return
	}

	resourceID := r.URL.Query().Get("resource_id")
	if resourceID == "" {
		// Return aggregate stats when no specific resource requested
		jsonOK(w, map[string]interface{}{
			"message":   "Provide resource_id query param for a specific score",
			"timestamp": time.Now(),
		})
		return
	}

	health, err := s.analyticsPipeline.GetResourceHealth(r.Context(), resourceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	overall, breakdown, err := s.analyticsPipeline.GetOverallScore(r.Context(), resourceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]interface{}{
		"resource_id":   resourceID,
		"health":        health,
		"overall_score": overall,
		"breakdown":     breakdown,
		"timestamp":     time.Now(),
	})
}

// handlePipelineTrends — GET /api/v1/analytics/pipeline/trends
//
//	Query params:
//	  resource_id  — required
//	  metric       — metric name (default "cpu_usage")
func (s *Server) handlePipelineTrends(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.analyticsPipeline == nil {
		jsonOK(w, map[string]interface{}{
			"note": "analytics pipeline not initialised",
		})
		return
	}

	resourceID := r.URL.Query().Get("resource_id")
	metricName := r.URL.Query().Get("metric")
	if metricName == "" {
		metricName = "cpu_usage"
	}

	if resourceID == "" {
		http.Error(w, "resource_id query param required", http.StatusBadRequest)
		return
	}

	ts := s.analyticsPipeline.GetTimeSeriesEngine()
	now := time.Now()
	raw, err := ts.QueryRange(r.Context(), resourceID, metricName, now.Add(-24*time.Hour), now, "5m")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	trend, err := ts.GetTrend(r.Context(), resourceID, metricName, now.Add(-24*time.Hour), now)
	if err != nil {
		trend = map[string]interface{}{"error": err.Error()}
	}

	jsonOK(w, map[string]interface{}{
		"resource_id": resourceID,
		"metric_name": metricName,
		"trend":       trend,
		"raw_series":  raw,
		"window":      "24h",
		"timestamp":   now,
	})
}

// handlePipelineIngest — POST /api/v1/analytics/pipeline/ingest
//
//	Body: { "resource_id": "...", "metric_name": "...", "value": 42.0 }
func (s *Server) handlePipelineIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.analyticsPipeline == nil {
		http.Error(w, "analytics pipeline not initialised", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		ResourceID string  `json:"resource_id"`
		MetricName string  `json:"metric_name"`
		Value      float64 `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.ResourceID == "" || req.MetricName == "" {
		http.Error(w, "resource_id and metric_name are required", http.StatusBadRequest)
		return
	}

	if err := s.analyticsPipeline.IngestMetric(r.Context(), req.ResourceID, req.MetricName, req.Value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]interface{}{
		"status":      "ingested",
		"resource_id": req.ResourceID,
		"metric_name": req.MetricName,
		"value":       req.Value,
		"timestamp":   time.Now(),
	})
}

// handlePipelineForecast — POST /api/v1/analytics/pipeline/forecast
//
//	Body: {
//	  "resource_id":  "...",
//	  "metric_name":  "...",
//	  "horizon":      "1h",          // optional, default "1h"
//	  "capacity":     100.0,         // optional, for capacity comparison
//	  "threshold":    80.0,          // optional, for threshold crossing prediction
//	  "direction":    "above"        // optional, "above" or "below" (default "above")
//	}
func (s *Server) handlePipelineForecast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.analyticsPipeline == nil {
		http.Error(w, "analytics pipeline not initialised", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		ResourceID string  `json:"resource_id"`
		MetricName string  `json:"metric_name"`
		Horizon    string  `json:"horizon"`
		Capacity   float64 `json:"capacity"`
		Threshold  float64 `json:"threshold"`
		Direction  string  `json:"direction"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.ResourceID == "" || req.MetricName == "" {
		http.Error(w, "resource_id and metric_name are required", http.StatusBadRequest)
		return
	}
	if req.Horizon == "" {
		req.Horizon = "1h"
	}
	if req.Direction == "" {
		req.Direction = "above"
	}

	predictor := s.analyticsPipeline.GetPredictor()
	if predictor == nil {
		http.Error(w, "forecasting predictor not initialised", http.StatusServiceUnavailable)
		return
	}

	// Core metric forecast
	forecast, err := predictor.ForecastMetric(r.Context(), req.ResourceID, req.MetricName, req.Horizon)
	if err != nil {
		http.Error(w, "forecast error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Trend analysis
	trendResult, _ := predictor.AnalyzeTrend(r.Context(), req.ResourceID, req.MetricName)

	// Capacity comparison (if capacity provided)
	var capacityResult interface{}
	if req.Capacity > 0 {
		capacityResult, _ = predictor.CompareForecastToCapacity(r.Context(), req.ResourceID, req.MetricName, req.Capacity, req.Horizon)
	}

	// Threshold crossing (if threshold provided)
	var thresholdResult interface{}
	if req.Threshold > 0 {
		thresholdResult, _ = predictor.PredictThresholdCrossing(r.Context(), req.ResourceID, req.MetricName, req.Threshold, req.Direction)
	}

	// Seasonal pattern
	seasonalResult, _ := predictor.GetSeasonalPattern(r.Context(), req.ResourceID, req.MetricName)

	response := map[string]interface{}{
		"resource_id": req.ResourceID,
		"metric_name": req.MetricName,
		"horizon":     req.Horizon,
		"forecast":    forecast,
		"trend":       trendResult,
		"timestamp":   time.Now(),
	}
	if capacityResult != nil {
		response["capacity_comparison"] = capacityResult
	}
	if thresholdResult != nil {
		response["threshold_crossing"] = thresholdResult
	}
	if seasonalResult != nil {
		response["seasonal_pattern"] = seasonalResult
	}

	jsonOK(w, response)
}
