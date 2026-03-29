package graph

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildSnapshot_RegistersAllResourceKinds(t *testing.T) {
	replicas := int32(2)
	res := &ClusterResources{
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
		ConfigMaps: []corev1.ConfigMap{
			{ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default"}},
		},
	}

	snap := BuildSnapshot(res, false, nil, nil)

	// Verify all 4 resource kinds appear as nodes
	expected := map[string]bool{
		"Pod/default/web-abc":          true,
		"Deployment/default/web":       true,
		"Service/default/web-svc":      true,
		"ConfigMap/default/app-config": true,
	}

	for key := range expected {
		if _, ok := snap.Nodes[key]; !ok {
			t.Errorf("expected node %s to be registered, but it was not found", key)
		}
	}

	// Verify basic snapshot fields
	// TotalWorkloads = Deployments + StatefulSets + DaemonSets + Services + Jobs + CronJobs = 1 + 1 = 2
	if snap.TotalWorkloads != 2 {
		t.Errorf("expected TotalWorkloads=2 (1 deployment + 1 service), got %d", snap.TotalWorkloads)
	}
	if snap.BuiltAt == 0 {
		t.Error("expected BuiltAt to be non-zero")
	}
	if len(snap.Namespaces) == 0 {
		t.Error("expected at least one namespace")
	}
	if !snap.Namespaces["default"] {
		t.Error("expected 'default' namespace to be tracked")
	}

	// Verify scores are populated for all nodes
	for key := range snap.Nodes {
		if _, ok := snap.NodeScores[key]; !ok {
			t.Errorf("expected NodeScores to contain key %s", key)
		}
	}

	// Verify edges were created (Service selects Deployment via pod)
	if len(snap.Edges) == 0 {
		t.Error("expected at least one edge (Service -> Deployment)")
	}
}

func TestBuildSnapshot_EmptyResources(t *testing.T) {
	res := &ClusterResources{}

	snap := BuildSnapshot(res, false, nil, nil)

	if snap == nil {
		t.Fatal("expected non-nil snapshot")
	}
	if len(snap.Nodes) != 0 {
		t.Errorf("expected 0 nodes, got %d", len(snap.Nodes))
	}
	if len(snap.Edges) != 0 {
		t.Errorf("expected 0 edges, got %d", len(snap.Edges))
	}
	if snap.TotalWorkloads != 0 {
		t.Errorf("expected TotalWorkloads=0, got %d", snap.TotalWorkloads)
	}
	if snap.BuiltAt == 0 {
		t.Error("expected BuiltAt to be non-zero")
	}
	if snap.Nodes == nil {
		t.Error("expected Nodes map to be initialized (not nil)")
	}
	if snap.Forward == nil {
		t.Error("expected Forward map to be initialized (not nil)")
	}
	if snap.Reverse == nil {
		t.Error("expected Reverse map to be initialized (not nil)")
	}
}

func TestBuildSnapshot_ReplicaCount(t *testing.T) {
	replicas := int32(3)
	res := &ClusterResources{
		Deployments: []appsv1.Deployment{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "prod"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
				},
			},
		},
	}

	snap := BuildSnapshot(res, false, nil, nil)

	key := "Deployment/prod/api"
	if got := snap.NodeReplicas[key]; got != 3 {
		t.Errorf("expected replica count 3 for %s, got %d", key, got)
	}
}

func TestGetReplicaCountFromResources(t *testing.T) {
	replicas := int32(5)
	res := &ClusterResources{
		Deployments: []appsv1.Deployment{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
			},
		},
	}

	got := getReplicaCountFromResources(res, "Deployment", "web", "default")
	if got != 5 {
		t.Errorf("expected 5, got %d", got)
	}

	got = getReplicaCountFromResources(res, "Service", "web", "default")
	if got != 0 {
		t.Errorf("expected 0 for Service kind, got %d", got)
	}

	got = getReplicaCountFromResources(res, "Deployment", "missing", "default")
	if got != 0 {
		t.Errorf("expected 0 for missing deployment, got %d", got)
	}
}
