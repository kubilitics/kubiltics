package forecast

import (
	"math"
	"testing"
)

func TestARIMA_BasicFit(t *testing.T) {
	// Simple increasing series
	data := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

	model := NewARIMA(1, 0, 0) // AR(1) model
	err := model.Fit(data)
	if err != nil {
		t.Fatalf("Fit failed: %v", err)
	}

	if !model.fitted {
		t.Error("Model should be marked as fitted")
	}
}

func TestARIMA_Forecast(t *testing.T) {
	// Generate simple linear trend
	data := make([]float64, 20)
	for i := range data {
		data[i] = float64(i) + 1
	}

	model := NewARIMA(1, 1, 1) // ARIMA(1,1,1)
	err := model.Fit(data)
	if err != nil {
		t.Fatalf("Fit failed: %v", err)
	}

	// Forecast 5 steps ahead
	result, err := model.Forecast(5)
	if err != nil {
		t.Fatalf("Forecast failed: %v", err)
	}

	if len(result.Values) != 5 {
		t.Errorf("Expected 5 forecast values, got %d", len(result.Values))
	}

	if len(result.Lower95) != 5 {
		t.Errorf("Expected 5 lower bound values, got %d", len(result.Lower95))
	}

	if len(result.Upper95) != 5 {
		t.Errorf("Expected 5 upper bound values, got %d", len(result.Upper95))
	}

	// Check that confidence intervals are properly ordered
	for i := range result.Values {
		if result.Lower95[i] > result.Values[i] {
			t.Errorf("Lower bound should be less than forecast at step %d", i)
		}
		if result.Upper95[i] < result.Values[i] {
			t.Errorf("Upper bound should be greater than forecast at step %d", i)
		}
	}

	// Check confidence intervals widen over time
	for i := 1; i < len(result.Values); i++ {
		interval_prev := result.Upper95[i-1] - result.Lower95[i-1]
		interval_curr := result.Upper95[i] - result.Lower95[i]
		if interval_curr < interval_prev {
			t.Errorf("Confidence interval should widen over time")
		}
	}
}

func TestARIMA_Differencing(t *testing.T) {
	model := NewARIMA(1, 1, 0)

	// Test first-order differencing
	series := []float64{1, 3, 6, 10, 15}
	diff1 := model.difference(series, 1)

	expected := []float64{2, 3, 4, 5}
	if len(diff1) != len(expected) {
		t.Errorf("Expected length %d, got %d", len(expected), len(diff1))
	}

	for i, v := range diff1 {
		if math.Abs(v-expected[i]) > 0.0001 {
			t.Errorf("At index %d: expected %f, got %f", i, expected[i], v)
		}
	}

	// Test second-order differencing
	diff2 := model.difference(series, 2)
	if len(diff2) != 3 {
		t.Errorf("Expected length 3, got %d", len(diff2))
	}
}

func TestARIMA_ACF(t *testing.T) {
	model := NewARIMA(2, 0, 0)

	// Simple series
	series := []float64{1, 2, 3, 4, 5, 6, 7, 8}

	acf := model.calculateACF(series, 3)

	// ACF at lag 0 should be 1
	if math.Abs(acf[0]-1.0) > 0.0001 {
		t.Errorf("ACF at lag 0 should be 1, got %f", acf[0])
	}

	// ACF should be between -1 and 1
	for i, v := range acf {
		if v < -1 || v > 1 {
			t.Errorf("ACF at lag %d should be between -1 and 1, got %f", i, v)
		}
	}
}

func TestARIMA_InsufficientData(t *testing.T) {
	model := NewARIMA(5, 2, 3) // Requires many data points

	// Insufficient data
	data := []float64{1, 2, 3}

	err := model.Fit(data)
	if err == nil {
		t.Error("Expected error for insufficient data")
	}
}

func TestARIMA_ForecastBeforeFit(t *testing.T) {
	model := NewARIMA(1, 0, 1)

	// Try to forecast before fitting
	_, err := model.Forecast(5)
	if err == nil {
		t.Error("Expected error when forecasting before fitting")
	}
}

func TestARIMA_ZeroSteps(t *testing.T) {
	model := NewARIMA(1, 0, 1)

	data := []float64{1, 2, 3, 4, 5}
	model.Fit(data)

	// Forecast zero steps
	_, err := model.Forecast(0)
	if err == nil {
		t.Error("Expected error for zero steps")
	}
}

func TestARIMA_GetModelInfo(t *testing.T) {
	model := NewARIMA(2, 1, 1)

	data := make([]float64, 30)
	for i := range data {
		data[i] = float64(i) + 1
	}

	model.Fit(data)

	info := model.GetModelInfo()

	// Check that all expected fields are present
	if _, ok := info["order"]; !ok {
		t.Error("Model info missing 'order' field")
	}

	if _, ok := info["fitted"]; !ok {
		t.Error("Model info missing 'fitted' field")
	}

	if _, ok := info["ar_coeffs"]; !ok {
		t.Error("Model info missing 'ar_coeffs' field")
	}

	if _, ok := info["ma_coeffs"]; !ok {
		t.Error("Model info missing 'ma_coeffs' field")
	}

	// Check fitted status
	if fitted, ok := info["fitted"].(bool); !ok || !fitted {
		t.Error("Model should be marked as fitted")
	}
}

func TestARIMA_ConstantSeries(t *testing.T) {
	// All values the same
	data := []float64{5, 5, 5, 5, 5, 5, 5, 5, 5, 5}

	model := NewARIMA(1, 0, 0)
	err := model.Fit(data)
	if err != nil {
		t.Fatalf("Fit failed on constant series: %v", err)
	}

	result, err := model.Forecast(3)
	if err != nil {
		t.Fatalf("Forecast failed on constant series: %v", err)
	}

	// Forecasts should be close to the constant value
	for i, v := range result.Values {
		if math.Abs(v-5.0) > 2.0 {
			t.Errorf("Forecast %d should be close to 5, got %f", i, v)
		}
	}
}

func BenchmarkARIMA_Fit(b *testing.B) {
	data := make([]float64, 100)
	for i := range data {
		data[i] = float64(i) + math.Sin(float64(i)*0.1)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		model := NewARIMA(2, 1, 2)
		model.Fit(data)
	}
}

func BenchmarkARIMA_Forecast(b *testing.B) {
	data := make([]float64, 100)
	for i := range data {
		data[i] = float64(i) + math.Sin(float64(i)*0.1)
	}

	model := NewARIMA(2, 1, 2)
	model.Fit(data)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		model.Forecast(10)
	}
}
