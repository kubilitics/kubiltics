package resolver

import (
	"context"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

type fakeRepo struct {
	addons   map[string]*models.AddOnDetail
	installs []models.AddOnInstallWithHealth
}

func (f *fakeRepo) SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error {
	return nil
}
func (f *fakeRepo) GetCatalogMeta(ctx context.Context, key string) (string, error) { return "", nil }
func (f *fakeRepo) SetCatalogMeta(ctx context.Context, key, value string) error    { return nil }
func (f *fakeRepo) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	if a, ok := f.addons[id]; ok {
		return a, nil
	}
	return nil, nil // Return nil, nil for not found as per mapNotFoundError logic
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

func TestDependencyResolver_Resolve_Simple(t *testing.T) {
	ctx := context.Background()
	repo := &fakeRepo{
		addons: map[string]*models.AddOnDetail{
			"a": {AddOnEntry: models.AddOnEntry{ID: "a", Name: "A", Version: "1.0.0"}},
		},
	}
	res := NewDependencyResolver(repo, nil)

	plan, err := res.Resolve(ctx, "a", "cluster-1")
	assert.NoError(t, err)
	assert.NotNil(t, plan)
	assert.Len(t, plan.Steps, 1)
	assert.Equal(t, "a", plan.Steps[0].AddonID)
}

func TestDependencyResolver_Resolve_WithDeps(t *testing.T) {
	ctx := context.Background()
	repo := &fakeRepo{
		addons: map[string]*models.AddOnDetail{
			"a": {
				AddOnEntry: models.AddOnEntry{ID: "a", Name: "A", Version: "1.0.0"},
				Dependencies: []models.AddOnDependency{
					{DependsOnID: "b", DependencyType: "required"},
				},
			},
			"b": {AddOnEntry: models.AddOnEntry{ID: "b", Name: "B", Version: "2.0.0"}},
		},
	}
	res := NewDependencyResolver(repo, nil)

	plan, err := res.Resolve(ctx, "a", "cluster-1")
	assert.NoError(t, err)
	assert.NotNil(t, plan)
	assert.Len(t, plan.Steps, 2)
	// B should be first in topo sort
	assert.Equal(t, "b", plan.Steps[0].AddonID)
	assert.Equal(t, "a", plan.Steps[1].AddonID)
}

func TestDependencyResolver_Resolve_Cycle(t *testing.T) {
	ctx := context.Background()
	repo := &fakeRepo{
		addons: map[string]*models.AddOnDetail{
			"a": {
				AddOnEntry: models.AddOnEntry{ID: "a", Name: "A", Version: "1.0.0"},
				Dependencies: []models.AddOnDependency{
					{DependsOnID: "b", DependencyType: "required"},
				},
			},
			"b": {
				AddOnEntry: models.AddOnEntry{ID: "b", Name: "B", Version: "2.0.0"},
				Dependencies: []models.AddOnDependency{
					{DependsOnID: "a", DependencyType: "required"},
				},
			},
		},
	}
	res := NewDependencyResolver(repo, nil)

	plan, err := res.Resolve(ctx, "a", "cluster-1")
	assert.Error(t, err)
	assert.Nil(t, plan)
	var resErr *ResolutionError
	assert.ErrorAs(t, err, &resErr)
	assert.Equal(t, ErrCycle, resErr.Code)
}
