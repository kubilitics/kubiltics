package spof

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// helper: build a DetectInput with the given nodes and scores.
func buildTestInput(nodes []NodeInfo, scores map[string]ScoreInfo) DetectInput {
	return DetectInput{
		ClusterID:         "test-cluster",
		Nodes:             nodes,
		CriticalityScores: scores,
	}
}

func TestDetect_SingleReplicaWithDependents(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Deployment/default/api", Name: "api", Kind: "Deployment", Namespace: "default", Replicas: 1, HasPDB: false, HasHPA: false},
	}
	scores := map[string]ScoreInfo{
		"Deployment/default/api": {Score: 80, Level: "critical", FanIn: 3, FanOut: 1, IsSPOF: true, BlastRadius: 3},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	require.Equal(t, 1, inv.TotalSPOFs)
	item := inv.Items[0]
	assert.Equal(t, "api", item.Name)
	assert.Equal(t, "Deployment", item.Kind)
	assert.Equal(t, "default", item.Namespace)
	assert.Equal(t, "single-replica", item.ReasonCode)
	assert.Contains(t, item.Reason, "Single replica")
	assert.Equal(t, 80.0, item.BlastRadiusScore)
	assert.Equal(t, "critical", item.BlastRadiusLevel)
	assert.Equal(t, 3, item.DependentCount)
	assert.NotEmpty(t, item.Remediations)
}

func TestDetect_ThreeReplicas_NotSPOF(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Deployment/default/web", Name: "web", Kind: "Deployment", Namespace: "default", Replicas: 3, HasPDB: true, HasHPA: true},
	}
	scores := map[string]ScoreInfo{
		"Deployment/default/web": {Score: 40, Level: "medium", FanIn: 2, FanOut: 1, IsSPOF: false, BlastRadius: 2},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	assert.Equal(t, 0, inv.TotalSPOFs)
	assert.Empty(t, inv.Items)
}

func TestDetect_SingleReplicaWithHPA_NotSPOF(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Deployment/default/worker", Name: "worker", Kind: "Deployment", Namespace: "default", Replicas: 1, HasPDB: false, HasHPA: true},
	}
	scores := map[string]ScoreInfo{
		// IsSPOF is false because HasHPA is true (matches the graph engine logic: replicas <= 1 && !hasHPA && fanIn > 0)
		"Deployment/default/worker": {Score: 30, Level: "medium", FanIn: 2, FanOut: 0, IsSPOF: false, BlastRadius: 2},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	assert.Equal(t, 0, inv.TotalSPOFs)
	assert.Empty(t, inv.Items)
}

func TestDetect_HighFanIn_CriticalPriority(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Service/default/gateway", Name: "gateway", Kind: "Service", Namespace: "default", Replicas: 1, HasPDB: false, HasHPA: false},
	}
	scores := map[string]ScoreInfo{
		"Service/default/gateway": {Score: 90, Level: "critical", FanIn: 8, FanOut: 0, IsSPOF: true, BlastRadius: 8},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	require.Equal(t, 1, inv.TotalSPOFs)
	item := inv.Items[0]

	// Should detect "critical-hub" reason because fanIn > 5 && replicas == 1.
	assert.Equal(t, "critical-hub", item.ReasonCode)
	assert.Contains(t, item.Reason, "8 workloads depend")

	// The "scale" remediation should have "critical" priority when fanIn > 5.
	var scalePriority string
	for _, r := range item.Remediations {
		if r.Type == "scale" {
			scalePriority = r.Priority
		}
	}
	assert.Equal(t, "critical", scalePriority)
}

func TestDetect_SortOrder_HighestBlastRadiusFirst(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Deployment/default/low", Name: "low", Kind: "Deployment", Namespace: "default", Replicas: 1},
		{ID: "Deployment/default/high", Name: "high", Kind: "Deployment", Namespace: "default", Replicas: 1},
		{ID: "Deployment/default/mid", Name: "mid", Kind: "Deployment", Namespace: "default", Replicas: 1},
	}
	scores := map[string]ScoreInfo{
		"Deployment/default/low":  {Score: 20, FanIn: 1, IsSPOF: true},
		"Deployment/default/high": {Score: 85, FanIn: 5, IsSPOF: true},
		"Deployment/default/mid":  {Score: 50, FanIn: 3, IsSPOF: true},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	require.Len(t, inv.Items, 3)
	assert.Equal(t, "high", inv.Items[0].Name)
	assert.Equal(t, "mid", inv.Items[1].Name)
	assert.Equal(t, "low", inv.Items[2].Name)
}

func TestDetect_SeverityCounts(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Deployment/default/a", Name: "a", Kind: "Deployment", Namespace: "default", Replicas: 1},
		{ID: "Deployment/default/b", Name: "b", Kind: "Deployment", Namespace: "default", Replicas: 1},
		{ID: "Deployment/default/c", Name: "c", Kind: "Deployment", Namespace: "default", Replicas: 1},
		{ID: "Deployment/default/d", Name: "d", Kind: "Deployment", Namespace: "default", Replicas: 1},
	}
	scores := map[string]ScoreInfo{
		"Deployment/default/a": {Score: 80, FanIn: 2, IsSPOF: true}, // critical (>= 75)
		"Deployment/default/b": {Score: 60, FanIn: 2, IsSPOF: true}, // high (>= 50)
		"Deployment/default/c": {Score: 30, FanIn: 1, IsSPOF: true}, // medium (>= 25)
		"Deployment/default/d": {Score: 10, FanIn: 1, IsSPOF: true}, // low (< 25)
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	assert.Equal(t, 4, inv.TotalSPOFs)
	assert.Equal(t, 1, inv.Critical)
	assert.Equal(t, 1, inv.High)
	assert.Equal(t, 1, inv.Medium)
	assert.Equal(t, 1, inv.Low)
}

func TestDetect_EmptyGraph(t *testing.T) {
	inv := NewDetector().Detect(DetectInput{ClusterID: "empty"})

	assert.Equal(t, 0, inv.TotalSPOFs)
	assert.Equal(t, "empty", inv.ClusterID)
	assert.NotNil(t, inv.Items, "Items should be non-nil empty slice for JSON")
	assert.Empty(t, inv.Items)
}

func TestDetect_NamespaceFilter(t *testing.T) {
	// This tests the filtering logic that lives in the handler/caller layer,
	// but we verify the inventory contains namespace data to filter on.
	nodes := []NodeInfo{
		{ID: "Deployment/prod/api", Name: "api", Kind: "Deployment", Namespace: "prod", Replicas: 1},
		{ID: "Deployment/dev/api", Name: "api", Kind: "Deployment", Namespace: "dev", Replicas: 1},
	}
	scores := map[string]ScoreInfo{
		"Deployment/prod/api": {Score: 70, FanIn: 3, IsSPOF: true},
		"Deployment/dev/api":  {Score: 40, FanIn: 1, IsSPOF: true},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	// Filter to "prod" namespace.
	var prodItems []SPOFItem
	for _, item := range inv.Items {
		if item.Namespace == "prod" {
			prodItems = append(prodItems, item)
		}
	}

	assert.Len(t, prodItems, 1)
	assert.Equal(t, "prod", prodItems[0].Namespace)
}

func TestDetect_Remediations_AlwaysIncludeTopologySpread(t *testing.T) {
	nodes := []NodeInfo{
		{ID: "Deployment/default/x", Name: "x", Kind: "Deployment", Namespace: "default", Replicas: 1, HasHPA: false, HasPDB: false},
	}
	scores := map[string]ScoreInfo{
		"Deployment/default/x": {Score: 50, FanIn: 2, IsSPOF: true},
	}

	inv := NewDetector().Detect(buildTestInput(nodes, scores))

	require.Len(t, inv.Items, 1)
	var hasTopologySpread bool
	for _, r := range inv.Items[0].Remediations {
		if r.Type == "topology-spread" {
			hasTopologySpread = true
		}
	}
	assert.True(t, hasTopologySpread, "Topology spread remediation should always be included")
}

func TestCriticalityLevel(t *testing.T) {
	assert.Equal(t, "critical", criticalityLevel(100))
	assert.Equal(t, "critical", criticalityLevel(75))
	assert.Equal(t, "high", criticalityLevel(74.9))
	assert.Equal(t, "high", criticalityLevel(50))
	assert.Equal(t, "medium", criticalityLevel(49.9))
	assert.Equal(t, "medium", criticalityLevel(25))
	assert.Equal(t, "low", criticalityLevel(24.9))
	assert.Equal(t, "low", criticalityLevel(0))
}
