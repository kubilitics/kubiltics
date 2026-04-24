package analytics

import (
	"context"
	"math"
	"testing"
	"time"
)

func TestNewEngine(t *testing.T) {
	engine := NewEngine()
	if engine == nil {
		t.Fatal("NewEngine() returned nil")
	}

	if engine.zScoreThreshold != 3.0 {
		t.Errorf("Expected default zScoreThreshold 3.0, got %.2f", engine.zScoreThreshold)
	}

	if engine.movingAverageWindow != 10 {
		t.Errorf("Expected default movingAverageWindow 10, got %d", engine.movingAverageWindow)
	}
}

func TestCalculateStatistics(t *testing.T) {
	engine := NewEngine()

	// Create sample data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
	data := make([]DataPoint, 10)
	for i := 0; i < 10; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     float64(i + 1),
		}
	}

	ts := &TimeSeries{
		MetricName: "test_metric",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	stats, err := engine.CalculateStatistics(context.Background(), ts)
	if err != nil {
		t.Fatalf("CalculateStatistics() error: %v", err)
	}

	// Mean of [1..10] = 5.5
	expectedMean := 5.5
	if math.Abs(stats.Mean-expectedMean) > 0.01 {
		t.Errorf("Expected mean %.2f, got %.2f", expectedMean, stats.Mean)
	}

	// Median of [1..10] = 5.5
	expectedMedian := 5.5
	if math.Abs(stats.Median-expectedMedian) > 0.01 {
		t.Errorf("Expected median %.2f, got %.2f", expectedMedian, stats.Median)
	}

	// Min = 1, Max = 10
	if stats.Min != 1.0 {
		t.Errorf("Expected min 1.0, got %.2f", stats.Min)
	}
	if stats.Max != 10.0 {
		t.Errorf("Expected max 10.0, got %.2f", stats.Max)
	}

	// Count = 10
	if stats.Count != 10 {
		t.Errorf("Expected count 10, got %d", stats.Count)
	}

	t.Logf("Statistics: Mean=%.2f, Median=%.2f, StdDev=%.2f, P95=%.2f, P99=%.2f",
		stats.Mean, stats.Median, stats.StdDev, stats.P95, stats.P99)
}

func TestDetectAnomalies_Spike(t *testing.T) {
	engine := NewEngine()

	// Create data with a spike: [10, 10, 10, 10, 100, 10, 10, 10]
	data := []DataPoint{
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 100}, // Spike
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
	}

	ts := &TimeSeries{
		MetricName: "cpu_usage",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	anomalies, err := engine.DetectAnomalies(context.Background(), ts, "medium")
	if err != nil {
		t.Fatalf("DetectAnomalies() error: %v", err)
	}

	// Should detect at least the spike
	if len(anomalies) == 0 {
		t.Error("Expected to detect anomalies, got none")
	}

	// Check if spike was detected
	foundSpike := false
	for _, a := range anomalies {
		if a.Type == AnomalyTypeSpike && a.Value == 100 {
			foundSpike = true
			t.Logf("Detected spike: value=%.2f, z-score=%.2f, severity=%s",
				a.Value, a.ZScore, a.Severity)
		}
	}

	if !foundSpike {
		t.Error("Expected to detect spike anomaly")
	}
}

func TestDetectAnomalies_Drop(t *testing.T) {
	engine := NewEngine()

	// Create data with a drop: [100, 100, 100, 100, 10, 100, 100, 100]
	data := []DataPoint{
		{Timestamp: time.Now(), Value: 100},
		{Timestamp: time.Now(), Value: 100},
		{Timestamp: time.Now(), Value: 100},
		{Timestamp: time.Now(), Value: 100},
		{Timestamp: time.Now(), Value: 10}, // Drop
		{Timestamp: time.Now(), Value: 100},
		{Timestamp: time.Now(), Value: 100},
		{Timestamp: time.Now(), Value: 100},
	}

	ts := &TimeSeries{
		MetricName: "throughput",
		MetricType: MetricTypeThroughput,
		Data:       data,
	}

	anomalies, err := engine.DetectAnomalies(context.Background(), ts, "medium")
	if err != nil {
		t.Fatalf("DetectAnomalies() error: %v", err)
	}

	// Should detect the drop
	foundDrop := false
	for _, a := range anomalies {
		if a.Type == AnomalyTypeDrop && a.Value == 10 {
			foundDrop = true
			t.Logf("Detected drop: value=%.2f, z-score=%.2f, severity=%s",
				a.Value, a.ZScore, a.Severity)
		}
	}

	if !foundDrop {
		t.Error("Expected to detect drop anomaly")
	}
}

func TestDetectAnomalies_Flapping(t *testing.T) {
	engine := NewEngine()

	// Create flapping data: [10, 50, 10, 50, 10, 50, 10, 50]
	data := make([]DataPoint, 20)
	for i := 0; i < 20; i++ {
		value := 10.0
		if i%2 == 1 {
			value = 50.0
		}
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     value,
		}
	}

	ts := &TimeSeries{
		MetricName: "request_rate",
		MetricType: MetricTypeRequestRate,
		Data:       data,
	}

	anomalies, err := engine.DetectAnomalies(context.Background(), ts, "medium")
	if err != nil {
		t.Fatalf("DetectAnomalies() error: %v", err)
	}

	// Should detect flapping
	foundFlapping := false
	for _, a := range anomalies {
		if a.Type == AnomalyTypeFlapping {
			foundFlapping = true
			t.Logf("Detected flapping: change_rate=%.2f%%, severity=%s",
				a.Deviation*100, a.Severity)
		}
	}

	if !foundFlapping {
		t.Error("Expected to detect flapping anomaly")
	}
}

func TestAnalyzeTrend_Increasing(t *testing.T) {
	engine := NewEngine()

	// Create increasing trend: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
	data := make([]DataPoint, 10)
	for i := 0; i < 10; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     float64(i + 1),
		}
	}

	ts := &TimeSeries{
		MetricName: "memory_usage",
		MetricType: MetricTypeMemory,
		Data:       data,
	}

	trend, err := engine.AnalyzeTrend(context.Background(), ts)
	if err != nil {
		t.Fatalf("AnalyzeTrend() error: %v", err)
	}

	if trend.Direction != "increasing" {
		t.Errorf("Expected direction 'increasing', got '%s'", trend.Direction)
	}

	if trend.Slope <= 0 {
		t.Errorf("Expected positive slope, got %.4f", trend.Slope)
	}

	// For perfect linear data, R² should be very close to 1.0
	if trend.RSquared < 0.95 {
		t.Errorf("Expected high R² (>0.95), got %.3f", trend.RSquared)
	}

	t.Logf("Trend: direction=%s, slope=%.4f, R²=%.3f",
		trend.Direction, trend.Slope, trend.RSquared)
}

func TestAnalyzeTrend_Decreasing(t *testing.T) {
	engine := NewEngine()

	// Create decreasing trend: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
	data := make([]DataPoint, 10)
	for i := 0; i < 10; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     float64(10 - i),
		}
	}

	ts := &TimeSeries{
		MetricName: "error_rate",
		MetricType: MetricTypeErrorRate,
		Data:       data,
	}

	trend, err := engine.AnalyzeTrend(context.Background(), ts)
	if err != nil {
		t.Fatalf("AnalyzeTrend() error: %v", err)
	}

	if trend.Direction != "decreasing" {
		t.Errorf("Expected direction 'decreasing', got '%s'", trend.Direction)
	}

	if trend.Slope >= 0 {
		t.Errorf("Expected negative slope, got %.4f", trend.Slope)
	}

	t.Logf("Trend: direction=%s, slope=%.4f, R²=%.3f",
		trend.Direction, trend.Slope, trend.RSquared)
}

func TestAnalyzeTrend_Stable(t *testing.T) {
	engine := NewEngine()

	// Create stable data: [50, 50, 50, 50, 50, 50, 50, 50]
	data := make([]DataPoint, 8)
	for i := 0; i < 8; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     50.0,
		}
	}

	ts := &TimeSeries{
		MetricName: "latency",
		MetricType: MetricTypeLatency,
		Data:       data,
	}

	trend, err := engine.AnalyzeTrend(context.Background(), ts)
	if err != nil {
		t.Fatalf("AnalyzeTrend() error: %v", err)
	}

	if trend.Direction != "stable" {
		t.Errorf("Expected direction 'stable', got '%s'", trend.Direction)
	}

	t.Logf("Trend: direction=%s, slope=%.4f", trend.Direction, trend.Slope)
}

func TestGenerateRecommendations_Underutilization(t *testing.T) {
	engine := NewEngine()

	// Create low CPU utilization data: [10, 12, 11, 13, 12, 14, 11, 13]
	data := make([]DataPoint, 8)
	values := []float64{10, 12, 11, 13, 12, 14, 11, 13}
	for i := 0; i < 8; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     values[i],
		}
	}

	ts := &TimeSeries{
		MetricName: "cpu_utilization",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	recommendations, err := engine.GenerateRecommendations(context.Background(), "Deployment/nginx", ts)
	if err != nil {
		t.Fatalf("GenerateRecommendations() error: %v", err)
	}

	// Should recommend scale down
	foundScaleDown := false
	for _, rec := range recommendations {
		if rec.Type == "scale_down" {
			foundScaleDown = true
			t.Logf("Recommendation: %s - %s (Priority: %s)",
				rec.Type, rec.Justification, rec.Priority)
		}
	}

	if !foundScaleDown {
		t.Error("Expected scale_down recommendation for underutilization")
	}
}

func TestGenerateRecommendations_Overutilization(t *testing.T) {
	engine := NewEngine()

	// Create high CPU utilization data: [85, 87, 88, 90, 89, 91, 88, 92]
	data := make([]DataPoint, 8)
	values := []float64{85, 87, 88, 90, 89, 91, 88, 92}
	for i := 0; i < 8; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     values[i],
		}
	}

	ts := &TimeSeries{
		MetricName: "cpu_utilization",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	recommendations, err := engine.GenerateRecommendations(context.Background(), "Deployment/app", ts)
	if err != nil {
		t.Fatalf("GenerateRecommendations() error: %v", err)
	}

	// Should recommend scale up
	foundScaleUp := false
	for _, rec := range recommendations {
		if rec.Type == "scale_up" {
			foundScaleUp = true
			t.Logf("Recommendation: %s - %s (Priority: %s)",
				rec.Type, rec.Justification, rec.Priority)
		}
	}

	if !foundScaleUp {
		t.Error("Expected scale_up recommendation for overutilization")
	}
}

func TestGenerateRecommendations_HighRestartCount(t *testing.T) {
	engine := NewEngine()

	// Create restart count data with high values
	data := make([]DataPoint, 8)
	values := []float64{2, 3, 1, 4, 2, 5, 3, 2}
	for i := 0; i < 8; i++ {
		data[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     values[i],
		}
	}

	ts := &TimeSeries{
		MetricName: "restart_count",
		MetricType: MetricTypeRestartCount,
		Data:       data,
	}

	recommendations, err := engine.GenerateRecommendations(context.Background(), "Pod/app-pod", ts)
	if err != nil {
		t.Fatalf("GenerateRecommendations() error: %v", err)
	}

	// Should recommend investigation
	foundInvestigate := false
	for _, rec := range recommendations {
		if rec.Type == "investigate" && rec.Priority == "high" {
			foundInvestigate = true
			t.Logf("Recommendation: %s - %s (Priority: %s)",
				rec.Type, rec.Justification, rec.Priority)
		}
	}

	if !foundInvestigate {
		t.Error("Expected investigate recommendation for high restart count")
	}
}

func TestCompareTimeSeries(t *testing.T) {
	engine := NewEngine()

	// Create first time-series: [10, 12, 11, 13]
	data1 := make([]DataPoint, 4)
	values1 := []float64{10, 12, 11, 13}
	for i := 0; i < 4; i++ {
		data1[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     values1[i],
		}
	}

	// Create second time-series (higher values): [50, 52, 51, 53]
	data2 := make([]DataPoint, 4)
	values2 := []float64{50, 52, 51, 53}
	for i := 0; i < 4; i++ {
		data2[i] = DataPoint{
			Timestamp: time.Now().Add(time.Duration(i) * time.Minute),
			Value:     values2[i],
		}
	}

	ts1 := &TimeSeries{MetricName: "before", MetricType: MetricTypeCPU, Data: data1}
	ts2 := &TimeSeries{MetricName: "after", MetricType: MetricTypeCPU, Data: data2}

	comparison, err := engine.CompareTimeSeries(context.Background(), ts1, ts2)
	if err != nil {
		t.Fatalf("CompareTimeSeries() error: %v", err)
	}

	meanChangePct, ok := comparison["mean_change_pct"].(float64)
	if !ok {
		t.Error("Expected mean_change_pct in comparison result")
	}

	// Mean increased from ~11.5 to ~51.5, so change should be significant
	if meanChangePct <= 0 {
		t.Errorf("Expected positive mean change, got %.2f%%", meanChangePct)
	}

	t.Logf("Comparison: mean_change=%.2f%%, interpretation=%s",
		meanChangePct, comparison["interpretation"])
}

func TestPercentileCalculation(t *testing.T) {
	engine := NewEngine()

	// Create data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
	sortedData := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

	p50 := engine.percentile(sortedData, 50)
	p95 := engine.percentile(sortedData, 95)
	p99 := engine.percentile(sortedData, 99)

	// P50 (median) should be 5.5
	if math.Abs(p50-5.5) > 0.1 {
		t.Errorf("Expected p50 ~5.5, got %.2f", p50)
	}

	// P95 should be close to 9.5
	if p95 < 9.0 || p95 > 10.0 {
		t.Errorf("Expected p95 between 9.0 and 10.0, got %.2f", p95)
	}

	// P99 should be close to 10
	if p99 < 9.5 || p99 > 10.0 {
		t.Errorf("Expected p99 between 9.5 and 10.0, got %.2f", p99)
	}

	t.Logf("Percentiles: p50=%.2f, p95=%.2f, p99=%.2f", p50, p95, p99)
}

func TestDetectAnomalies_InsufficientData(t *testing.T) {
	engine := NewEngine()

	// Only 2 data points
	data := []DataPoint{
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 20},
	}

	ts := &TimeSeries{
		MetricName: "test",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	_, err := engine.DetectAnomalies(context.Background(), ts, "medium")
	if err == nil {
		t.Error("Expected error for insufficient data points")
	}
}

func TestAnalyzeTrend_InsufficientData(t *testing.T) {
	engine := NewEngine()

	// Only 1 data point
	data := []DataPoint{
		{Timestamp: time.Now(), Value: 10},
	}

	ts := &TimeSeries{
		MetricName: "test",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	_, err := engine.AnalyzeTrend(context.Background(), ts)
	if err == nil {
		t.Error("Expected error for insufficient data points")
	}
}

func TestSensitivityLevels(t *testing.T) {
	engine := NewEngine()

	// Create data with mild outlier
	data := []DataPoint{
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 25}, // Mild outlier
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
		{Timestamp: time.Now(), Value: 10},
	}

	ts := &TimeSeries{
		MetricName: "test",
		MetricType: MetricTypeCPU,
		Data:       data,
	}

	// Test high sensitivity (should detect more)
	highSensitivity, _ := engine.DetectAnomalies(context.Background(), ts, "high")

	// Test low sensitivity (should detect fewer)
	lowSensitivity, _ := engine.DetectAnomalies(context.Background(), ts, "low")

	t.Logf("High sensitivity detected %d anomalies", len(highSensitivity))
	t.Logf("Low sensitivity detected %d anomalies", len(lowSensitivity))

	// High sensitivity should detect same or more anomalies than low sensitivity
	if len(highSensitivity) < len(lowSensitivity) {
		t.Error("High sensitivity should detect >= anomalies than low sensitivity")
	}
}
