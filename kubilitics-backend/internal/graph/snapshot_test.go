package graph

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRefKey(t *testing.T) {
	ref := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "nginx"}
	assert.Equal(t, "Deployment/default/nginx", refKey(ref))

	// Cluster-scoped resource (empty namespace)
	ref2 := models.ResourceRef{Kind: "ClusterRole", Namespace: "", Name: "admin"}
	assert.Equal(t, "ClusterRole//admin", refKey(ref2))
}

func TestBfsWalk(t *testing.T) {
	// A -> B -> C
	adj := map[string]map[string]bool{
		"A": {"B": true},
		"B": {"C": true},
		"C": {},
	}

	reached := bfsWalk(adj, "A")
	assert.True(t, reached["B"])
	assert.True(t, reached["C"])
	assert.False(t, reached["A"], "start node should not be in result")
	assert.Len(t, reached, 2)

	// Walk from C should yield nothing
	reached2 := bfsWalk(adj, "C")
	assert.Len(t, reached2, 0)
}

func TestBfsWalkWithDepth(t *testing.T) {
	// A -> B -> C -> D
	adj := map[string]map[string]bool{
		"A": {"B": true},
		"B": {"C": true},
		"C": {"D": true},
	}

	depths := bfsWalkWithDepth(adj, "A")
	assert.Equal(t, 1, depths["B"])
	assert.Equal(t, 2, depths["C"])
	assert.Equal(t, 3, depths["D"])
	_, hasA := depths["A"]
	assert.False(t, hasA)
}

func TestShortestPath(t *testing.T) {
	adj := map[string]map[string]bool{
		"A": {"B": true, "C": true},
		"B": {"D": true},
		"C": {"D": true},
	}

	path := shortestPath(adj, "A", "D")
	require.NotNil(t, path)
	assert.Equal(t, "A", path[0])
	assert.Equal(t, "D", path[len(path)-1])
	assert.Len(t, path, 3) // A -> B/C -> D

	// No path
	path2 := shortestPath(adj, "D", "A")
	assert.Nil(t, path2)

	// Same node
	path3 := shortestPath(adj, "A", "A")
	assert.Equal(t, []string{"A"}, path3)
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

// buildTestSnapshot creates a small graph: Service -> Deployment -> ReplicaSet -> Pod
func buildTestSnapshot() *GraphSnapshot {
	svc := models.ResourceRef{Kind: "Service", Namespace: "default", Name: "web-svc"}
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "web"}
	rs := models.ResourceRef{Kind: "ReplicaSet", Namespace: "default", Name: "web-abc"}
	pod := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "web-abc-xyz"}

	svcKey := refKey(svc)
	depKey := refKey(dep)
	rsKey := refKey(rs)
	podKey := refKey(pod)

	edges := []models.BlastDependencyEdge{
		{Source: svc, Target: dep, Type: "selects"},
		{Source: dep, Target: rs, Type: "owns"},
		{Source: rs, Target: pod, Type: "owns"},
	}

	return &GraphSnapshot{
		Nodes: map[string]models.ResourceRef{
			svcKey: svc,
			depKey: dep,
			rsKey:  rs,
			podKey: pod,
		},
		// Forward: what does X depend on (X -> Y means X depends on Y)
		Forward: map[string]map[string]bool{
			svcKey: {depKey: true},
			depKey: {rsKey: true},
			rsKey:  {podKey: true},
		},
		// Reverse: what depends on X (if X fails, who is affected)
		Reverse: map[string]map[string]bool{
			depKey: {svcKey: true},
			rsKey:  {depKey: true},
			podKey: {rsKey: true},
		},
		Edges: edges,
		NodeScores: map[string]float64{
			depKey: 80.0,
			svcKey: 40.0,
			rsKey:  30.0,
			podKey: 10.0,
		},
		NodeRisks: map[string][]models.RiskIndicator{
			depKey: {
				{Severity: "warning", Title: "Single replica", Detail: "Only 1 replica configured"},
			},
		},
		NodeReplicas: map[string]int{
			depKey: 1,
			rsKey:  1,
			podKey: 1,
		},
		NodeHasHPA:     map[string]bool{},
		NodeHasPDB:     map[string]bool{},
		NodeIngress:    map[string][]string{},
		TotalWorkloads: 4,
		BuiltAt:        time.Now().UnixMilli(),
		BuildDuration:  50 * time.Millisecond,
		Namespaces:     map[string]bool{"default": true},
	}
}

func TestComputeBlastRadius_SimpleChain(t *testing.T) {
	snap := buildTestSnapshot()
	dep := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "web"}

	result, err := snap.ComputeBlastRadius(dep)
	require.NoError(t, err)
	require.NotNil(t, result)

	// The deployment is depended on by the Service (via reverse).
	// Reverse graph: dep <- svc. So affected = {svc}, totalAffected = 1
	assert.Equal(t, 1, result.TotalAffected)
	assert.Equal(t, "Service", result.Waves[0].Resources[0].Kind)
	assert.Equal(t, 1, result.Waves[0].Depth)
	assert.Equal(t, "direct", result.Waves[0].Resources[0].Impact)

	// Fan-in: what depends on deployment = Service (1)
	assert.Equal(t, 1, result.FanIn)
	// Fan-out: what deployment depends on = ReplicaSet (1)
	assert.Equal(t, 1, result.FanOut)

	// Criticality
	assert.Equal(t, 80.0, result.CriticalityScore)
	assert.Equal(t, "critical", result.CriticalityLevel)

	// SPOF: 1 replica, no HPA, has dependents
	assert.True(t, result.IsSPOF)

	// Blast radius percent: 1 affected / 4 total = 25%
	assert.InDelta(t, 25.0, result.BlastRadiusPercent, 0.01)

	// Graph stats
	assert.Equal(t, 4, result.GraphNodeCount)
	assert.Equal(t, 3, result.GraphEdgeCount)
}

func TestComputeBlastRadius_NotFound(t *testing.T) {
	snap := buildTestSnapshot()
	_, err := snap.ComputeBlastRadius(models.ResourceRef{Kind: "ConfigMap", Namespace: "default", Name: "missing"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestComputeBlastRadius_Pod_NoAffected(t *testing.T) {
	snap := buildTestSnapshot()
	pod := models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "web-abc-xyz"}

	result, err := snap.ComputeBlastRadius(pod)
	require.NoError(t, err)

	// Pod has reverse deps: ReplicaSet -> Deployment -> Service (3 total)
	assert.Equal(t, 3, result.TotalAffected)
}

func TestGetSummary(t *testing.T) {
	snap := buildTestSnapshot()

	summary := snap.GetSummary(2)
	require.Len(t, summary, 2)

	// Top score should be Deployment at 80
	assert.Equal(t, "Deployment", summary[0].Resource.Kind)
	assert.Equal(t, 80.0, summary[0].CriticalityScore)
	assert.Equal(t, "critical", summary[0].CriticalityLevel)

	// Second should be Service at 40
	assert.Equal(t, "Service", summary[1].Resource.Kind)
	assert.Equal(t, 40.0, summary[1].CriticalityScore)
}

func TestGetSummary_NoLimit(t *testing.T) {
	snap := buildTestSnapshot()
	summary := snap.GetSummary(0)
	assert.Len(t, summary, 4) // all nodes have scores
}

func TestStatus(t *testing.T) {
	snap := buildTestSnapshot()
	status := snap.Status()

	assert.True(t, status.Ready)
	assert.Equal(t, 4, status.NodeCount)
	assert.Equal(t, 3, status.EdgeCount)
	assert.Equal(t, 1, status.NamespaceCount)
	assert.True(t, status.StalenessMs >= 0)
}

func TestStatus_Empty(t *testing.T) {
	snap := &GraphSnapshot{
		Nodes:      map[string]models.ResourceRef{},
		Namespaces: map[string]bool{},
	}
	status := snap.Status()
	assert.False(t, status.Ready)
	assert.Equal(t, 0, status.NodeCount)
}

func TestBuildFailurePath(t *testing.T) {
	snap := buildTestSnapshot()

	// Pod failure propagates: Pod -> RS -> Dep -> Svc (in reverse graph)
	podKey := refKey(models.ResourceRef{Kind: "Pod", Namespace: "default", Name: "web-abc-xyz"})
	svcKey := refKey(models.ResourceRef{Kind: "Service", Namespace: "default", Name: "web-svc"})

	hops := snap.buildFailurePath(podKey, svcKey)
	require.Len(t, hops, 3) // Pod->RS, RS->Dep, Dep->Svc
	assert.Equal(t, "Pod", hops[0].From.Kind)
	assert.Equal(t, "ReplicaSet", hops[0].To.Kind)
	assert.Equal(t, "Service", hops[2].To.Kind)
}
