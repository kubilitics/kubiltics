package forecasting

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/analytics/forecast"
	"github.com/kubilitics/kubilitics-ai/internal/analytics/timeseries"
)

// predictorImpl is the concrete Predictor backed by the time-series engine and ARIMA.
type predictorImpl struct {
	ts timeseries.TimeSeriesEngine
}

// NewPredictorWithTS creates a Predictor backed by an existing time-series engine.
func NewPredictorWithTS(ts timeseries.TimeSeriesEngine) Predictor {
	return &predictorImpl{ts: ts}
}

// ForecastMetric predicts the future value of a metric using linear regression
// (fast, always sufficient for hourly horizon) supplemented by ARIMA when enough data exists.
func (p *predictorImpl) ForecastMetric(ctx context.Context, resourceID, metricName, horizon string) (interface{}, error) {
	dur, err := parseDuration(horizon)
	if err != nil {
		return nil, fmt.Errorf("invalid horizon %q: %w", horizon, err)
	}

	now := time.Now()
	lookback := 24 * time.Hour
	if dur > lookback {
		lookback = dur * 2
	}

	raw, err := p.ts.QueryRange(ctx, resourceID, metricName, now.Add(-lookback), now, "5m")
	if err != nil {
		return nil, fmt.Errorf("query range: %w", err)
	}

	vals := extractValues(raw)
	if len(vals) < 3 {
		return map[string]interface{}{
			"resource_id":      resourceID,
			"metric_name":      metricName,
			"horizon":          horizon,
			"point_estimate":   nil,
			"confidence_low":   nil,
			"confidence_high":  nil,
			"confidence_level": 0,
			"method":           "insufficient_data",
			"data_points":      len(vals),
		}, nil
	}

	// Try ARIMA when we have >=20 points; fall back to linear regression on NaN/Inf.
	var pointEstimate float64
	var stdErr float64
	method := "linear_regression"

	if len(vals) >= 20 {
		model := forecast.NewARIMA(2, 1, 1)
		if fitErr := model.Fit(vals); fitErr == nil {
			stepsPerInterval := int(math.Ceil(dur.Minutes() / 5.0))
			if stepsPerInterval < 1 {
				stepsPerInterval = 1
			}
			result, fErr := model.Forecast(stepsPerInterval)
			if fErr == nil && len(result.Values) > 0 {
				pe := result.Values[len(result.Values)-1]
				se := result.StdError
				// Only accept ARIMA result if values are finite
				if !math.IsNaN(pe) && !math.IsInf(pe, 0) && !math.IsNaN(se) && !math.IsInf(se, 0) {
					pointEstimate = pe
					stdErr = se
					method = "arima_2_1_1"
				}
			}
		}
	}

	// Fallback / complement with linear regression
	if method == "linear_regression" {
		slope, intercept := linearRegression(vals)
		stepsAhead := dur.Minutes() / 5.0
		pointEstimate = intercept + slope*float64(len(vals)-1+int(stepsAhead))
		// Residual std for CI
		residuals := make([]float64, len(vals))
		for i, v := range vals {
			pred := intercept + slope*float64(i)
			residuals[i] = v - pred
		}
		stdErr = stdDev(residuals)
	}

	// 95% CI: ±1.96 * stdErr
	margin := 1.96 * stdErr
	confidenceLevel := 95
	if stdErr == 0 {
		margin = math.Abs(pointEstimate) * 0.05
		confidenceLevel = 80
	}

	return map[string]interface{}{
		"resource_id":      resourceID,
		"metric_name":      metricName,
		"horizon":          horizon,
		"horizon_seconds":  dur.Seconds(),
		"point_estimate":   safeFloat(pointEstimate),
		"confidence_low":   safeFloat(pointEstimate - margin),
		"confidence_high":  safeFloat(pointEstimate + margin),
		"confidence_level": confidenceLevel,
		"std_error":        safeFloat(stdErr),
		"method":           method,
		"data_points":      len(vals),
		"forecast_at":      now.Add(dur),
	}, nil
}

// PredictThresholdCrossing predicts when a metric will cross a threshold.
func (p *predictorImpl) PredictThresholdCrossing(ctx context.Context, resourceID, metricName string, threshold float64, direction string) (interface{}, error) {
	now := time.Now()
	raw, err := p.ts.QueryRange(ctx, resourceID, metricName, now.Add(-6*time.Hour), now, "5m")
	if err != nil {
		return nil, err
	}

	vals := extractValues(raw)
	if len(vals) < 5 {
		return map[string]interface{}{
			"resource_id": resourceID,
			"metric_name": metricName,
			"threshold":   threshold,
			"direction":   direction,
			"found":       false,
			"is_imminent": false,
			"confidence":  0,
			"data_points": len(vals),
		}, nil
	}

	slope, intercept := linearRegression(vals)

	// Current trend value (at last data point index)
	current := intercept + slope*float64(len(vals)-1)

	// Find crossing step
	var crossingSteps float64 = -1
	if math.Abs(slope) > 1e-9 {
		// y = intercept + slope * x  => x = (y - intercept) / slope
		crossingSteps = (threshold - intercept) / slope
	}

	found := false
	isImminent := false
	var predictedTime *time.Time
	var confidence int

	if crossingSteps > float64(len(vals)-1) {
		// Crossing is in the future
		stepsFromNow := crossingSteps - float64(len(vals)-1)
		durationToEvent := time.Duration(stepsFromNow*5) * time.Minute
		t := now.Add(durationToEvent)
		predictedTime = &t
		found = true
		isImminent = durationToEvent < time.Hour

		// Higher confidence for stronger trends
		r2 := rSquared(vals, slope, intercept)
		confidence = int(r2 * 100)
	}

	return map[string]interface{}{
		"resource_id":    resourceID,
		"metric_name":    metricName,
		"threshold":      threshold,
		"direction":      direction,
		"current_value":  current,
		"current_slope":  slope,
		"found":          found,
		"predicted_time": predictedTime,
		"is_imminent":    isImminent,
		"confidence":     confidence,
	}, nil
}

// ForecastCapacityExhaustion predicts when CPU/memory will exhaust for a resource.
func (p *predictorImpl) ForecastCapacityExhaustion(ctx context.Context, resourceID string) (interface{}, error) {
	now := time.Now()

	metrics := []struct {
		name     string
		capacity float64 // normalized: 100 = full
	}{
		{"cpu_usage", 100},
		{"memory_usage", 100},
		{"restart_count", 10},
	}

	results := make([]map[string]interface{}, 0, len(metrics))
	criticalFound := false
	var earliestExhaustion *time.Time
	var recommendedAction string

	for _, m := range metrics {
		raw, err := p.ts.QueryRange(ctx, resourceID, m.name, now.Add(-3*time.Hour), now, "5m")
		if err != nil {
			continue
		}
		vals := extractValues(raw)
		if len(vals) < 5 {
			continue
		}

		slope, intercept := linearRegression(vals)
		current := intercept + slope*float64(len(vals)-1)

		var hoursRemaining float64 = -1
		exhaustsAt := "never"
		if slope > 0 {
			stepsToFull := (m.capacity - current) / slope
			if stepsToFull > 0 {
				hrs := stepsToFull * 5.0 / 60.0
				hoursRemaining = hrs
				t := now.Add(time.Duration(hrs * float64(time.Hour)))
				exhaustsAt = t.Format(time.RFC3339)
				if hrs < 24 && (earliestExhaustion == nil || t.Before(*earliestExhaustion)) {
					earliestExhaustion = &t
					criticalFound = true
					recommendedAction = fmt.Sprintf("Scale %s or reduce %s usage; exhaustion predicted in %.1fh", resourceID, m.name, hrs)
				}
			}
		}

		results = append(results, map[string]interface{}{
			"metric":          m.name,
			"current_value":   current,
			"capacity":        m.capacity,
			"utilization_pct": current / m.capacity * 100,
			"slope_per_5m":    slope,
			"hours_remaining": hoursRemaining,
			"exhausts_at":     exhaustsAt,
		})
	}

	if recommendedAction == "" {
		recommendedAction = "Resource usage is stable; no immediate action required"
	}

	return map[string]interface{}{
		"resource_id":         resourceID,
		"critical":            criticalFound,
		"earliest_exhaustion": earliestExhaustion,
		"recommended_action":  recommendedAction,
		"metric_forecasts":    results,
	}, nil
}

// AnalyzeTrend analyzes the current trend and extrapolates growth rate.
func (p *predictorImpl) AnalyzeTrend(ctx context.Context, resourceID, metricName string) (interface{}, error) {
	now := time.Now()
	raw, err := p.ts.QueryRange(ctx, resourceID, metricName, now.Add(-24*time.Hour), now, "5m")
	if err != nil {
		return nil, err
	}

	vals := extractValues(raw)
	if len(vals) < 5 {
		return map[string]interface{}{
			"resource_id": resourceID,
			"metric_name": metricName,
			"direction":   "unknown",
			"data_points": len(vals),
		}, nil
	}

	slope, intercept := linearRegression(vals)
	r2 := rSquared(vals, slope, intercept)

	current := intercept + slope*float64(len(vals)-1)
	hourlyGrowthRate := slope * 12.0 // 5min steps * 12 = 1 hour

	direction := "flat"
	if slope > 0.01 {
		direction = "increasing"
	} else if slope < -0.01 {
		direction = "decreasing"
	}

	strength := "weak"
	if r2 > 0.8 {
		strength = "strong"
	} else if r2 > 0.5 {
		strength = "moderate"
	}

	// 24h extrapolation
	forecast24h := current + slope*float64(24*12)

	return map[string]interface{}{
		"resource_id":        resourceID,
		"metric_name":        metricName,
		"direction":          direction,
		"strength":           strength,
		"current_value":      safeFloat(current),
		"slope_per_5m":       safeFloat(slope),
		"hourly_growth_rate": safeFloat(hourlyGrowthRate),
		"r_squared":          safeFloat(r2),
		"forecast_24h":       safeFloat(forecast24h),
		"data_points":        len(vals),
	}, nil
}

// CompareForecastToCapacity compares a forecast to a resource capacity limit.
func (p *predictorImpl) CompareForecastToCapacity(ctx context.Context, resourceID, metricName string, capacity float64, horizon string) (interface{}, error) {
	fcast, err := p.ForecastMetric(ctx, resourceID, metricName, horizon)
	if err != nil {
		return nil, err
	}
	fm, ok := fcast.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected forecast type")
	}

	estimate, _ := fm["point_estimate"].(float64)
	willExceed := capacity > 0 && estimate > capacity
	utilizationPct := 0.0
	if capacity > 0 {
		utilizationPct = estimate / capacity * 100
	}

	action := "No action required"
	if willExceed {
		action = fmt.Sprintf("Scale up %s: forecast %.2f exceeds capacity %.2f in %s", resourceID, estimate, capacity, horizon)
	} else if utilizationPct > 80 {
		action = fmt.Sprintf("Monitor %s: %.0f%% of capacity forecasted within %s", resourceID, utilizationPct, horizon)
	}

	return map[string]interface{}{
		"resource_id":        resourceID,
		"metric_name":        metricName,
		"capacity":           capacity,
		"horizon":            horizon,
		"forecast_value":     estimate,
		"utilization_pct":    utilizationPct,
		"will_exceed":        willExceed,
		"recommended_action": action,
		"forecast_detail":    fm,
	}, nil
}

// GetSeasonalPattern detects daily/weekly seasonality using autocorrelation.
func (p *predictorImpl) GetSeasonalPattern(ctx context.Context, resourceID, metricName string) (interface{}, error) {
	now := time.Now()
	// Need at least 48h of data at 5min resolution to detect daily seasonality
	raw, err := p.ts.QueryRange(ctx, resourceID, metricName, now.Add(-48*time.Hour), now, "5m")
	if err != nil {
		return nil, err
	}

	vals := extractValues(raw)
	if len(vals) < 48 {
		return map[string]interface{}{
			"resource_id":     resourceID,
			"metric_name":     metricName,
			"has_seasonality": false,
			"reason":          "insufficient_data",
			"data_points":     len(vals),
		}, nil
	}

	// Autocorrelation at lag = 288 (daily period: 24h * 60 / 5 = 288 steps)
	dailyPeriod := 288
	acfDaily := 0.0
	if len(vals) > dailyPeriod {
		acfDaily = autocorrelation(vals, dailyPeriod)
	}

	hasSeasonality := acfDaily > 0.4
	strength := "none"
	if acfDaily > 0.7 {
		strength = "strong"
	} else if acfDaily > 0.4 {
		strength = "moderate"
	}

	return map[string]interface{}{
		"resource_id":     resourceID,
		"metric_name":     metricName,
		"has_seasonality": hasSeasonality,
		"period":          "daily",
		"period_points":   dailyPeriod,
		"acf_at_period":   acfDaily,
		"strength":        strength,
		"data_points":     len(vals),
	}, nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// extractValues extracts float64 values from QueryRange result ([]map[string]interface{}).
func extractValues(raw interface{}) []float64 {
	if raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []map[string]interface{}:
		vals := make([]float64, 0, len(v))
		for _, pt := range v {
			if val, ok := pt["value"].(float64); ok {
				vals = append(vals, val)
			}
		}
		return vals
	case []interface{}:
		vals := make([]float64, 0, len(v))
		for _, item := range v {
			if pt, ok := item.(map[string]interface{}); ok {
				if val, ok2 := pt["value"].(float64); ok2 {
					vals = append(vals, val)
				}
			}
		}
		return vals
	}
	return nil
}

// linearRegression returns (slope, intercept) via least-squares.
func linearRegression(vals []float64) (slope, intercept float64) {
	n := float64(len(vals))
	if n < 2 {
		return 0, 0
	}
	sumX, sumY, sumXY, sumX2 := 0.0, 0.0, 0.0, 0.0
	for i, v := range vals {
		x := float64(i)
		sumX += x
		sumY += v
		sumXY += x * v
		sumX2 += x * x
	}
	denom := n*sumX2 - sumX*sumX
	if math.Abs(denom) < 1e-12 {
		return 0, sumY / n
	}
	slope = (n*sumXY - sumX*sumY) / denom
	intercept = (sumY - slope*sumX) / n
	return
}

// rSquared returns the coefficient of determination for the linear fit.
func rSquared(vals []float64, slope, intercept float64) float64 {
	if len(vals) < 2 {
		return 0
	}
	mean := 0.0
	for _, v := range vals {
		mean += v
	}
	mean /= float64(len(vals))

	ssTot, ssRes := 0.0, 0.0
	for i, v := range vals {
		pred := intercept + slope*float64(i)
		ssRes += (v - pred) * (v - pred)
		ssTot += (v - mean) * (v - mean)
	}
	if ssTot < 1e-12 {
		return 1.0
	}
	r2 := 1.0 - ssRes/ssTot
	if r2 < 0 {
		return 0
	}
	return r2
}

// stdDev returns the sample standard deviation.
func stdDev(vals []float64) float64 {
	n := float64(len(vals))
	if n < 2 {
		return 0
	}
	mean := 0.0
	for _, v := range vals {
		mean += v
	}
	mean /= n
	variance := 0.0
	for _, v := range vals {
		d := v - mean
		variance += d * d
	}
	return math.Sqrt(variance / (n - 1))
}

// autocorrelation computes Pearson autocorrelation at a given lag.
func autocorrelation(vals []float64, lag int) float64 {
	n := len(vals) - lag
	if n <= 0 {
		return 0
	}
	mean := 0.0
	for _, v := range vals {
		mean += v
	}
	mean /= float64(len(vals))

	num, den1, den2 := 0.0, 0.0, 0.0
	for i := 0; i < n; i++ {
		a := vals[i] - mean
		b := vals[i+lag] - mean
		num += a * b
		den1 += a * a
		den2 += b * b
	}
	denom := math.Sqrt(den1 * den2)
	if denom < 1e-12 {
		return 0
	}
	return num / denom
}

// safeFloat returns 0 if v is NaN or Inf, otherwise returns v.
// This ensures all float values are JSON-serializable.
func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// parseDuration parses strings like "1h", "1d", "1w", "30d".
func parseDuration(s string) (time.Duration, error) {
	if len(s) == 0 {
		return 0, fmt.Errorf("empty duration")
	}
	unit := s[len(s)-1]
	numStr := s[:len(s)-1]
	var num float64
	if _, err := fmt.Sscanf(numStr, "%f", &num); err != nil {
		return 0, fmt.Errorf("cannot parse %q", s)
	}
	switch unit {
	case 'h':
		return time.Duration(num * float64(time.Hour)), nil
	case 'd':
		return time.Duration(num * 24 * float64(time.Hour)), nil
	case 'w':
		return time.Duration(num * 7 * 24 * float64(time.Hour)), nil
	case 'm':
		return time.Duration(num * float64(time.Minute)), nil
	case 's':
		return time.Duration(num * float64(time.Second)), nil
	}
	return 0, fmt.Errorf("unknown duration unit %q in %q", string(unit), s)
}
