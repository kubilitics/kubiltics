package financial

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

type fakeRepo struct{}

func (f *fakeRepo) SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error {
	return nil
}
func (f *fakeRepo) GetCatalogMeta(ctx context.Context, key string) (string, error) { return "", nil }
func (f *fakeRepo) SetCatalogMeta(ctx context.Context, key, value string) error    { return nil }
func (f *fakeRepo) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	return &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{ID: id, Name: "test"},
		CostModels: []models.AddOnCostModel{
			{ClusterTier: "dev", MonthlyCostUSDEstimate: 10.0},
		},
	}, nil
}
func (f *fakeRepo) ListAddOns(ctx context.Context, tier string, tags []string, search string) ([]models.AddOnEntry, error) {
	return nil, nil
}
func (f *fakeRepo) CreateInstall(ctx context.Context, install *models.AddOnInstall) error { return nil }
func (f *fakeRepo) FindInstallByIdempotencyKey(ctx context.Context, clusterID, idempotencyKey string) (*models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (f *fakeRepo) GetInstall(ctx context.Context, id string) (*models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (f *fakeRepo) ListClusterInstalls(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (f *fakeRepo) UpdateInstallStatus(ctx context.Context, id string, status models.AddOnStatus, helmRevision int) error {
	return nil
}
func (f *fakeRepo) UpdateInstallVersion(ctx context.Context, id string, version string) error {
	return nil
}
func (f *fakeRepo) UpsertHealth(ctx context.Context, health *models.AddOnHealth) error { return nil }
func (f *fakeRepo) CreateAuditEvent(ctx context.Context, event *models.AddOnAuditEvent) error {
	return nil
}
func (f *fakeRepo) ListAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	return nil, nil
}
func (f *fakeRepo) GetUpgradePolicy(ctx context.Context, installID string) (*models.AddOnUpgradePolicy, error) {
	return nil, nil
}
func (f *fakeRepo) UpsertUpgradePolicy(ctx context.Context, policy *models.AddOnUpgradePolicy) error {
	return nil
}
func (f *fakeRepo) DeleteInstall(ctx context.Context, id string) error { return nil }
func (f *fakeRepo) ListProfiles(ctx context.Context) ([]models.ClusterProfile, error) {
	return nil, nil
}
func (f *fakeRepo) GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error) {
	return nil, nil
}
func (f *fakeRepo) CreateProfile(ctx context.Context, profile *models.ClusterProfile) error {
	return nil
}
func (f *fakeRepo) SeedBuiltinProfiles(ctx context.Context) error { return nil }
func (f *fakeRepo) CreateRollout(ctx context.Context, rollout *models.AddonRollout) error {
	return nil
}
func (f *fakeRepo) GetRollout(ctx context.Context, id string) (*models.AddonRollout, error) {
	return nil, nil
}
func (f *fakeRepo) ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error) {
	return nil, nil
}
func (f *fakeRepo) UpdateRolloutStatus(ctx context.Context, id string, status models.RolloutStatus) error {
	return nil
}
func (f *fakeRepo) UpsertRolloutClusterStatus(ctx context.Context, cs *models.RolloutClusterStatus) error {
	return nil
}
func (f *fakeRepo) CreateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	return nil
}
func (f *fakeRepo) GetNotificationChannel(ctx context.Context, id string) (*models.NotificationChannel, error) {
	return nil, nil
}
func (f *fakeRepo) ListNotificationChannels(ctx context.Context) ([]models.NotificationChannel, error) {
	return nil, nil
}
func (f *fakeRepo) UpdateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	return nil
}
func (f *fakeRepo) DeleteNotificationChannel(ctx context.Context, id string) error { return nil }
func (f *fakeRepo) CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	return nil
}
func (f *fakeRepo) GetMaintenanceWindow(ctx context.Context, id string) (*models.AddonMaintenanceWindow, error) {
	return nil, nil
}
func (f *fakeRepo) ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error) {
	return nil, nil
}
func (f *fakeRepo) DeleteMaintenanceWindow(ctx context.Context, id string) error { return nil }
func (f *fakeRepo) SetPolicyNextEligibleAt(ctx context.Context, installID string, t time.Time) error {
	return nil
}
func (f *fakeRepo) CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error {
	return nil
}
func (f *fakeRepo) GetCatalogSource(ctx context.Context, id string) (*models.PrivateCatalogSource, error) {
	return nil, nil
}
func (f *fakeRepo) ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error) {
	return nil, nil
}
func (f *fakeRepo) DeleteCatalogSource(ctx context.Context, id string) error { return nil }
func (f *fakeRepo) UpdateCatalogSourceSyncedAt(ctx context.Context, id string, t time.Time) error {
	return nil
}
func (f *fakeRepo) UpsertAddonEntries(ctx context.Context, entries []models.AddOnEntry) error {
	return nil
}

func TestEstimateInstallCost(t *testing.T) {
	catalog := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{ID: "test-id", Name: "Test Addon"},
		CostModels: []models.AddOnCostModel{
			{ClusterTier: "dev", MonthlyCostUSDEstimate: 5.0, CPUMillicores: 100},
			{ClusterTier: "production", MonthlyCostUSDEstimate: 50.0, CPUMillicores: 1000},
		},
	}

	// Test exact match
	est := EstimateInstallCost(catalog, models.TierProduction)
	assert.Equal(t, 50.0, est.MonthlyCostUSD)
	assert.Equal(t, 1000, est.CPUMillicores)

	// Test fallback to dev
	est = EstimateInstallCost(catalog, models.TierStaging)
	assert.Equal(t, 5.0, est.MonthlyCostUSD)
}

func TestEstimatePlanCost(t *testing.T) {
	ctx := context.Background()
	repo := &fakeRepo{}

	plan := &models.InstallPlan{
		Steps: []models.InstallStep{
			{Action: models.ActionInstall, AddonID: "test-id", ReleaseName: "rel-1"},
			{Action: models.ActionSkip, AddonID: "test-2"},
			{Action: models.ActionUpgrade, AddonID: "test-3"},
		},
	}

	est, err := EstimatePlanCost(ctx, plan, repo, models.TierDev)
	assert.NoError(t, err)
	assert.NotNil(t, est)
	assert.Len(t, est.Steps, 1) // Only Install step counted
	assert.Equal(t, 10.0, est.TotalMonthlyCostDeltaUSD)

	estNil, err := EstimatePlanCost(ctx, nil, repo, models.TierDev)
	assert.NoError(t, err)
	assert.Len(t, estNil.Steps, 0)
}

func TestDetectClusterTier(t *testing.T) {
	ctx := context.Background()

	// 1 node - dev
	clientset := fake.NewSimpleClientset(&corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node1"},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
		},
	})
	assert.Equal(t, models.TierDev, DetectClusterTier(ctx, clientset))

	// 3 nodes - staging
	clientset = fake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n1"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n2"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}},
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "n3"}, Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}}},
	)
	assert.Equal(t, models.TierStaging, DetectClusterTier(ctx, clientset))
}

func TestOpenCostClient_QueryAllocation(t *testing.T) {
	ctx := context.Background()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := allocationResponse{
			Code: 200,
			Data: []map[string]allocationEntry{
				{
					"rel1": {
						TotalCost: 10.5,
					},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewOpenCostClient(server.URL)
	allocs, err := client.QueryAllocation(ctx, "1d", "namespace")
	assert.NoError(t, err)
	assert.Len(t, allocs, 1)
	assert.Equal(t, "rel1", allocs[0].Name)
}

func TestRightsizer_GetAddonRecommendations(t *testing.T) {
	ctx := context.Background()

	// OpenCost mock
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := allocationResponse{
			Code: 200,
			Data: []map[string]allocationEntry{
				{
					"rel1": {
						TotalCost:         10.5,
						CPUCoreUsageAvg:   0.1,
						RAMByteUsageAvg:   128 * 1024 * 1024,
						CPUCoreRequestAvg: 0.5,
						RAMByteRequestAvg: 512 * 1024 * 1024,
					},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	// K8s mock
	clientset := fake.NewSimpleClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: "pod1", Namespace: "default",
			Labels: map[string]string{"app.kubernetes.io/instance": "rel1"},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("512Mi"),
						},
					},
				},
			},
		},
	})

	oc := NewOpenCostClient(server.URL)
	rs := NewRightsizer(oc, clientset)

	rec, err := rs.GetAddonRecommendations(ctx, "rel1", "default")
	assert.NoError(t, err)
	assert.NotNil(t, rec)
	assert.Less(t, rec.SuggestedCPU, rec.CurrentCPU)
	assert.Less(t, rec.SuggestedMem, rec.CurrentMem)
}

// ──────────────────────────────────────────────────────────────────────────────
// Mocks for AutoInstaller and StackDetector tests
// ──────────────────────────────────────────────────────────────────────────────

type mockResolver struct{}

func (m *mockResolver) Resolve(ctx context.Context, addonID, clusterID string) (*models.InstallPlan, error) {
	if addonID == prometheusAddonID {
		return &models.InstallPlan{
			Steps: []models.InstallStep{
				{AddonID: prometheusAddonID, Action: models.ActionInstall, EstimatedDurationSec: 60, EstimatedCostDeltaUSD: 10},
			},
		}, nil
	}
	if addonID == opencostAddonID {
		return &models.InstallPlan{
			Steps: []models.InstallStep{
				{AddonID: opencostAddonID, Action: models.ActionInstall, EstimatedDurationSec: 30, EstimatedCostDeltaUSD: 5},
			},
		}, nil
	}
	return nil, nil
}

type fakeHelmClient struct {
	releases []*models.HelmReleaseInfo
}

func (f *fakeHelmClient) Install(ctx context.Context, req helm.InstallRequest) (*helm.InstallResult, error) {
	return nil, nil
}
func (f *fakeHelmClient) Upgrade(ctx context.Context, req helm.UpgradeRequest) (*helm.UpgradeResult, error) {
	return nil, nil
}
func (f *fakeHelmClient) Rollback(ctx context.Context, req helm.RollbackRequest) error   { return nil }
func (f *fakeHelmClient) Uninstall(ctx context.Context, req helm.UninstallRequest) error { return nil }
func (f *fakeHelmClient) Status(ctx context.Context, releaseName, namespace string) (*helm.ReleaseStatus, error) {
	return nil, nil
}
func (f *fakeHelmClient) History(ctx context.Context, releaseName, namespace string) ([]models.HelmReleaseRevision, error) {
	return nil, nil
}
func (f *fakeHelmClient) DryRun(ctx context.Context, req helm.InstallRequest) (*helm.DryRunResult, error) {
	return nil, nil
}
func (f *fakeHelmClient) Test(ctx context.Context, releaseName, namespace string, timeout time.Duration) (*helm.TestResult, error) {
	return nil, nil
}
func (f *fakeHelmClient) ListReleases(ctx context.Context, namespace string) ([]*models.HelmReleaseInfo, error) {
	return f.releases, nil
}

func TestBuildFinancialStackPlan(t *testing.T) {
	ctx := context.Background()
	r := &mockResolver{}

	// Case 1: Stack is nil
	plan, err := BuildFinancialStackPlan(ctx, "cluster-1", nil, r)
	assert.NoError(t, err)
	assert.Nil(t, plan)

	// Case 2: Both installed
	stackBoth := &FinancialStack{PrometheusInstalled: true, OpenCostInstalled: true}
	plan, err = BuildFinancialStackPlan(ctx, "cluster-1", stackBoth, r)
	assert.NoError(t, err)
	assert.Nil(t, plan)

	// Case 3: Neither installed
	stackNeither := &FinancialStack{PrometheusInstalled: false, OpenCostInstalled: false}
	plan, err = BuildFinancialStackPlan(ctx, "cluster-1", stackNeither, r)
	assert.NoError(t, err)
	assert.NotNil(t, plan)
	assert.Len(t, plan.Steps, 2)
	assert.Equal(t, 90, plan.TotalEstimatedDurationSec)
	assert.Equal(t, 15.0, plan.TotalEstimatedCostDeltaUSD)

	// Case 4: GenerateOpenCostValues
	stackBoth.PrometheusEndpoint = "http://prom.default:9090"
	vals := GenerateOpenCostValues(stackBoth)
	assert.NotNil(t, vals)
	assert.Contains(t, vals, "opencost")
}

func TestDetectFinancialStack(t *testing.T) {
	ctx := context.Background()
	k8sClient := fake.NewSimpleClientset()

	helmClient := &fakeHelmClient{
		releases: []*models.HelmReleaseInfo{
			{Name: "prom", Namespace: "default", ChartName: "kube-prometheus-stack"},
			{Name: "oc", Namespace: "default", ChartName: "opencost"},
		},
	}

	stack, err := DetectFinancialStack(ctx, k8sClient, helmClient)
	assert.NoError(t, err)
	assert.NotNil(t, stack)
	assert.True(t, stack.PrometheusInstalled)
	assert.True(t, stack.KubeStateMetricsInstalled) // Inferred from kube-prometheus-stack
	assert.True(t, stack.OpenCostInstalled)
	assert.Equal(t, "http://prom.default.svc.cluster.local:9090", stack.PrometheusEndpoint)
	assert.Equal(t, "http://oc.default.svc.cluster.local:9003", stack.OpenCostEndpoint)
}
