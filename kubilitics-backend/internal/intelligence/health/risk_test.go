package health

import (
	"testing"
)

func TestRiskLevel(t *testing.T) {
	tests := []struct {
		score float64
		want  string
	}{
		{100, "critical"},
		{76, "critical"},
		{75, "high"},
		{55, "high"},
		{54, "medium"},
		{30, "medium"},
		{29, "low"},
		{0, "low"},
	}
	for _, tt := range tests {
		got := riskLevel(tt.score)
		if got != tt.want {
			t.Errorf("riskLevel(%v) = %q, want %q", tt.score, got, tt.want)
		}
	}
}

func TestRiskRankingSortsDescending(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"good", "medium", "bad"},
		workloads: map[string][]WorkloadInfo{
			"good": {
				{Key: "Deployment/good/api", Kind: "Deployment", Namespace: "good", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true},
			},
			"medium": {
				{Key: "Deployment/medium/api", Kind: "Deployment", Namespace: "medium", Replicas: 2, HasPDB: true, HasHPA: false, IsScalable: true},
			},
			"bad": {
				{Key: "Deployment/bad/app1", Kind: "Deployment", Namespace: "bad", Replicas: 1, HasPDB: false, HasHPA: false, IsScalable: true, IsSPOF: true},
			},
		},
		criticality: map[string]CriticalityInfo{
			"Deployment/good/api":   {FanIn: 0},
			"Deployment/medium/api": {FanIn: 1},
			"Deployment/bad/app1":   {FanIn: 3},
		},
		edges: nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ranking := ComputeRiskRanking("test-cluster", data, report)

	if ranking.ClusterID != "test-cluster" {
		t.Errorf("expected cluster ID %q, got %q", "test-cluster", ranking.ClusterID)
	}
	if len(ranking.Namespaces) != 3 {
		t.Fatalf("expected 3 namespaces, got %d", len(ranking.Namespaces))
	}

	// Verify descending order
	for i := 1; i < len(ranking.Namespaces); i++ {
		if ranking.Namespaces[i].RiskScore > ranking.Namespaces[i-1].RiskScore {
			t.Errorf("risk ranking not sorted descending: %v > %v at positions %d, %d",
				ranking.Namespaces[i].RiskScore, ranking.Namespaces[i-1].RiskScore, i, i-1)
		}
	}

	// "bad" should be highest risk
	if ranking.Namespaces[0].Namespace != "bad" {
		t.Errorf("expected highest risk namespace to be 'bad', got %q", ranking.Namespaces[0].Namespace)
	}

	// "good" should be lowest risk
	last := ranking.Namespaces[len(ranking.Namespaces)-1]
	if last.Namespace != "good" {
		t.Errorf("expected lowest risk namespace to be 'good', got %q", last.Namespace)
	}
}

func TestRiskScoreIsInverseOfHealth(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"ns1"},
		workloads: map[string][]WorkloadInfo{
			"ns1": {
				{Key: "Deployment/ns1/app", Kind: "Deployment", Namespace: "ns1", Replicas: 3, HasPDB: true, HasHPA: true, IsScalable: true},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ranking := ComputeRiskRanking("test-cluster", data, report)

	ns1Health := report.Namespaces[0].Score
	ns1Risk := ranking.Namespaces[0].RiskScore

	if ns1Risk != 100.0-ns1Health {
		t.Errorf("risk score (%v) should be 100 - health score (%v) = %v", ns1Risk, ns1Health, 100.0-ns1Health)
	}
}

func TestRiskRankingSPOFCount(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"ns1"},
		workloads: map[string][]WorkloadInfo{
			"ns1": {
				{Key: "Deployment/ns1/app1", Kind: "Deployment", Namespace: "ns1", Replicas: 1, IsSPOF: true, IsScalable: true},
				{Key: "Deployment/ns1/app2", Kind: "Deployment", Namespace: "ns1", Replicas: 1, IsSPOF: true, IsScalable: true},
				{Key: "Deployment/ns1/app3", Kind: "Deployment", Namespace: "ns1", Replicas: 3, IsSPOF: false, IsScalable: true},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ranking := ComputeRiskRanking("test-cluster", data, report)

	if ranking.Namespaces[0].SPOFCount != 2 {
		t.Errorf("expected 2 SPOFs, got %d", ranking.Namespaces[0].SPOFCount)
	}
}

func TestRiskRankingCrossNSDependencies(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"ns1"},
		workloads: map[string][]WorkloadInfo{
			"ns1": {
				{Key: "Deployment/ns1/app1", Kind: "Deployment", Namespace: "ns1", Replicas: 2, IsScalable: true},
			},
		},
		criticality: map[string]CriticalityInfo{},
		edges: []EdgeInfo{
			{SourceKey: "Deployment/ns1/app1", TargetKey: "Service/ns2/svc1", SourceNamespace: "ns1", TargetNamespace: "ns2"},
			{SourceKey: "Deployment/ns1/app1", TargetKey: "Service/ns3/svc1", SourceNamespace: "ns1", TargetNamespace: "ns3"},
			{SourceKey: "Deployment/ns1/app1", TargetKey: "Service/ns1/svc1", SourceNamespace: "ns1", TargetNamespace: "ns1"},
		},
	}

	report := ComputeHealthReport("test-cluster", data)
	ranking := ComputeRiskRanking("test-cluster", data, report)

	if ranking.Namespaces[0].CrossNSDependencies != 2 {
		t.Errorf("expected 2 cross-ns deps, got %d", ranking.Namespaces[0].CrossNSDependencies)
	}
}

func TestRiskRankingEmptyNamespace(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"empty"},
		workloads: map[string][]WorkloadInfo{
			"empty": {},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ranking := ComputeRiskRanking("test-cluster", data, report)

	if len(ranking.Namespaces) != 1 {
		t.Fatalf("expected 1 namespace, got %d", len(ranking.Namespaces))
	}

	ns := ranking.Namespaces[0]
	if ns.RiskScore != 0.0 {
		t.Errorf("expected risk score 0 for empty namespace, got %v", ns.RiskScore)
	}
	if ns.Level != "low" {
		t.Errorf("expected level %q, got %q", "low", ns.Level)
	}
	if ns.SPOFCount != 0 {
		t.Errorf("expected 0 SPOFs, got %d", ns.SPOFCount)
	}
}

func TestTopRisksGeneration(t *testing.T) {
	// Worst components should generate human-readable risks
	components := []ComponentScore{
		{Name: "spof_density", Score: 0.0, Weight: 0.25},
		{Name: "pdb_coverage", Score: 0.0, Weight: 0.20},
		{Name: "hpa_coverage", Score: 1.0, Weight: 0.15},
	}

	risks := buildTopRisks(components)
	if len(risks) == 0 {
		t.Error("expected at least one risk description")
	}
	if len(risks) > 3 {
		t.Errorf("expected at most 3 risk descriptions, got %d", len(risks))
	}
}

func TestTopRisksAllGood(t *testing.T) {
	// All good components -> no risks
	components := []ComponentScore{
		{Name: "spof_density", Score: 1.0, Weight: 0.25},
		{Name: "pdb_coverage", Score: 0.9, Weight: 0.20},
		{Name: "hpa_coverage", Score: 0.85, Weight: 0.15},
	}

	risks := buildTopRisks(components)
	if len(risks) != 0 {
		t.Errorf("expected no risks for good components, got %v", risks)
	}
}

func TestRiskRankingGeneratedAtSet(t *testing.T) {
	data := &mockClusterData{
		namespaces: []string{"ns1"},
		workloads: map[string][]WorkloadInfo{
			"ns1": {},
		},
		criticality: map[string]CriticalityInfo{},
		edges:       nil,
	}

	report := ComputeHealthReport("test-cluster", data)
	ranking := ComputeRiskRanking("test-cluster", data, report)

	if ranking.GeneratedAt.IsZero() {
		t.Error("expected GeneratedAt to be set")
	}
}
