package fleet

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/graph"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// buildPrimaryCluster creates a primary cluster with critical workloads.
func buildPrimaryCluster() *graph.GraphSnapshot {
	replicas3 := int32(3)
	replicas1 := int32(1)
	res := &graph.ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "web-abc", Namespace: "default", Labels: map[string]string{"app": "web"}}},
			{ObjectMeta: metav1.ObjectMeta{Name: "api-xyz", Namespace: "default", Labels: map[string]string{"app": "api"}}},
			{ObjectMeta: metav1.ObjectMeta{Name: "db-123", Namespace: "default", Labels: map[string]string{"app": "db"}}},
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
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas3,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
				},
			},
			{
				ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas1,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "db"}},
				},
			},
		},
		Services: []corev1.Service{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web-svc", Namespace: "default"},
				Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "web"}},
			},
			{
				ObjectMeta: metav1.ObjectMeta{Name: "api-svc", Namespace: "default"},
				Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "api"}},
			},
		},
	}
	return graph.BuildSnapshot(res, false, nil, nil)
}

// buildBackupCluster_Full creates a backup that mirrors the primary.
func buildBackupCluster_Full() *graph.GraphSnapshot {
	replicas3 := int32(3)
	replicas1 := int32(1)
	res := &graph.ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "web-bck", Namespace: "default", Labels: map[string]string{"app": "web"}}},
			{ObjectMeta: metav1.ObjectMeta{Name: "api-bck", Namespace: "default", Labels: map[string]string{"app": "api"}}},
			{ObjectMeta: metav1.ObjectMeta{Name: "db-bck", Namespace: "default", Labels: map[string]string{"app": "db"}}},
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
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas3,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
				},
			},
			{
				ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas1,
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "db"}},
				},
			},
		},
		Services: []corev1.Service{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web-svc", Namespace: "default"},
				Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "web"}},
			},
			{
				ObjectMeta: metav1.ObjectMeta{Name: "api-svc", Namespace: "default"},
				Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "api"}},
			},
		},
	}
	return graph.BuildSnapshot(res, false, nil, nil)
}

// buildBackupCluster_Partial creates a backup missing some workloads and with
// lower replica counts.
func buildBackupCluster_Partial() *graph.GraphSnapshot {
	replicas1 := int32(1)
	res := &graph.ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "web-bck", Namespace: "default", Labels: map[string]string{"app": "web"}}},
		},
		Deployments: []appsv1.Deployment{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Replicas: &replicas1,
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

func TestAssessDR_FullMirror(t *testing.T) {
	primary := buildPrimaryCluster()
	backup := buildBackupCluster_Full()

	result := AssessDR(primary, backup)

	if result == nil {
		t.Fatal("expected non-nil DR assessment")
	}

	// Full mirror should have 100% workload coverage
	if result.WorkloadCoverage != 100 {
		t.Errorf("expected 100%% workload coverage, got %f", result.WorkloadCoverage)
	}

	if len(result.MissingWorkloads) != 0 {
		t.Errorf("expected 0 missing workloads, got %d: %v", len(result.MissingWorkloads), result.MissingWorkloads)
	}

	// Readiness score should be high
	if result.ReadinessScore < 70 {
		t.Errorf("expected readiness score >= 70 for full mirror, got %f", result.ReadinessScore)
	}
}

func TestAssessDR_PartialBackup(t *testing.T) {
	primary := buildPrimaryCluster()
	backup := buildBackupCluster_Partial()

	result := AssessDR(primary, backup)

	// Partial backup: "web" exists, "api" and "db" missing from backup
	if result.WorkloadCoverage >= 100 {
		t.Errorf("expected < 100%% coverage, got %f", result.WorkloadCoverage)
	}

	if len(result.MissingWorkloads) == 0 {
		t.Error("expected some missing workloads")
	}

	// Check "api" and "db" are in missing
	missingSet := make(map[string]bool)
	for _, w := range result.MissingWorkloads {
		missingSet[w] = true
	}
	if !missingSet["Deployment/default/api"] {
		t.Error("expected Deployment/default/api to be missing")
	}
	if !missingSet["Deployment/default/db"] {
		t.Error("expected Deployment/default/db to be missing")
	}

	// Readiness score should be lower
	if result.ReadinessScore > 90 {
		t.Errorf("expected readiness < 90 for partial backup, got %f", result.ReadinessScore)
	}
}

func TestAssessDR_Recommendations(t *testing.T) {
	primary := buildPrimaryCluster()
	backup := buildBackupCluster_Partial()

	result := AssessDR(primary, backup)

	if len(result.Recommendations) == 0 {
		t.Error("expected at least one recommendation for partial backup")
	}

	// Should recommend deploying missing workloads
	foundMissingRec := false
	for _, rec := range result.Recommendations {
		if len(rec) > 0 && rec[0] == 'D' { // "Deploy ... missing workloads"
			foundMissingRec = true
		}
	}
	if !foundMissingRec {
		t.Error("expected recommendation about deploying missing workloads")
	}
}

func TestAssessDR_NilSnapshots(t *testing.T) {
	result := AssessDR(nil, nil)
	if result == nil {
		t.Fatal("expected non-nil result for nil snapshots")
	}
	if len(result.Recommendations) == 0 {
		t.Error("expected recommendation about unavailable snapshots")
	}
}

func TestAssessDR_EmptyPrimary(t *testing.T) {
	primary := graph.BuildSnapshot(&graph.ClusterResources{}, false, nil, nil)
	backup := buildBackupCluster_Partial()

	result := AssessDR(primary, backup)

	// Empty primary means 100% coverage trivially
	if result.WorkloadCoverage != 100 {
		t.Errorf("expected 100%% coverage with empty primary, got %f", result.WorkloadCoverage)
	}
	if result.ReadinessScore != 100 {
		t.Errorf("expected 100 readiness for empty primary, got %f", result.ReadinessScore)
	}
}

func TestGenerateDRRecommendations_NoIssues(t *testing.T) {
	a := &DRAssessment{
		WorkloadCoverage: 100,
		ResilienceParity: 100,
		ReadinessScore:   95,
		MissingWorkloads: []string{},
		ParityGaps:       []ParityGap{},
	}

	recs := generateDRRecommendations(a)
	if len(recs) == 0 {
		t.Error("expected at least the strong readiness message")
	}

	// Should mention failover drills since score >= 90
	foundDrills := false
	for _, rec := range recs {
		if len(rec) > 10 {
			foundDrills = true
		}
	}
	if !foundDrills {
		t.Error("expected recommendation about failover drills for high readiness")
	}
}

func TestAllWorkloadKeys(t *testing.T) {
	primary := buildPrimaryCluster()
	backup := buildBackupCluster_Partial()

	keys := allWorkloadKeys(primary, backup)

	// Primary has: web, api, db; Backup has: web -> total unique = 3
	if len(keys) != 3 {
		t.Errorf("expected 3 unique workload keys, got %d: %v", len(keys), keys)
	}
}

func TestWorkloadKeyToRef(t *testing.T) {
	ref := workloadKeyToRef("Deployment/prod/api")
	if ref.Kind != "Deployment" || ref.Namespace != "prod" || ref.Name != "api" {
		t.Errorf("unexpected ref: %+v", ref)
	}
}

func TestSplitKey(t *testing.T) {
	parts := splitKey("Deployment/default/web")
	if len(parts) != 3 || parts[0] != "Deployment" || parts[1] != "default" || parts[2] != "web" {
		t.Errorf("unexpected parts: %v", parts)
	}
}
