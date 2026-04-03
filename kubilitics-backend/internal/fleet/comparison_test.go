package fleet

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// buildClusterA creates a "good" cluster: 3-replica deployment, has netpol
func buildClusterA() *graph.GraphSnapshot {
	replicas := int32(3)
	res := &graph.ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "web-abc", Namespace: "default", Labels: map[string]string{"app": "web"}}},
		},
		Deployments: []appsv1.Deployment{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
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

// buildClusterB creates a "weaker" cluster: 1-replica deployment, no netpol
func buildClusterB() *graph.GraphSnapshot {
	replicas := int32(1)
	res := &graph.ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "web-def", Namespace: "default", Labels: map[string]string{"app": "web"}}},
		},
		Deployments: []appsv1.Deployment{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
				},
			},
		},
		Services: []corev1.Service{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web-svc", Namespace: "default"},
				Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "web"}},
			},
		},
	}
	return graph.BuildSnapshot(res, false, nil, nil)
}

func TestCompare_DimensionComparisons(t *testing.T) {
	snapA := buildClusterA()
	snapB := buildClusterB()

	result := Compare(snapA, snapB)

	if result == nil {
		t.Fatal("expected non-nil comparison result")
	}

	if len(result.Dimensions) == 0 {
		t.Fatal("expected at least one dimension comparison")
	}

	// Find the netpol_coverage dimension
	var netpolDim *DimensionComparison
	for i := range result.Dimensions {
		if result.Dimensions[i].Name == "netpol_coverage" {
			netpolDim = &result.Dimensions[i]
			break
		}
	}
	if netpolDim == nil {
		t.Fatal("expected netpol_coverage dimension in comparison")
	}

	// Cluster A has netpol, cluster B does not
	if netpolDim.ValueA <= netpolDim.ValueB {
		t.Errorf("expected cluster A to have higher netpol coverage; A=%f, B=%f",
			netpolDim.ValueA, netpolDim.ValueB)
	}
	if netpolDim.Better != "a" {
		t.Errorf("expected 'a' to be better for netpol_coverage, got %q", netpolDim.Better)
	}
}

func TestCompare_StructuralDiffs(t *testing.T) {
	snapA := buildClusterA()
	snapB := buildClusterB()

	result := Compare(snapA, snapB)

	// The "web" deployment exists in both but has different replica counts (3 vs 1)
	foundReplicaDiff := false
	for _, d := range result.Differences {
		if d.WorkloadKey == "Deployment/default/web" && d.Issue == "different_replica_count" {
			foundReplicaDiff = true
			if d.ClusterA != "replicas=3" {
				t.Errorf("expected cluster A replicas=3, got %q", d.ClusterA)
			}
			if d.ClusterB != "replicas=1" {
				t.Errorf("expected cluster B replicas=1, got %q", d.ClusterB)
			}
		}
	}
	if !foundReplicaDiff {
		t.Error("expected structural diff for different_replica_count on Deployment/default/web")
	}
}

func TestCompare_IdenticalClusters(t *testing.T) {
	snap := buildClusterA()
	result := Compare(snap, snap)

	// Same snapshot compared to itself: no structural diffs
	if len(result.Differences) != 0 {
		t.Errorf("expected 0 structural diffs for identical clusters, got %d", len(result.Differences))
	}

	// All dimensions should be "equal"
	for _, dim := range result.Dimensions {
		if dim.Better != "equal" {
			t.Errorf("expected 'equal' for dimension %s, got %q (A=%f, B=%f)",
				dim.Name, dim.Better, dim.ValueA, dim.ValueB)
		}
	}
}

func TestMakeDim_HigherIsBetter(t *testing.T) {
	d := makeDim("test", 80, 70, true)
	if d.Better != "a" {
		t.Errorf("expected 'a', got %q", d.Better)
	}
	if d.Delta != 10 {
		t.Errorf("expected delta=10, got %f", d.Delta)
	}
}

func TestMakeDim_LowerIsBetter(t *testing.T) {
	d := makeDim("test", 2, 5, false)
	if d.Better != "a" {
		t.Errorf("expected 'a' (lower is better, A=2 < B=5), got %q", d.Better)
	}
}

func TestMakeDim_Equal(t *testing.T) {
	d := makeDim("test", 50, 50, true)
	if d.Better != "equal" {
		t.Errorf("expected 'equal', got %q", d.Better)
	}
}

func TestBfsCount(t *testing.T) {
	adj := map[string]map[string]bool{
		"a": {"b": true, "c": true},
		"b": {"d": true},
		"c": {},
		"d": {},
	}
	count := bfsCount(adj, "a")
	if count != 3 {
		t.Errorf("expected 3 reachable nodes from 'a', got %d", count)
	}

	count = bfsCount(adj, "d")
	if count != 0 {
		t.Errorf("expected 0 reachable nodes from 'd', got %d", count)
	}
}

func TestCountCrossNSDeps_NilSnapshot(t *testing.T) {
	count := countCrossNSDeps(nil)
	if count != 0 {
		t.Errorf("expected 0 for nil snapshot, got %d", count)
	}
}

func TestFindStructuralDiffs_NilSnapshots(t *testing.T) {
	diffs := findStructuralDiffs(nil, nil)
	if len(diffs) != 0 {
		t.Errorf("expected empty diffs for nil snapshots, got %d", len(diffs))
	}
}
