package lifecycle

import (
	"context"
	"log/slog"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/addon/registry"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	k8sruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
)

type fakeRESTMapper struct {
	meta.RESTMapper
}

func (m *fakeRESTMapper) RESTMapping(gk schema.GroupKind, versions ...string) (*meta.RESTMapping, error) {
	return &meta.RESTMapping{
		Resource: schema.GroupVersionResource{Group: gk.Group, Version: versions[0], Resource: strings.ToLower(gk.Kind) + "s"},
		Scope:    meta.RESTScopeNamespace,
	}, nil
}

// fakeAddOnRepository is a minimal in-memory implementation of repository.AddOnRepository
// that supports the methods used by LifecycleController and HealthMonitor in this test.
type fakeAddOnRepository struct {
	mu       sync.Mutex
	installs map[string]models.AddOnInstallWithHealth
}

var _ repository.AddOnRepository = (*fakeAddOnRepository)(nil)

func newFakeAddOnRepository() *fakeAddOnRepository {
	return &fakeAddOnRepository{
		installs: make(map[string]models.AddOnInstallWithHealth),
	}
}

func (r *fakeAddOnRepository) SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error {
	return nil
}

func (r *fakeAddOnRepository) GetCatalogMeta(ctx context.Context, key string) (string, error) {
	return "", nil
}

func (r *fakeAddOnRepository) SetCatalogMeta(ctx context.Context, key, value string) error {
	return nil
}

func (r *fakeAddOnRepository) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	if id == "test-addon" {
		return &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "test-addon", Version: "1.1.0"},
		}, nil
	}
	return nil, nil
}

func (r *fakeAddOnRepository) ListAddOns(ctx context.Context, tier string, tags []string, search string) ([]models.AddOnEntry, error) {
	return nil, nil
}

func (r *fakeAddOnRepository) CreateInstall(ctx context.Context, install *models.AddOnInstall) error {
	return nil
}

func (r *fakeAddOnRepository) FindInstallByIdempotencyKey(ctx context.Context, clusterID, idempotencyKey string) (*models.AddOnInstallWithHealth, error) {
	return nil, nil
}

func (r *fakeAddOnRepository) GetInstall(ctx context.Context, id string) (*models.AddOnInstallWithHealth, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.installs[id]
	if !ok {
		return nil, context.DeadlineExceeded
	}
	// Return a copy to avoid external mutation.
	copy := inst
	return &copy, nil
}

func (r *fakeAddOnRepository) ListClusterInstalls(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []models.AddOnInstallWithHealth
	for _, inst := range r.installs {
		if inst.ClusterID == clusterID {
			out = append(out, inst)
		}
	}
	return out, nil
}

func (r *fakeAddOnRepository) UpdateInstallStatus(ctx context.Context, id string, status models.AddOnStatus, helmRevision int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.installs[id]
	if !ok {
		return nil
	}
	inst.Status = string(status)
	inst.HelmRevision = helmRevision
	r.installs[id] = inst
	return nil
}

func (r *fakeAddOnRepository) UpdateInstallVersion(ctx context.Context, id string, version string) error {
	return nil
}

func (r *fakeAddOnRepository) UpsertHealth(ctx context.Context, health *models.AddOnHealth) error {
	return nil
}

func (r *fakeAddOnRepository) CreateAuditEvent(ctx context.Context, event *models.AddOnAuditEvent) error {
	return nil
}

func (r *fakeAddOnRepository) ListAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	return nil, nil
}

func (r *fakeAddOnRepository) GetUpgradePolicy(ctx context.Context, installID string) (*models.AddOnUpgradePolicy, error) {
	return nil, nil
}

func (r *fakeAddOnRepository) UpsertUpgradePolicy(ctx context.Context, policy *models.AddOnUpgradePolicy) error {
	return nil
}

func (r *fakeAddOnRepository) DeleteInstall(ctx context.Context, id string) error {
	return nil
}
func (r *fakeAddOnRepository) ListProfiles(ctx context.Context) ([]models.ClusterProfile, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) CreateProfile(ctx context.Context, profile *models.ClusterProfile) error {
	return nil
}
func (r *fakeAddOnRepository) SeedBuiltinProfiles(ctx context.Context) error { return nil }
func (r *fakeAddOnRepository) CreateRollout(ctx context.Context, rollout *models.AddonRollout) error {
	return nil
}
func (r *fakeAddOnRepository) GetRollout(ctx context.Context, id string) (*models.AddonRollout, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) UpdateRolloutStatus(ctx context.Context, id string, status models.RolloutStatus) error {
	return nil
}
func (r *fakeAddOnRepository) UpsertRolloutClusterStatus(ctx context.Context, cs *models.RolloutClusterStatus) error {
	return nil
}
func (r *fakeAddOnRepository) CreateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	return nil
}
func (r *fakeAddOnRepository) GetNotificationChannel(ctx context.Context, id string) (*models.NotificationChannel, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) ListNotificationChannels(ctx context.Context) ([]models.NotificationChannel, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) UpdateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	return nil
}
func (r *fakeAddOnRepository) DeleteNotificationChannel(ctx context.Context, id string) error {
	return nil
}

func (r *fakeAddOnRepository) CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	return nil
}
func (r *fakeAddOnRepository) GetMaintenanceWindow(ctx context.Context, id string) (*models.AddonMaintenanceWindow, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) DeleteMaintenanceWindow(ctx context.Context, id string) error {
	return nil
}
func (r *fakeAddOnRepository) SetPolicyNextEligibleAt(ctx context.Context, installID string, t time.Time) error {
	return nil
}
func (r *fakeAddOnRepository) CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error {
	return nil
}
func (r *fakeAddOnRepository) GetCatalogSource(ctx context.Context, id string) (*models.PrivateCatalogSource, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error) {
	return nil, nil
}
func (r *fakeAddOnRepository) DeleteCatalogSource(ctx context.Context, id string) error {
	return nil
}
func (r *fakeAddOnRepository) UpdateCatalogSourceSyncedAt(ctx context.Context, id string, t time.Time) error {
	return nil
}
func (r *fakeAddOnRepository) UpsertAddonEntries(ctx context.Context, entries []models.AddOnEntry) error {
	return nil
}

// fakeClusterService is a minimal implementation of service.ClusterService for this test.
type fakeClusterService struct {
	mu       sync.Mutex
	clusters map[string]*models.Cluster
	clients  map[string]*k8s.Client
}

var _ service.ClusterService = (*fakeClusterService)(nil)

func newFakeClusterService() *fakeClusterService {
	return &fakeClusterService{
		clusters: make(map[string]*models.Cluster),
		clients:  make(map[string]*k8s.Client),
	}
}

func (s *fakeClusterService) ListClusters(ctx context.Context) ([]*models.Cluster, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*models.Cluster
	for _, c := range s.clusters {
		out = append(out, c)
	}
	return out, nil
}

func (s *fakeClusterService) GetCluster(ctx context.Context, id string) (*models.Cluster, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clusters[id], nil
}

func (s *fakeClusterService) AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error) {
	return nil, nil
}

func (s *fakeClusterService) AddClusterFromBytes(ctx context.Context, kubeconfigBytes []byte, contextName string) (*models.Cluster, error) {
	return nil, nil
}

func (s *fakeClusterService) RemoveCluster(ctx context.Context, id string) error {
	return nil
}

func (s *fakeClusterService) TestConnection(ctx context.Context, id string) error {
	return nil
}

func (s *fakeClusterService) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	return nil, nil
}

func (s *fakeClusterService) LoadClustersFromRepo(ctx context.Context) error {
	return nil
}

func (s *fakeClusterService) GetClient(id string) (*k8s.Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clients[id], nil
}

func (s *fakeClusterService) HasMetalLB(ctx context.Context, id string) (bool, error) {
	return false, nil
}

func (s *fakeClusterService) DiscoverClusters(ctx context.Context) ([]*models.Cluster, error) {
	return nil, nil
}

func (s *fakeClusterService) GetOverview(clusterID string) (*models.ClusterOverview, bool) {
	return nil, false
}

func (s *fakeClusterService) Subscribe(clusterID string) (chan *models.ClusterOverview, func()) {
	ch := make(chan *models.ClusterOverview)
	return ch, func() { close(ch) }
}

func (s *fakeClusterService) ReconnectCluster(ctx context.Context, id string) (*models.Cluster, error) {
	return nil, nil
}

// fakeHelmClient is a no-op implementation of helm.HelmClient used to satisfy the factory.
type fakeHelmClient struct{}

var _ helm.HelmClient = (*fakeHelmClient)(nil)

func (f *fakeHelmClient) Install(ctx context.Context, req helm.InstallRequest) (*helm.InstallResult, error) {
	return &helm.InstallResult{}, nil
}

func (f *fakeHelmClient) Upgrade(ctx context.Context, req helm.UpgradeRequest) (*helm.UpgradeResult, error) {
	return &helm.UpgradeResult{}, nil
}

func (f *fakeHelmClient) Rollback(ctx context.Context, req helm.RollbackRequest) error {
	return nil
}

func (f *fakeHelmClient) Uninstall(ctx context.Context, req helm.UninstallRequest) error {
	return nil
}

func (f *fakeHelmClient) Status(ctx context.Context, releaseName, namespace string) (*helm.ReleaseStatus, error) {
	return &helm.ReleaseStatus{}, nil
}

func (f *fakeHelmClient) History(ctx context.Context, releaseName, namespace string) ([]models.HelmReleaseRevision, error) {
	return nil, nil
}

func (f *fakeHelmClient) DryRun(ctx context.Context, req helm.InstallRequest) (*helm.DryRunResult, error) {
	return &helm.DryRunResult{}, nil
}

func (f *fakeHelmClient) Test(ctx context.Context, releaseName, namespace string, timeout time.Duration) (*helm.TestResult, error) {
	return &helm.TestResult{}, nil
}

func (f *fakeHelmClient) ListReleases(ctx context.Context, namespace string) ([]*models.HelmReleaseInfo, error) {
	return nil, nil
}

func TestLMCGoroutineCleanup(t *testing.T) {
	t.Parallel()

	repo := newFakeAddOnRepository()
	clusterSvc := newFakeClusterService()

	// Create a few fake clusters with fake K8s clients and installs.
	clusterCount := 5
	for i := 0; i < clusterCount; i++ {
		clusterID := uuid.NewString()
		clusterSvc.clusters[clusterID] = &models.Cluster{
			ID:             clusterID,
			Name:           clusterID,
			KubeconfigPath: "/dev/null",
		}
		clientset := fake.NewSimpleClientset(
			&corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name:      "addon-pod",
					Namespace: "default",
					Labels: map[string]string{
						"app.kubernetes.io/instance": "release-" + clusterID,
					},
				},
				Spec: corev1.PodSpec{},
				Status: corev1.PodStatus{
					Conditions: []corev1.PodCondition{
						{
							Type:   corev1.PodReady,
							Status: corev1.ConditionTrue,
						},
					},
				},
			},
		)
		client := k8s.NewClientForTest(clientset)
		clusterSvc.clients[clusterID] = client

		installID := uuid.NewString()
		repo.installs[installID] = models.AddOnInstallWithHealth{
			AddOnInstall: models.AddOnInstall{
				ID:          installID,
				ClusterID:   clusterID,
				AddonID:     "test/addon",
				ReleaseName: "release-" + clusterID,
				Namespace:   "default",
				Status:      string(models.StatusInstalled),
			},
		}
	}

	helmFactory := func(kubeconfig []byte, namespace string, logger *slog.Logger) (helm.HelmClient, error) {
		return &fakeHelmClient{}, nil
	}

	logger := slog.Default()
	// Construct controller with our fake services. We ignore registry (nil) because UpgradeChecker
	// is not exercised in this test.
	controller := &LifecycleController{
		clusterService:    clusterSvc,
		repo:              repo,
		helmClientFactory: helmFactory,
		reg:               nil,
		logger:            logger,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	controller.runCtx, controller.runCancel = context.WithCancel(ctx)

	before := runtime.NumGoroutine()

	for id := range clusterSvc.clusters {
		if err := controller.RegisterCluster(id); err != nil {
			t.Fatalf("RegisterCluster(%s) error = %v", id, err)
		}
	}

	time.Sleep(200 * time.Millisecond)
	mid := runtime.NumGoroutine()
	if mid <= before {
		t.Fatalf("expected more goroutines after RegisterCluster, before=%d mid=%d", before, mid)
	}

	for id := range clusterSvc.clusters {
		if err := controller.DeregisterCluster(id); err != nil {
			t.Fatalf("DeregisterCluster(%s) error = %v", id, err)
		}
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		after := runtime.NumGoroutine()
		if after <= before+5 {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}

	after := runtime.NumGoroutine()
	t.Fatalf("goroutine count did not return near baseline, before=%d after=%d", before, after)
}

func TestUpgradeChecker_CheckForUpgrades(t *testing.T) {
	ctx := context.Background()
	repo := newFakeAddOnRepository()
	reg := registry.NewRegistry(repo, nil)
	checker := NewUpgradeChecker(reg, repo, nil)

	// Base install that is behind the catalog version (1.0.0 vs 1.1.0)
	baseInstall := models.AddOnInstallWithHealth{
		AddOnInstall: models.AddOnInstall{
			ID:               "inst-1",
			ClusterID:        "cluster-1",
			AddonID:          "test-addon",
			InstalledVersion: "1.0.0",
		},
	}

	// 1. Manual Policy
	instManual := baseInstall
	instManual.Policy = &models.AddOnUpgradePolicy{Policy: string(models.PolicyManual)}
	ev, err := checker.CheckForUpgrades(ctx, instManual)
	assert.NoError(t, err)
	assert.Nil(t, ev)

	// 2. Minor Policy (Allowed: 1.0.0 -> 1.1.0)
	instMinor := baseInstall
	instMinor.Policy = &models.AddOnUpgradePolicy{Policy: string(models.PolicyMinor), AutoUpgradeEnabled: true}
	ev, err = checker.CheckForUpgrades(ctx, instMinor)
	assert.NoError(t, err)
	assert.NotNil(t, ev)
	assert.Equal(t, "1.1.0", ev.AvailableVersion)

	// 3. Patch Policy (Auto-upgrade denied since it's a minor bump, but UI event MUST be generated)
	instPatch := baseInstall
	instPatch.Policy = &models.AddOnUpgradePolicy{Policy: string(models.PolicyPatchOnly), AutoUpgradeEnabled: true}
	ev, err = checker.CheckForUpgrades(ctx, instPatch)
	assert.NoError(t, err)
	assert.NotNil(t, ev)

	// 4. Conservative (Denied for auto, but returns event for UI)
	instCons := baseInstall
	instCons.Policy = &models.AddOnUpgradePolicy{Policy: string(models.PolicyConservative), AutoUpgradeEnabled: true}
	ev, err = checker.CheckForUpgrades(ctx, instCons)
	assert.NoError(t, err)
	assert.NotNil(t, ev)

	// 5. No Policy
	instNoPolicy := baseInstall
	instNoPolicy.Policy = nil
	ev, err = checker.CheckForUpgrades(ctx, instNoPolicy)
	assert.NoError(t, err)
	assert.Nil(t, ev) // code explicitly returns nil if policy is nil

	// 6. Same version
	instSame := baseInstall
	instSame.InstalledVersion = "1.1.0"
	instSame.Policy = &models.AddOnUpgradePolicy{Policy: string(models.PolicyMinor), AutoUpgradeEnabled: true}
	ev, err = checker.CheckForUpgrades(ctx, instSame)
	assert.NoError(t, err)
	assert.Nil(t, ev)
}

func TestLifecycleController_DriftCheck(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeAddOnRepository()
	clusterSvc := newFakeClusterService()
	logger := slog.Default()

	clusterID := "cluster-1"
	clusterSvc.clusters[clusterID] = &models.Cluster{ID: clusterID, Name: "Cluster 1"}

	installID := "install-1"
	repo.installs[installID] = models.AddOnInstallWithHealth{
		AddOnInstall: models.AddOnInstall{
			ID:          installID,
			ClusterID:   clusterID,
			AddonID:     "test/addon",
			Status:      string(models.StatusInstalled),
			ReleaseName: "rel1",
			Namespace:   "default",
		},
	}

	controller := &LifecycleController{
		clusterService: clusterSvc,
		repo:           repo,
		logger:         logger,
	}

	mon := &clusterMonitor{
		driftDetector: &DriftDetector{
			helmClient: &fakeHelmClient{},
			k8sClient:  dynamicfake.NewSimpleDynamicClient(k8sruntime.NewScheme()),
			restMapper: &fakeRESTMapper{},
			logger:     logger,
		},
	}
	controller.clusterMonitors.Store(clusterID, mon)

	// Since we can't easily mock the Dynamic client here without a lot of setup,
	// we just ensure runDriftCheck doesn't panic and hits the loop.
	controller.runDriftCheck(ctx, clusterID)
}

func TestLifecycleController_UpgradeCheck(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repo := newFakeAddOnRepository()
	clusterSvc := newFakeClusterService()
	logger := slog.Default()

	clusterID := "cluster-1"
	clusterSvc.clusters[clusterID] = &models.Cluster{ID: clusterID, Name: "Cluster 1"}

	installID := "install-1"
	repo.installs[installID] = models.AddOnInstallWithHealth{
		AddOnInstall: models.AddOnInstall{
			ID:        installID,
			ClusterID: clusterID,
			AddonID:   "test/addon",
			Status:    string(models.StatusInstalled),
		},
	}

	controller := &LifecycleController{
		clusterService: clusterSvc,
		repo:           repo,
		logger:         logger,
	}

	mon := &clusterMonitor{
		upgradeChecker: &UpgradeChecker{
			registry: &registry.Registry{},
			repo:     repo,
			logger:   logger,
		},
	}
	controller.clusterMonitors.Store(clusterID, mon)

	controller.runUpgradeCheck(ctx, clusterID)
}

func TestLifecycleController_OnHealthChange(t *testing.T) {
	t.Parallel()
	repo := newFakeAddOnRepository()
	logger := slog.Default()

	var rollbackTriggered bool
	controller := &LifecycleController{
		repo:   repo,
		logger: logger,
		onRollbackRequest: func(ctx context.Context, installID string) {
			rollbackTriggered = true
		},
	}

	event := HealthEvent{
		ClusterID:      "cluster-1",
		AddonInstallID: "install-1",
		NewStatus:      models.StatusDegraded,
		OccurredAt:     time.Now(),
	}

	controller.OnHealthChange(event)

	assert.True(t, rollbackTriggered)
}

func TestLifecycleController_Basics(t *testing.T) {
	clusterSvc := newFakeClusterService()
	repo := newFakeAddOnRepository()
	reg := registry.NewRegistry(repo, nil)
	logger := slog.Default()

	controller := NewLifecycleController(clusterSvc, repo, nil, reg, logger)
	assert.NotNil(t, controller)

	var rollbackCalled bool
	controller.SetRollbackRequest(func(ctx context.Context, installID string) {
		rollbackCalled = true
	})

	var upgradeCalled bool
	controller.SetUpgradeRequest(func(ctx context.Context, installID string) {
		upgradeCalled = true
	})

	if controller.onRollbackRequest != nil {
		controller.onRollbackRequest(context.Background(), "test")
	}
	assert.True(t, rollbackCalled)

	if controller.onUpgradeRequest != nil {
		controller.onUpgradeRequest(context.Background(), "test")
	}
	assert.True(t, upgradeCalled)

	// Test Start with empty clusters
	err := controller.Start(context.Background())
	assert.NoError(t, err)

	// Test Stop
	controller.Stop()
}

func TestLifecycleController_Events(t *testing.T) {
	controller := &LifecycleController{}

	// Ensure these don't panic
	controller.OnDrift(DriftEvent{ClusterID: "c1", AddonInstallID: "i1"})
	controller.OnUpgradeAvailable(UpgradeAvailableEvent{ClusterID: "c1", AddonInstallID: "i1"})
}
