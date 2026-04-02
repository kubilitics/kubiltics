package health

import (
	"math"
	"testing"
)

// mockClusterData implements ClusterData for testing.
type mockClusterData struct {
	namespaces  []string
	workloads   map[string][]WorkloadInfo
	criticality map[string]CriticalityInfo
	edges       []EdgeInfo
}

func (m *mockClusterData) GetNamespaces() []string {
	return m.namespaces
}

func (m *mockClusterData) GetWorkloadsInNamespace(ns string) []WorkloadInfo {
	return m.workloads[ns]
}

func (m *mockClusterData) GetCriticalityScores() map[string]CriticalityInfo {
	return m.criticality
}

func (m *mockClusterData) GetEdges() []EdgeInfo {
	return m.edges
}

func TestHealthLevel(t *testing.T) {
	tests := []struct {
		score float64
		want  string
	}{
		{100, "healthy"},
		{80, "healthy"},
		{79.9, "warning"},
		{50, "warning"},
		{49.9, "degraded"},
		{25, "degraded"},
		{24.9, "critical"},
		{0, "critical"},
	}
	for _, tt := range tests {
		got := healthLevel(tt.score)
		if got != tt.want {
			t.Errorf("healthLevel(%v) = %q, want %q", tt.score, got, tt.want)
		}
	}
}

func TestPerfectNamespaceScore(t *testing.T) {
	// All workloads have PDB, HPA, 3 replicas, no SPOFs -> score near 100
	data := &mockClusterData{
		namespaces: []string{"production"},
		workloads: map[string][]WorkloadInfo{
			"production": {
				{Key: "Deployment/production/api", Kind: "Deployment", Namespace: "production", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true, IsSPOF: false},
				{Key: "Deployment/production/web", Kind: "Deployment", Namespace: "production", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true, IsSPOF: false},
				{Key: "Deployment/production/worker", Kind: "Deployment", Namespace: "production", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true, IsSPOF: false},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)

	if report.ClusterID != "test-cluster" {
		t.Errorf("expected cluster ID %q, got %q", "test-cluster", report.ClusterID)
	}

	// Score should be 100 (all components perfect)
	if report.Score != 100.0 {
		t.Errorf("expected perfect score 100, got %v", report.Score)
	}
	if report.Level != "healthy" {
		t.Errorf("expected level %q, got %q", "healthy", report.Level)
	}

	if len(report.Namespaces) != 1 {
		t.Fatalf("expected 1 namespace, got %d", len(report.Namespaces))
	}
	ns := report.Namespaces[0]
	if ns.Score != 100.0 {
		t.Errorf("expected namespace score 100, got %v", ns.Score)
	}
	if ns.WorkloadCount != 3 {
		t.Errorf("expected 3 workloads, got %d", ns.WorkloadCount)
	}
}

func TestWorstNamespaceScore(t *testing.T) {
	// All SPOFs, no PDB, no HPA, single replicas -> score near 0
	data := &mockClusterData{
		namespaces: []string{"default"},
		workloads: map[string][]WorkloadInfo{
			"default": {
				{Key: "Deployment/default/app1", Kind: "Deployment", Namespace: "default", Replicas: 1, HasPDB: false, HasHPA: false, IsScalable: true, IsSPOF: true},
				{Key: "Deployment/default/app2", Kind: "Deployment", Namespace: "default", Replicas: 1, HasPDB: false, HasHPA: false, IsScalable: true, IsSPOF: true},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges: []EdgeInfo{
			// Add cross-NS edges to make cross_ns_risk component bad
			{SourceKey: "Deployment/default/app1", TargetKey: "Service/other/svc1", SourceNamespace: "default", TargetNamespace: "other"},
			{SourceKey: "Deployment/default/app2", TargetKey: "Service/other/svc2", SourceNamespace: "default", TargetNamespace: "other"},
		},
	}

	report := ComputeHealthReport("test-cluster", data)

	ns := report.Namespaces[0]
	// SPOF density: 1 - 2/2 = 0
	// PDB coverage: 0/2 = 0
	// HPA coverage: 0/2 = 0
	// Redundancy: 1/max(1,2) = 0.5
	// Dep depth: 1 (no deps in ns)
	// Cross-NS: 1 - 2/2 = 0
	// Weighted: (0*0.25 + 0*0.20 + 0*0.15 + 0.5*0.20 + 1*0.10 + 0*0.10) / 1.0 = 0.20
	// Score = 20.0

	if ns.Score > 25 {
		t.Errorf("expected low score (degraded/critical), got %v", ns.Score)
	}
	if ns.Level != "critical" && ns.Level != "degraded" {
		t.Errorf("expected critical or degraded level, got %q", ns.Level)
	}
}

func TestEmptyNamespaceScore(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"empty-ns"},
		workloads: map[string][]WorkloadInfo{
			"empty-ns": {},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ns := report.Namespaces[0]

	if ns.Score != 100.0 {
		t.Errorf("expected empty namespace score 100, got %v", ns.Score)
	}
	if ns.Level != "healthy" {
		t.Errorf("expected level %q, got %q", "healthy", ns.Level)
	}
	if ns.WorkloadCount != 0 {
		t.Errorf("expected 0 workloads, got %d", ns.WorkloadCount)
	}
}

func TestSingleWorkloadNamespace(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"single"},
		workloads: map[string][]WorkloadInfo{
			"single": {
				{Key: "Deployment/single/lonely", Kind: "Deployment", Namespace: "single", Replicas: 2, HasPDB: true, HasHPA: true, IsScalable: true, IsSPOF: false},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ns := report.Namespaces[0]

	if ns.WorkloadCount != 1 {
		t.Errorf("expected 1 workload, got %d", ns.WorkloadCount)
	}
	// Single workload with PDB+HPA+2 replicas should be healthy
	if ns.Score < 80 {
		t.Errorf("expected healthy score, got %v", ns.Score)
	}
}

func TestMultiNamespaceClusterScore(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"good", "bad"},
		workloads: map[string][]WorkloadInfo{
			"good": {
				{Key: "Deployment/good/api", Kind: "Deployment", Namespace: "good", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true},
				{Key: "Deployment/good/web", Kind: "Deployment", Namespace: "good", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true},
			},
			"bad": {
				{Key: "Deployment/bad/app1", Kind: "Deployment", Namespace: "bad", Replicas: 1, HasPDB: false, HasHPA: false, IsScalable: true, IsSPOF: true},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)

	// Cluster score should be weighted: 2 good + 1 bad
	// Good ns score ~ 100, Bad ns score is low
	// Cluster score should be between the two, weighted towards "good" (2 workloads vs 1)
	if len(report.Namespaces) != 2 {
		t.Fatalf("expected 2 namespaces, got %d", len(report.Namespaces))
	}

	goodNS := findNS(report.Namespaces, "good")
	badNS := findNS(report.Namespaces, "bad")

	if goodNS.Score <= badNS.Score {
		t.Errorf("good namespace (%v) should score higher than bad (%v)", goodNS.Score, badNS.Score)
	}

	// Cluster score should be between the two
	if report.Score <= badNS.Score || report.Score >= goodNS.Score {
		t.Errorf("cluster score %v should be between bad (%v) and good (%v)", report.Score, badNS.Score, goodNS.Score)
	}
}

func TestComponentWeightsSumToOne(t *testing.T) {
	total := weightSPOFDensity + weightPDBCoverage + weightHPACoverage +
		weightRedundancy + weightDepDepth + weightCrossNSRisk
	if math.Abs(total-1.0) > 0.001 {
		t.Errorf("component weights should sum to 1.0, got %v", total)
	}
}

func TestComputeWeightedScore(t *testing.T) {
	// All perfect
	components := []ComponentScore{
		{Score: 1.0, Weight: 0.5},
		{Score: 1.0, Weight: 0.5},
	}
	score := computeWeightedScore(components)
	if score != 100.0 {
		t.Errorf("expected 100, got %v", score)
	}

	// All zero
	components = []ComponentScore{
		{Score: 0.0, Weight: 0.5},
		{Score: 0.0, Weight: 0.5},
	}
	score = computeWeightedScore(components)
	if score != 0.0 {
		t.Errorf("expected 0, got %v", score)
	}

	// Mixed
	components = []ComponentScore{
		{Score: 1.0, Weight: 0.5},
		{Score: 0.0, Weight: 0.5},
	}
	score = computeWeightedScore(components)
	if score != 50.0 {
		t.Errorf("expected 50, got %v", score)
	}
}

func TestBfsMaxDepth(t *testing.T) {
	adj := map[string][]string{
		"a": {"b"},
		"b": {"c"},
		"c": {"d"},
	}
	if d := bfsMaxDepth(adj, "a"); d != 3 {
		t.Errorf("expected depth 3, got %d", d)
	}
	if d := bfsMaxDepth(adj, "d"); d != 0 {
		t.Errorf("expected depth 0 from leaf, got %d", d)
	}
}

func TestCountCrossNSDeps(t *testing.T) {
	edges := []EdgeInfo{
		{SourceNamespace: "a", TargetNamespace: "a"},
		{SourceNamespace: "a", TargetNamespace: "b"},
		{SourceNamespace: "b", TargetNamespace: "a"},
		{SourceNamespace: "c", TargetNamespace: "c"},
	}

	crossNS, total := countCrossNSDeps("a", edges)
	if total != 3 {
		t.Errorf("expected 3 total deps involving ns 'a', got %d", total)
	}
	if crossNS != 2 {
		t.Errorf("expected 2 cross-ns deps, got %d", crossNS)
	}
}

func TestNonScalableWorkloadsHPACoverage(t *testing.T) {
	// DaemonSets and Jobs are not scalable, so HPA coverage should not penalize them
	data := &mockClusterData{
		namespaces: []string{"infra"},
		workloads: map[string][]WorkloadInfo{
			"infra": {
				{Key: "DaemonSet/infra/fluentd", Kind: "DaemonSet", Namespace: "infra", Replicas: 5, HasPDB: true, HasHPA: false, IsScalable: false},
				{Key: "Job/infra/migrate", Kind: "Job", Namespace: "infra", Replicas: 1, HasPDB: false, HasHPA: false, IsScalable: false},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ns := report.Namespaces[0]

	// HPA coverage should be 1.0 (perfect) since no scalable workloads
	for _, c := range ns.Components {
		if c.Name == "hpa_coverage" && c.Score != 1.0 {
			t.Errorf("expected hpa_coverage=1.0 for non-scalable workloads, got %v", c.Score)
		}
	}
}

// findNS finds a NamespaceHealth by name.
func findNS(ns []NamespaceHealth, name string) NamespaceHealth {
	for _, n := range ns {
		if n.Namespace == name {
			return n
		}
	}
	return NamespaceHealth{}
}
