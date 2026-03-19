package ml

import (
	"math"
	"math/rand"
	"sort"
	"time"
)

// IsolationTree represents a single tree in the Isolation Forest
type IsolationTree struct {
	splitFeature int
	splitValue   float64
	left         *IsolationTree
	right        *IsolationTree
	size         int
	isLeaf       bool
}

// IsolationForest implements the Isolation Forest algorithm for anomaly detection
type IsolationForest struct {
	trees         []*IsolationTree
	numTrees      int
	subSampleSize int
	maxDepth      int
	rng           *rand.Rand
}

// DataPoint represents a multi-dimensional data point
type DataPoint struct {
	Features  []float64
	Label     string    // Optional label for debugging
	Timestamp time.Time // Optional timestamp for time-series use
	Value     float64   // Optional scalar value for time-series use
}

// AnomalyResult contains the anomaly score and details
type AnomalyResult struct {
	Score       float64 // 0.0 to 1.0, higher = more anomalous
	IsAnomaly   bool
	PathLength  float64
	Explanation string
	Severity    Severity // low, medium, high, critical
}

// NewIsolationForest creates a new Isolation Forest with specified parameters
func NewIsolationForest(numTrees, subSampleSize, maxDepth int) *IsolationForest {
	return &IsolationForest{
		trees:         make([]*IsolationTree, 0, numTrees),
		numTrees:      numTrees,
		subSampleSize: subSampleSize,
		maxDepth:      maxDepth,
		rng:           rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// normalizeDataPoints ensures every DataPoint has a populated Features slice.
// If Features is empty but Value is set, we use [Value] as a 1-D feature vector.
func normalizeDataPoints(data []DataPoint) []DataPoint {
	normalized := make([]DataPoint, len(data))
	for i, dp := range data {
		if len(dp.Features) == 0 {
			dp.Features = []float64{dp.Value}
		}
		normalized[i] = dp
	}
	return normalized
}

// Fit trains the Isolation Forest on the given data
func (f *IsolationForest) Fit(data []DataPoint) error {
	if len(data) == 0 {
		return nil
	}

	// Ensure all data points have features populated
	data = normalizeDataPoints(data)

	// Build multiple isolation trees
	for i := 0; i < f.numTrees; i++ {
		// Sample subset of data
		sample := f.sampleData(data)

		// Build tree
		tree := f.buildTree(sample, 0)
		f.trees = append(f.trees, tree)
	}

	return nil
}

// Predict calculates the anomaly score for a single data point
func (f *IsolationForest) Predict(point DataPoint) AnomalyResult {
	if len(point.Features) == 0 {
		point.Features = []float64{point.Value}
	}
	if len(f.trees) == 0 {
		return AnomalyResult{
			Score:       0.5,
			IsAnomaly:   false,
			Explanation: "Model not trained",
		}
	}

	// Calculate average path length across all trees
	totalPathLength := 0.0
	for _, tree := range f.trees {
		pathLength := f.pathLength(tree, point, 0)
		totalPathLength += pathLength
	}

	avgPathLength := totalPathLength / float64(len(f.trees))

	// Calculate anomaly score using the formula:
	// score = 2^(-avgPathLength / c(n))
	// where c(n) is the average path length of unsuccessful search in BST
	c := f.averagePathLength(f.subSampleSize)
	score := math.Pow(2, -avgPathLength/c)

	// Threshold for anomaly: typically score > 0.6
	isAnomaly := score > 0.6

	explanation := f.explainScore(score, avgPathLength)

	severity := scoreSeverity(score)

	return AnomalyResult{
		Score:       score,
		IsAnomaly:   isAnomaly,
		PathLength:  avgPathLength,
		Explanation: explanation,
		Severity:    severity,
	}
}

// scoreSeverity maps anomaly score to a severity level.
func scoreSeverity(score float64) Severity {
	if score > 0.85 {
		return SeverityCritical
	} else if score > 0.75 {
		return SeverityHigh
	} else if score > 0.65 {
		return SeverityMedium
	}
	return SeverityLow
}

// sampleData randomly samples a subset of data
func (f *IsolationForest) sampleData(data []DataPoint) []DataPoint {
	sampleSize := f.subSampleSize
	if sampleSize > len(data) {
		sampleSize = len(data)
	}

	// Fisher-Yates shuffle and take first sampleSize elements
	shuffled := make([]DataPoint, len(data))
	copy(shuffled, data)

	for i := len(shuffled) - 1; i > 0; i-- {
		j := f.rng.Intn(i + 1)
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	}

	return shuffled[:sampleSize]
}

// buildTree recursively builds an isolation tree
func (f *IsolationForest) buildTree(data []DataPoint, depth int) *IsolationTree {
	// Terminal conditions
	if len(data) <= 1 || depth >= f.maxDepth {
		return &IsolationTree{
			size:   len(data),
			isLeaf: true,
		}
	}

	// Check if all points are identical
	if f.allIdentical(data) {
		return &IsolationTree{
			size:   len(data),
			isLeaf: true,
		}
	}

	// Randomly select a feature and split value
	numFeatures := len(data[0].Features)
	splitFeature := f.rng.Intn(numFeatures)

	minVal, maxVal := f.getFeatureRange(data, splitFeature)
	splitValue := minVal + f.rng.Float64()*(maxVal-minVal)

	// Split data
	left, right := f.splitData(data, splitFeature, splitValue)

	// If split didn't partition the data, make it a leaf
	if len(left) == 0 || len(right) == 0 {
		return &IsolationTree{
			size:   len(data),
			isLeaf: true,
		}
	}

	// Recursively build subtrees
	return &IsolationTree{
		splitFeature: splitFeature,
		splitValue:   splitValue,
		left:         f.buildTree(left, depth+1),
		right:        f.buildTree(right, depth+1),
		size:         len(data),
		isLeaf:       false,
	}
}

// pathLength calculates the path length for a data point in a tree
func (f *IsolationForest) pathLength(tree *IsolationTree, point DataPoint, currentDepth int) float64 {
	if tree.isLeaf {
		// Add average path length for remaining points in leaf
		return float64(currentDepth) + f.averagePathLength(tree.size)
	}

	if point.Features[tree.splitFeature] < tree.splitValue {
		return f.pathLength(tree.left, point, currentDepth+1)
	}
	return f.pathLength(tree.right, point, currentDepth+1)
}

// averagePathLength calculates the average path length of unsuccessful search in BST
// This is the expected path length for a balanced binary tree
func (f *IsolationForest) averagePathLength(n int) float64 {
	if n <= 1 {
		return 0
	}
	if n == 2 {
		return 1
	}

	// c(n) = 2H(n-1) - (2(n-1)/n)
	// where H(n) is the harmonic number
	harmonicNumber := f.harmonicNumber(n - 1)
	return 2*harmonicNumber - (2 * float64(n-1) / float64(n))
}

// harmonicNumber calculates the nth harmonic number
func (f *IsolationForest) harmonicNumber(n int) float64 {
	// H(n) ≈ ln(n) + 0.5772156649 (Euler-Mascheroni constant)
	return math.Log(float64(n)) + 0.5772156649
}

// allIdentical checks if all data points are identical
func (f *IsolationForest) allIdentical(data []DataPoint) bool {
	if len(data) <= 1 {
		return true
	}

	first := data[0].Features
	for i := 1; i < len(data); i++ {
		for j := range first {
			if math.Abs(data[i].Features[j]-first[j]) > 1e-10 {
				return false
			}
		}
	}
	return true
}

// getFeatureRange gets min and max values for a feature
func (f *IsolationForest) getFeatureRange(data []DataPoint, feature int) (float64, float64) {
	minVal := data[0].Features[feature]
	maxVal := data[0].Features[feature]

	for _, point := range data {
		val := point.Features[feature]
		if val < minVal {
			minVal = val
		}
		if val > maxVal {
			maxVal = val
		}
	}

	return minVal, maxVal
}

// splitData splits data based on feature and split value
func (f *IsolationForest) splitData(data []DataPoint, feature int, splitValue float64) ([]DataPoint, []DataPoint) {
	left := make([]DataPoint, 0)
	right := make([]DataPoint, 0)

	for _, point := range data {
		if point.Features[feature] < splitValue {
			left = append(left, point)
		} else {
			right = append(right, point)
		}
	}

	return left, right
}

// explainScore provides a human-readable explanation of the anomaly score
func (f *IsolationForest) explainScore(score, pathLength float64) string {
	if score > 0.7 {
		return "Strong anomaly - significantly different from normal patterns"
	} else if score > 0.6 {
		return "Likely anomaly - deviates from normal behavior"
	} else if score > 0.5 {
		return "Borderline - slightly unusual but within normal variation"
	} else {
		return "Normal - consistent with expected patterns"
	}
}

// BatchPredict predicts anomaly scores for multiple data points
func (f *IsolationForest) BatchPredict(points []DataPoint) []AnomalyResult {
	results := make([]AnomalyResult, len(points))
	for i, point := range points {
		results[i] = f.Predict(point)
	}
	return results
}

// GetAnomalies returns only the points classified as anomalies
func (f *IsolationForest) GetAnomalies(points []DataPoint, threshold float64) []struct {
	Point  DataPoint
	Result AnomalyResult
} {
	anomalies := make([]struct {
		Point  DataPoint
		Result AnomalyResult
	}, 0)

	for _, point := range points {
		result := f.Predict(point)
		if result.Score > threshold {
			anomalies = append(anomalies, struct {
				Point  DataPoint
				Result AnomalyResult
			}{point, result})
		}
	}

	// Sort by score descending
	sort.Slice(anomalies, func(i, j int) bool {
		return anomalies[i].Result.Score > anomalies[j].Result.Score
	})

	return anomalies
}
