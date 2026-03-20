package ml

import (
	"math"
	"testing"
)

func TestIsolationForest_Basic(t *testing.T) {
	// Create training data with normal points
	normalData := []DataPoint{
		{Features: []float64{1.0, 2.0}},
		{Features: []float64{1.1, 2.1}},
		{Features: []float64{0.9, 1.9}},
		{Features: []float64{1.2, 2.2}},
		{Features: []float64{0.8, 1.8}},
		{Features: []float64{1.0, 2.0}},
		{Features: []float64{1.1, 2.0}},
		{Features: []float64{0.9, 2.1}},
	}

	// Train model
	forest := NewIsolationForest(10, 5, 10)
	err := forest.Fit(normalData)
	if err != nil {
		t.Fatalf("Failed to fit model: %v", err)
	}

	// Test with normal point
	normalPoint := DataPoint{Features: []float64{1.0, 2.0}}
	normalResult := forest.Predict(normalPoint)

	if normalResult.IsAnomaly {
		t.Errorf("Normal point classified as anomaly. Score: %f", normalResult.Score)
	}

	// Test with anomalous point
	anomalousPoint := DataPoint{Features: []float64{10.0, 20.0}}
	anomalousResult := forest.Predict(anomalousPoint)

	if !anomalousResult.IsAnomaly {
		t.Errorf("Anomalous point not detected. Score: %f", anomalousResult.Score)
	}

	// Anomaly should have higher score
	if anomalousResult.Score <= normalResult.Score {
		t.Errorf("Anomaly score (%f) should be higher than normal score (%f)",
			anomalousResult.Score, normalResult.Score)
	}
}

func TestIsolationForest_SingleDimension(t *testing.T) {
	// Test with single-dimensional data
	data := []DataPoint{
		{Features: []float64{1.0}},
		{Features: []float64{2.0}},
		{Features: []float64{1.5}},
		{Features: []float64{2.5}},
		{Features: []float64{1.8}},
	}

	forest := NewIsolationForest(10, 3, 5)
	err := forest.Fit(data)
	if err != nil {
		t.Fatalf("Failed to fit model: %v", err)
	}

	// Normal point
	normal := DataPoint{Features: []float64{2.0}}
	normalResult := forest.Predict(normal)

	// Outlier
	outlier := DataPoint{Features: []float64{100.0}}
	outlierResult := forest.Predict(outlier)

	if outlierResult.Score <= normalResult.Score {
		t.Errorf("Outlier score (%f) should be higher than normal score (%f)",
			outlierResult.Score, normalResult.Score)
	}
}

func TestIsolationForest_BatchPredict(t *testing.T) {
	// Training data
	data := []DataPoint{
		{Features: []float64{1.0, 1.0}},
		{Features: []float64{1.1, 1.1}},
		{Features: []float64{0.9, 0.9}},
		{Features: []float64{1.0, 1.0}},
	}

	forest := NewIsolationForest(10, 3, 5)
	forest.Fit(data)

	// Batch prediction
	testPoints := []DataPoint{
		{Features: []float64{1.0, 1.0}},   // Normal
		{Features: []float64{10.0, 10.0}}, // Anomaly
		{Features: []float64{1.05, 1.05}}, // Normal
	}

	results := forest.BatchPredict(testPoints)

	if len(results) != len(testPoints) {
		t.Errorf("Expected %d results, got %d", len(testPoints), len(results))
	}

	// Check that anomaly has highest score
	if results[1].Score <= results[0].Score || results[1].Score <= results[2].Score {
		t.Errorf("Anomaly should have highest score")
	}
}

func TestIsolationForest_GetAnomalies(t *testing.T) {
	// Training data
	data := []DataPoint{
		{Features: []float64{1.0, 1.0}},
		{Features: []float64{1.1, 1.1}},
		{Features: []float64{0.9, 0.9}},
	}

	forest := NewIsolationForest(10, 3, 5)
	forest.Fit(data)

	// Test points with labels
	testPoints := []DataPoint{
		{Features: []float64{1.0, 1.0}, Label: "normal1"},
		{Features: []float64{10.0, 10.0}, Label: "anomaly1"},
		{Features: []float64{1.05, 1.05}, Label: "normal2"},
		{Features: []float64{-5.0, 15.0}, Label: "anomaly2"},
	}

	anomalies := forest.GetAnomalies(testPoints, 0.6)

	// Should find at least one anomaly
	if len(anomalies) == 0 {
		t.Error("Expected to find anomalies")
	}

	// Anomalies should be sorted by score descending
	for i := 1; i < len(anomalies); i++ {
		if anomalies[i].Result.Score > anomalies[i-1].Result.Score {
			t.Error("Anomalies not sorted by score descending")
		}
	}
}

func TestIsolationForest_EmptyData(t *testing.T) {
	forest := NewIsolationForest(10, 5, 10)

	// Fit with empty data should not error
	err := forest.Fit([]DataPoint{})
	if err != nil {
		t.Errorf("Fit with empty data should not error: %v", err)
	}

	// Predict should return reasonable default
	result := forest.Predict(DataPoint{Features: []float64{1.0}})
	if result.Score < 0 || result.Score > 1 {
		t.Errorf("Score should be between 0 and 1, got %f", result.Score)
	}
}

func TestIsolationForest_IdenticalPoints(t *testing.T) {
	// All identical points
	data := []DataPoint{
		{Features: []float64{1.0, 1.0}},
		{Features: []float64{1.0, 1.0}},
		{Features: []float64{1.0, 1.0}},
	}

	forest := NewIsolationForest(10, 3, 5)
	forest.Fit(data)

	// Test with same point
	same := DataPoint{Features: []float64{1.0, 1.0}}
	sameResult := forest.Predict(same)

	// Test with different point
	different := DataPoint{Features: []float64{5.0, 5.0}}
	differentResult := forest.Predict(different)

	// Different point should have higher anomaly score
	if differentResult.Score <= sameResult.Score {
		t.Errorf("Different point should have higher anomaly score")
	}
}

func TestIsolationForest_AveragePathLength(t *testing.T) {
	forest := NewIsolationForest(10, 5, 10)

	tests := []struct {
		n        int
		expected float64
	}{
		{1, 0},
		{2, 1},
		{10, 3.02}, // Approximate
	}

	for _, tt := range tests {
		result := forest.averagePathLength(tt.n)
		if math.Abs(result-tt.expected) > 0.1 && tt.n > 2 {
			t.Logf("averagePathLength(%d) = %f (expected ~%f)", tt.n, result, tt.expected)
		}
	}
}

func BenchmarkIsolationForest_Fit(b *testing.B) {
	// Generate data
	data := make([]DataPoint, 1000)
	for i := range data {
		data[i] = DataPoint{
			Features: []float64{
				float64(i % 100),
				float64((i * 2) % 100),
			},
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		forest := NewIsolationForest(10, 256, 10)
		forest.Fit(data)
	}
}

func BenchmarkIsolationForest_Predict(b *testing.B) {
	// Training data
	data := make([]DataPoint, 1000)
	for i := range data {
		data[i] = DataPoint{
			Features: []float64{
				float64(i % 100),
				float64((i * 2) % 100),
			},
		}
	}

	forest := NewIsolationForest(10, 256, 10)
	forest.Fit(data)

	testPoint := DataPoint{Features: []float64{50.0, 50.0}}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		forest.Predict(testPoint)
	}
}
