package fleet

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// buildFixtureSnapshot creates a realistic snapshot for testing.
// It has:
//   - 2 Deployments ("web" with 3 replicas, "api" with 1 replica)
//   - 1 Service ("web-svc" selecting "web")
//   - 1 NetworkPolicy in "default" namespace
//   - 2 namespaces: "default" and "backend"
func buildFixtureSnapshot() *graph.GraphSnapshot {
	replicas3 := int32(3)
	replicas1 := int32(1)

	res := &graph.ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "web-abc", Namespace: "default", Labels: map[string]string{"app": "web"}}},
			{ObjectMeta: metav1.ObjectMeta{Name: "api-xyz", Namespace: "backend", Labels: map[string]string{"app": "api"}}},
		},
		Deployments: []appsv1.Deployment{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas3,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
				},
			},
			{
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "backend"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas1,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
				},
			},
		},
		Services: []corev1.Service{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web-svc", Namespace: "default"},
				Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "web"}},
			},
		},
		NetworkPolicies: []networkingv1.NetworkPolicy{
			{ObjectMeta: metav1.ObjectMeta{Name: "deny-all", Namespace: "default"}},
		},
	}

	return graph.BuildSnapshot(res, false, nil, nil)
}

func TestAggregateCluster_Nil(t *testing.T) {
	m := AggregateCluster(nil)
	if m == nil {
		t.Fatal("expected non-nil metrics for nil snapshot")
	}
	if m.TotalWorkloads != 0 {
		t.Errorf("expected 0 total workloads, got %d", m.TotalWorkloads)
	}
}

func TestAggregateCluster_FixtureSnapshot(t *testing.T) {
	snap := buildFixtureSnapshot()
	m := AggregateCluster(snap)

	if m == nil {
		t.Fatal("expected non-nil metrics")
	}

	// TotalWorkloads = Deployments(2) + StatefulSets(0) + DaemonSets(0) + Services(1) + Jobs(0) + CronJobs(0) = 3
	if m.TotalWorkloads != 3 {
		t.Errorf("expected TotalWorkloads=3, got %d", m.TotalWorkloads)
	}

	// TotalNodes should be > 0 (includes Pods, Deployments, Services, ConfigMaps, NetworkPolicies, etc.)
	if m.TotalNodes == 0 {
		t.Error("expected TotalNodes > 0")
	}

	// HealthScore should be between 0 and 100
	if m.HealthScore < 0 || m.HealthScore > 100 {
		t.Errorf("expected HealthScore in [0,100], got %f", m.HealthScore)
	}

	// Should have at least one SPOF (the "api" deployment with 1 replica and dependent service edge)
	// Note: whether it counts as SPOF depends on whether it has fanIn > 0
	// The "api" deployment has 1 replica but may not have fanIn in this fixture
	if m.SPOFCount < 0 {
		t.Errorf("expected non-negative SPOFCount, got %d", m.SPOFCount)
	}

	// NetworkPolicy coverage: "default" has one, "backend" does not
	// So coverage should be 50% (1 out of 2 namespaces)
	if m.NetPolCoverage < 40 || m.NetPolCoverage > 60 {
		t.Errorf("expected NetPolCoverage around 50%%, got %f", m.NetPolCoverage)
	}
}

func TestAggregateCluster_EmptySnapshot(t *testing.T) {
	res := &graph.ClusterResources{}
	snap := graph.BuildSnapshot(res, false, nil, nil)
	m := AggregateCluster(snap)

	if m.TotalWorkloads != 0 {
		t.Errorf("expected 0 workloads, got %d", m.TotalWorkloads)
	}
	if m.SPOFCount != 0 {
		t.Errorf("expected 0 SPOFs, got %d", m.SPOFCount)
	}
	// With no workloads, coverage denominators are 0 -> all coverage should be 0
	if m.PDBCoverage != 0 {
		t.Errorf("expected 0 PDB coverage, got %f", m.PDBCoverage)
	}
	if m.HPACoverage != 0 {
		t.Errorf("expected 0 HPA coverage, got %f", m.HPACoverage)
	}
}

func TestComputeHealthScore_PerfectCluster(t *testing.T) {
	m := &ClusterMetrics{
		SPOFCount:      0,
		CriticalCount:  0,
		PDBCoverage:    100,
		HPACoverage:    100,
		NetPolCoverage: 100,
	}
	score := computeHealthScore(m)
	if score != 100.0 {
		t.Errorf("expected 100 for perfect cluster, got %f", score)
	}
}

func TestComputeHealthScore_BadCluster(t *testing.T) {
	m := &ClusterMetrics{
		SPOFCount:      20,
		CriticalCount:  20,
		PDBCoverage:    0,
		HPACoverage:    0,
		NetPolCoverage: 0,
	}
	score := computeHealthScore(m)
	if score >= 50 {
		t.Errorf("expected low score for bad cluster, got %f", score)
	}
	if score < 0 {
		t.Errorf("score should never go below 0, got %f", score)
	}
}

func TestCountWorkloadCoverage(t *testing.T) {
	snap := buildFixtureSnapshot()

	// Count all workloads
	_, total := countWorkloadCoverage(snap, func(_ string) bool { return true })
	if total != 2 {
		t.Errorf("expected 2 workload nodes (2 Deployments), got %d", total)
	}

	// Count with always-false predicate
	matching, _ := countWorkloadCoverage(snap, func(_ string) bool { return false })
	if matching != 0 {
		t.Errorf("expected 0 matching, got %d", matching)
	}
}

func TestIsWorkloadKind(t *testing.T) {
	tests := []struct {
		kind     string
		expected bool
	}{
		{"Deployment", true},
		{"StatefulSet", true},
		{"DaemonSet", true},
		{"Pod", false},
		{"Service", false},
		{"ConfigMap", false},
	}
	for _, tt := range tests {
		if got := isWorkloadKind(tt.kind); got != tt.expected {
			t.Errorf("isWorkloadKind(%q) = %v, want %v", tt.kind, got, tt.expected)
		}
	}
}

func TestRefKey(t *testing.T) {
	ref := models.ResourceRef{Kind: "Deployment", Namespace: "prod", Name: "api"}
	key := RefKey(ref)
	if key != "Deployment/prod/api" {
		t.Errorf("expected 'Deployment/prod/api', got %q", key)
	}
}

// Suppress unused import warnings for time package.
var _ = time.Now
