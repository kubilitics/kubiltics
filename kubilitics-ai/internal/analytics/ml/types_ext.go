package ml

import (
	"errors"

	"github.com/kubilitics/kubilitics-ai/internal/analytics/forecast"
)

// Severity represents the severity level of an anomaly detected by IsolationForest.
type Severity string

const (
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

// MLForecastResult wraps the forecast result with field names expected by integration tests.
type MLForecastResult struct {
	Predictions     []float64
	Lower95         []float64
	Upper95         []float64
	ConfidenceLevel float64
	StdError        float64
}

// MLARIMAModel wraps forecast.ARIMA with the API expected by ml integration tests.
type MLARIMAModel struct {
	inner  *forecast.ARIMA
	fitted bool
}

// NewARIMA creates a new ARIMA model accessible from the ml package.
func NewARIMA(p, d, q int) *MLARIMAModel {
	return &MLARIMAModel{
		inner: forecast.NewARIMA(p, d, q),
	}
}

// Fit trains the ARIMA model on the provided time-series.
func (m *MLARIMAModel) Fit(timeSeries []float64) error {
	if err := m.inner.Fit(timeSeries); err != nil {
		return err
	}
	m.fitted = true
	return nil
}

// Forecast generates predictions for the given number of steps.
func (m *MLARIMAModel) Forecast(steps int) (*MLForecastResult, error) {
	if !m.fitted {
		return nil, errors.New("model not fitted")
	}
	result, err := m.inner.Forecast(steps)
	if err != nil {
		return nil, err
	}
	return &MLForecastResult{
		Predictions:     result.Values,
		Lower95:         result.Lower95,
		Upper95:         result.Upper95,
		ConfidenceLevel: result.Confidence,
		StdError:        result.StdError,
	}, nil
}
