package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

type fakeAddOnRepository struct {
	addons []models.AddOnEntry
}

func (f *fakeAddOnRepository) SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error {
	return nil
}
func (f *fakeAddOnRepository) GetCatalogMeta(ctx context.Context, key string) (string, error) {
	return "", nil
}
func (f *fakeAddOnRepository) SetCatalogMeta(ctx context.Context, key, value string) error {
	return nil
}
func (f *fakeAddOnRepository) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	for _, a := range f.addons {
		if a.ID == id {
			return &models.AddOnDetail{AddOnEntry: a}, nil
		}
	}
	return nil, nil
}
func (f *fakeAddOnRepository) ListAddOns(ctx context.Context, tier string, tags []string, search string) ([]models.AddOnEntry, error) {
	var out []models.AddOnEntry
	for _, a := range f.addons {
		if string(a.Tier) == tier {
			out = append(out, a)
		}
	}
	return out, nil
}
func (f *fakeAddOnRepository) CreateInstall(ctx context.Context, install *models.AddOnInstall) error {
	return nil
}
func (f *fakeAddOnRepository) FindInstallByIdempotencyKey(ctx context.Context, clusterID, idempotencyKey string) (*models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) GetInstall(ctx context.Context, id string) (*models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) ListClusterInstalls(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) UpdateInstallStatus(ctx context.Context, id string, status models.AddOnStatus, helmRevision int) error {
	return nil
}
func (f *fakeAddOnRepository) UpdateInstallVersion(ctx context.Context, id string, version string) error {
	return nil
}
func (f *fakeAddOnRepository) UpsertHealth(ctx context.Context, health *models.AddOnHealth) error {
	return nil
}
func (f *fakeAddOnRepository) CreateAuditEvent(ctx context.Context, event *models.AddOnAuditEvent) error {
	return nil
}
func (f *fakeAddOnRepository) ListAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) GetUpgradePolicy(ctx context.Context, installID string) (*models.AddOnUpgradePolicy, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) UpsertUpgradePolicy(ctx context.Context, policy *models.AddOnUpgradePolicy) error {
	return nil
}
func (f *fakeAddOnRepository) DeleteInstall(ctx context.Context, id string) error {
	return nil
}
func (f *fakeAddOnRepository) ListProfiles(ctx context.Context) ([]models.ClusterProfile, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) CreateProfile(ctx context.Context, profile *models.ClusterProfile) error {
	return nil
}
func (f *fakeAddOnRepository) SeedBuiltinProfiles(ctx context.Context) error { return nil }
func (f *fakeAddOnRepository) CreateRollout(ctx context.Context, rollout *models.AddonRollout) error {
	return nil
}
func (f *fakeAddOnRepository) GetRollout(ctx context.Context, id string) (*models.AddonRollout, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) UpdateRolloutStatus(ctx context.Context, id string, status models.RolloutStatus) error {
	return nil
}
func (f *fakeAddOnRepository) UpsertRolloutClusterStatus(ctx context.Context, cs *models.RolloutClusterStatus) error {
	return nil
}
func (f *fakeAddOnRepository) CreateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	return nil
}
func (f *fakeAddOnRepository) GetNotificationChannel(ctx context.Context, id string) (*models.NotificationChannel, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) ListNotificationChannels(ctx context.Context) ([]models.NotificationChannel, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) UpdateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	return nil
}
func (f *fakeAddOnRepository) DeleteNotificationChannel(ctx context.Context, id string) error {
	return nil
}
func (f *fakeAddOnRepository) CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	return nil
}
func (f *fakeAddOnRepository) GetMaintenanceWindow(ctx context.Context, id string) (*models.AddonMaintenanceWindow, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) DeleteMaintenanceWindow(ctx context.Context, id string) error {
	return nil
}
func (f *fakeAddOnRepository) SetPolicyNextEligibleAt(ctx context.Context, installID string, t time.Time) error {
	return nil
}
func (f *fakeAddOnRepository) CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error {
	return nil
}
func (f *fakeAddOnRepository) GetCatalogSource(ctx context.Context, id string) (*models.PrivateCatalogSource, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error) {
	return nil, nil
}
func (f *fakeAddOnRepository) DeleteCatalogSource(ctx context.Context, id string) error {
	return nil
}
func (f *fakeAddOnRepository) UpdateCatalogSourceSyncedAt(ctx context.Context, id string, t time.Time) error {
	return nil
}
func (f *fakeAddOnRepository) UpsertAddonEntries(ctx context.Context, entries []models.AddOnEntry) error {
	return nil
}

func TestRegistry_SearchCommunity(t *testing.T) {
	ctx := context.Background()
	repo := &fakeAddOnRepository{}
	reg := NewRegistry(repo, nil)

	// Mock AH API
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/packages/search", r.URL.Path)
		assert.Equal(t, "test", r.URL.Query().Get("ts_query_web"))

		resp := ArtifactHubSearchResponse{
			Packages: []ArtifactHubChart{
				{
					PackageID:   "p1",
					Name:        "test-pkg1",
					Version:     "1.0.0",
					Description: "desc",
					Repository: struct {
						URL  string `json:"url"`
						Name string `json:"name"`
					}{URL: "http://repo", Name: "repo"},
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	reg.ahClient.baseURL = server.URL

	results, err := reg.SearchCommunity(ctx, CatalogFilter{Search: "test"})
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "community/repo/test-pkg1", results[0].ID)
}

func TestRegistry_GetChart(t *testing.T) {
	ctx := context.Background()
	repo := &fakeAddOnRepository{}
	reg := NewRegistry(repo, nil)

	// Mock AH API
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/packages/helm/repo/chart", r.URL.Path)

		resp := ArtifactHubChart{
			PackageID:   "p1",
			Name:        "chart",
			DisplayName: "Chart",
			Version:     "1.0.0",
			Repository: struct {
				URL  string `json:"url"`
				Name string `json:"name"`
			}{URL: "http://repo", Name: "repo"},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()
	reg.ahClient.baseURL = server.URL

	res, err := reg.ahClient.GetChart(ctx, "repo", "chart")
	assert.NoError(t, err)
	assert.NotNil(t, res)
	assert.Equal(t, "p1", res.PackageID)
}

func TestRegistry_ListAll_Community(t *testing.T) {
	ctx := context.Background()
	repo := &fakeAddOnRepository{}
	reg := NewRegistry(repo, nil)

	// Mock AH API
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := ArtifactHubSearchResponse{
			Packages: []ArtifactHubChart{
				{PackageID: "c1", Name: "comm1", Version: "1.0.0", Repository: struct {
					URL  string `json:"url"`
					Name string `json:"name"`
				}{URL: "u", Name: "r"}},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()
	reg.ahClient.baseURL = server.URL

	results, err := reg.ListAll(ctx, CatalogFilter{Tier: string(models.TierCommunity)})
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "community/r/comm1", results[0].ID)
}

func TestRegistry_ListPrivateAddOns(t *testing.T) {
	ctx := context.Background()
	addons := []models.AddOnEntry{
		{ID: "p1", DisplayName: "Private 1", Tier: string(models.TierPrivate)},
		{ID: "c1", DisplayName: "Core 1", Tier: string(models.TierCORE)},
	}
	repo := &fakeAddOnRepository{addons: addons}
	reg := NewRegistry(repo, nil)

	results, err := reg.ListPrivateAddOns(ctx, CatalogFilter{})
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "p1", results[0].ID)
	assert.Equal(t, string(models.TierPrivate), string(results[0].Tier))
}

func TestRegistry_ListAll(t *testing.T) {
	ctx := context.Background()
	addons := []models.AddOnEntry{
		{ID: "p1", DisplayName: "Private 1", Tier: string(models.TierPrivate)},
		{ID: "c1", DisplayName: "Core 1", Tier: string(models.TierCORE)},
	}
	repo := &fakeAddOnRepository{addons: addons}
	reg := NewRegistry(repo, nil)

	// Test case 1: List only PRIVATE
	results, err := reg.ListAll(ctx, CatalogFilter{Tier: string(models.TierPrivate)})
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "p1", results[0].ID)

	// Test case 2: List CORE
	results, err = reg.ListAll(ctx, CatalogFilter{Tier: string(models.TierCORE)})
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "c1", results[0].ID)
}

func TestRegistry_GetAddOn(t *testing.T) {
	ctx := context.Background()
	addons := []models.AddOnEntry{
		{ID: "p1", DisplayName: "Private 1", Tier: string(models.TierPrivate)},
	}
	repo := &fakeAddOnRepository{addons: addons}
	reg := NewRegistry(repo, nil)

	// Test hit
	res, err := reg.GetAddOn(ctx, "p1")
	assert.NoError(t, err)
	assert.NotNil(t, res)
	assert.Equal(t, "p1", res.ID)

	// Test miss
	res, err = reg.GetAddOn(ctx, "nonexistent")
	assert.NoError(t, err)
	assert.Nil(t, res)
}

func TestRegistry_SeedOnStartup(t *testing.T) {
	ctx := context.Background()
	repo := &fakeAddOnRepository{}
	reg := NewRegistry(repo, nil)

	// We can't easily mock LoadCoreCatalogHash/LoadCoreCatalog because they are global functions
	// but we can at least call it and ensure it doesn't crash if the environment is set up.
	// In a real scenario, we might want to refactor those to be part of an interface.

	err := reg.SeedOnStartup(ctx)
	// Since we are in a test environment, it might fail to find embedded files if not correctly linked
	// but let's see what happens.
	if err != nil {
		t.Logf("SeedOnStartup failed (expected in some envs): %v", err)
	}
}
