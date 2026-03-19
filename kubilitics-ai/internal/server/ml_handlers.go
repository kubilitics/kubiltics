package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics/forecast"
	"github.com/kubilitics/kubilitics-ai/internal/analytics/ml"
)

// TimeSeriesPoint is a single data point in a time series
type TimeSeriesPoint struct {
	Timestamp string  `json:"timestamp"`
	Value     float64 `json:"value"`
}

// TimeSeriesData represents a named time series with timestamped data points
type TimeSeriesData struct {
	Name string            `json:"name"`
	Data []TimeSeriesPoint `json:"data"`
}

// MLAnomalyRequest represents a request for ML-based anomaly detection
type MLAnomalyRequest struct {
	TimeSeries  TimeSeriesData `json:"time_series"`
	Algorithm   string         `json:"algorithm"`   // "isolation_forest", "ensemble"
	Sensitivity float64        `json:"sensitivity"` // 0.0 to 1.0
	NumTrees    int            `json:"num_trees,omitempty"`
	SampleSize  int            `json:"sample_size,omitempty"`
}

// MLAnomalyResponse contains ML anomaly detection results
type MLAnomalyResponse struct {
	Anomalies []MLAnomaly            `json:"anomalies"`
	ModelInfo map[string]interface{} `json:"model_info"`
}

// MLAnomaly represents a detected anomaly with ML score
type MLAnomaly struct {
	Timestamp   string  `json:"timestamp"`
	Value       float64 `json:"value"`
	Score       float64 `json:"score"`    // 0.0 to 1.0
	Severity    string  `json:"severity"` // "low", "medium", "high", "critical"
	Explanation string  `json:"explanation"`
	PathLength  float64 `json:"path_length,omitempty"`
}

// ForecastRequest represents a request for time series forecasting
type ForecastRequest struct {
	TimeSeries      TimeSeriesData `json:"time_series"`
	ForecastSteps   int            `json:"forecast_steps"`
	Model           string         `json:"model,omitempty"`            // "arima", "auto"
	ARIMAOrder      []int          `json:"arima_order,omitempty"`      // [p, d, q]
	ConfidenceLevel float64        `json:"confidence_level,omitempty"` // 0.95 default
}

// ForecastResponse contains forecast results
type ForecastResponse struct {
	Forecasts []ForecastPoint        `json:"forecasts"`
	ModelInfo map[string]interface{} `json:"model_info"`
	StdError  float64                `json:"std_error"`
}

// ForecastPoint represents a single forecast point
type ForecastPoint struct {
	Timestamp string  `json:"timestamp"`
	Value     float64 `json:"value"`
	Lower95   float64 `json:"lower_95"`
	Upper95   float64 `json:"upper_95"`
}

// handleMLAnomalies handles ML-based anomaly detection
func (s *Server) handleMLAnomalies(w http.ResponseWriter, r *http.Request) {
	var req MLAnomalyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Default parameters
	if req.NumTrees == 0 {
		req.NumTrees = 100
	}
	if req.SampleSize == 0 {
		req.SampleSize = 256
	}
	if req.Sensitivity == 0 {
		req.Sensitivity = 0.6
	}

	// Convert time series to ML data points
	dataPoints := make([]ml.DataPoint, len(req.TimeSeries.Data))
	for i, dp := range req.TimeSeries.Data {
		// Single feature (value)
		dataPoints[i] = ml.DataPoint{
			Features: []float64{dp.Value},
			Label:    dp.Timestamp,
		}
	}

	// Create and train Isolation Forest
	forest := ml.NewIsolationForest(req.NumTrees, req.SampleSize, 10)
	if err := forest.Fit(dataPoints); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get anomalies
	anomalies := forest.GetAnomalies(dataPoints, req.Sensitivity)

	// Convert to response format
	mlAnomalies := make([]MLAnomaly, len(anomalies))
	for i, a := range anomalies {
		severity := "low"
		if a.Result.Score > 0.8 {
			severity = "critical"
		} else if a.Result.Score > 0.7 {
			severity = "high"
		} else if a.Result.Score > 0.6 {
			severity = "medium"
		}

		mlAnomalies[i] = MLAnomaly{
			Timestamp:   a.Point.Label,
			Value:       a.Point.Features[0],
			Score:       a.Result.Score,
			Severity:    severity,
			Explanation: a.Result.Explanation,
			PathLength:  a.Result.PathLength,
		}
	}

	response := MLAnomalyResponse{
		Anomalies: mlAnomalies,
		ModelInfo: map[string]interface{}{
			"algorithm":    "isolation_forest",
			"num_trees":    req.NumTrees,
			"sample_size":  req.SampleSize,
			"threshold":    req.Sensitivity,
			"total_points": len(dataPoints),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleForecast handles time series forecasting
func (s *Server) handleForecast(w http.ResponseWriter, r *http.Request) {
	var req ForecastRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Default parameters
	if req.Model == "" {
		req.Model = "arima"
	}
	if len(req.ARIMAOrder) == 0 {
		// Auto-select order: ARIMA(1,1,1)
		req.ARIMAOrder = []int{1, 1, 1}
	}
	if req.ForecastSteps <= 0 {
		req.ForecastSteps = 10
	}

	// Extract values
	values := make([]float64, len(req.TimeSeries.Data))
	for i, dp := range req.TimeSeries.Data {
		values[i] = dp.Value
	}

	// Create and fit ARIMA model
	p, d, q := req.ARIMAOrder[0], req.ARIMAOrder[1], req.ARIMAOrder[2]
	model := forecast.NewARIMA(p, d, q)

	if err := model.Fit(values); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Generate forecast
	result, err := model.Forecast(req.ForecastSteps)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Generate future timestamps
	lastTimestamp := req.TimeSeries.Data[len(req.TimeSeries.Data)-1].Timestamp
	lastTime, err := time.Parse(time.RFC3339, lastTimestamp)
	if err != nil {
		// Try parsing as ISO format
		lastTime = time.Now()
	}

	// Assume 1-minute intervals (can be made configurable)
	interval := 1 * time.Minute

	forecasts := make([]ForecastPoint, req.ForecastSteps)
	for i := 0; i < req.ForecastSteps; i++ {
		futureTime := lastTime.Add(time.Duration(i+1) * interval)

		forecasts[i] = ForecastPoint{
			Timestamp: futureTime.Format(time.RFC3339),
			Value:     result.Values[i],
			Lower95:   result.Lower95[i],
			Upper95:   result.Upper95[i],
		}
	}

	response := ForecastResponse{
		Forecasts: forecasts,
		ModelInfo: model.GetModelInfo(),
		StdError:  result.StdError,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleMLModels returns information about available ML models
func (s *Server) handleMLModels(w http.ResponseWriter, r *http.Request) {
	models := map[string]interface{}{
		"anomaly_detection": map[string]interface{}{
			"isolation_forest": map[string]interface{}{
				"description": "Isolation Forest algorithm for anomaly detection",
				"parameters": map[string]string{
					"num_trees":   "Number of isolation trees (default: 100)",
					"sample_size": "Sample size for each tree (default: 256)",
					"sensitivity": "Anomaly threshold 0.0-1.0 (default: 0.6)",
				},
				"complexity": "O(n log n)",
				"best_for":   "High-dimensional data, outlier detection",
			},
		},
		"forecasting": map[string]interface{}{
			"arima": map[string]interface{}{
				"description": "AutoRegressive Integrated Moving Average",
				"parameters": map[string]string{
					"p": "AR order (autoregressive terms)",
					"d": "Differencing order (for stationarity)",
					"q": "MA order (moving average terms)",
				},
				"complexity": "O(n)",
				"best_for":   "Time series with trends and seasonality",
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models)
}
