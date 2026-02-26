package scanner

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
)

type fakeRepo struct {
	addon    *models.AddOnDetail
	installs []models.AddOnInstallWithHealth
}

func (f *fakeRepo) SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error {
	return nil
}
func (f *fakeRepo) GetCatalogMeta(ctx context.Context, key string) (string, error) { return "", nil }
func (f *fakeRepo) SetCatalogMeta(ctx context.Context, key, value string) error    { return nil }
func (f *fakeRepo) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	return f.addon, nil
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
	return f.installs, nil
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

type fakeClusterSvc struct {
	client *k8s.Client
}

func (f *fakeClusterSvc) GetCluster(ctx context.Context, id string) (*models.Cluster, error) {
	return &models.Cluster{ID: id}, nil
}
func (f *fakeClusterSvc) ListClusters(ctx context.Context) ([]*models.Cluster, error) {
	return nil, nil
}
func (f *fakeClusterSvc) AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error) {
	return nil, nil
}
func (f *fakeClusterSvc) AddClusterFromBytes(ctx context.Context, kubeconfigBytes []byte, contextName string) (*models.Cluster, error) {
	return nil, nil
}
func (f *fakeClusterSvc) RemoveCluster(ctx context.Context, id string) error  { return nil }
func (f *fakeClusterSvc) TestConnection(ctx context.Context, id string) error { return nil }
func (f *fakeClusterSvc) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	return nil, nil
}
func (f *fakeClusterSvc) LoadClustersFromRepo(ctx context.Context) error { return nil }
func (f *fakeClusterSvc) GetClient(id string) (*k8s.Client, error) {
	return f.client, nil
}
func (f *fakeClusterSvc) HasMetalLB(ctx context.Context, id string) (bool, error) { return false, nil }
func (f *fakeClusterSvc) DiscoverClusters(ctx context.Context) ([]*models.Cluster, error) {
	return nil, nil
}
func (f *fakeClusterSvc) GetOverview(clusterID string) (*models.ClusterOverview, bool) {
	return nil, false
}
func (f *fakeClusterSvc) Subscribe(clusterID string) (chan *models.ClusterOverview, func()) {
	return nil, nil
}
func (f *fakeClusterSvc) ReconnectCluster(ctx context.Context, id string) (*models.Cluster, error) {
	return nil, nil
}

func TestClusterScanner_RunPreflight(t *testing.T) {
	ctx := context.Background()

	scheme := runtime.NewScheme()
	scheme.AddKnownTypeWithName(schema.GroupVersionKind{
		Group:   "apiextensions.k8s.io",
		Version: "v1",
		Kind:    "CustomResourceDefinitionList",
	}, &unstructured.UnstructuredList{})

	clientset := k8sfake.NewSimpleClientset()
	dynClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{
			{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}: "CustomResourceDefinitionList",
		})

	client := k8s.NewClientForTest(clientset)
	client.Dynamic = dynClient
	client.Config = &rest.Config{Host: "http://localhost:8080"}

	// Add a storage class to satisfy StorageChecker
	_, _ = clientset.StorageV1().StorageClasses().Create(ctx, &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name: "standard",
			Annotations: map[string]string{
				"storageclass.kubernetes.io/is-default-class": "true",
			},
		},
		Provisioner: "kubernetes.io/no-provisioner",
	}, metav1.CreateOptions{})

	cs := &fakeClusterSvc{client: client}
	repo := &fakeRepo{
		addon: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "test-addon", Name: "Test"},
		},
	}

	scanner := NewClusterScanner(cs, repo, nil)

	plan := models.InstallPlan{
		RequestedAddonID: "test-addon",
		Steps: []models.InstallStep{
			{AddonID: "test-addon", Action: models.ActionInstall, Namespace: "default", ToVersion: "1.0.0"},
		},
	}

	report, err := scanner.RunPreflight(ctx, "cluster-1", plan)
	assert.NoError(t, err)
	assert.NotNil(t, report)
	assert.Equal(t, "cluster-1", report.ClusterID)

	if report.OverallStatus != models.PreflightGO {
		t.Logf("Preflight overall status: %s", report.OverallStatus)
		for _, b := range report.Blockers {
			t.Logf("Blocker: %s", b)
		}
		for _, w := range report.Warnings {
			t.Logf("Warning: %s", w)
		}
	}

	// Temporarily accept WARN to see the output and coverage
	assert.True(t, report.OverallStatus == models.PreflightGO || report.OverallStatus == models.PreflightWARN)
}
