package advisor

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

type fakeRepo struct {
	installs []models.AddOnInstallWithHealth
}

func (f *fakeRepo) SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error {
	return nil
}
func (f *fakeRepo) GetCatalogMeta(ctx context.Context, key string) (string, error) { return "", nil }
func (f *fakeRepo) SetCatalogMeta(ctx context.Context, key, value string) error    { return nil }
func (f *fakeRepo) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	return nil, nil
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

func TestAdvisor_GetRecommendations(t *testing.T) {
	ctx := context.Background()
	repo := &fakeRepo{}
	adv := NewAdvisor(repo, nil)

	// 1. Test Ingress recommendation
	clientset := fake.NewSimpleClientset(&networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "test-ing", Namespace: "default"},
	})
	client := k8s.NewClientForTest(clientset)

	recs, err := adv.GetRecommendations(ctx, "cluster-1", client)
	assert.NoError(t, err)

	foundIngress := false
	for _, r := range recs {
		if r.AddonID == "ingress-nginx" {
			foundIngress = true
		}
	}
	assert.True(t, foundIngress, "Should recommend ingress-nginx")

	// 2. Test Kyverno recommendation (always recommended if missing)
	foundKyverno := false
	for _, r := range recs {
		if r.AddonID == "kyverno" {
			foundKyverno = true
		}
	}
	assert.True(t, foundKyverno, "Should recommend kyverno")

	// 3. Test with Kyverno already installed
	repo.installs = []models.AddOnInstallWithHealth{
		{AddOnInstall: models.AddOnInstall{AddonID: "kyverno"}},
	}
	recs, _ = adv.GetRecommendations(ctx, "cluster-1", client)
	foundKyverno = false
	for _, r := range recs {
		if r.AddonID == "kyverno" {
			foundKyverno = true
		}
	}
	assert.False(t, foundKyverno, "Should NOT recommend kyverno if already installed")
}

func TestAdvisor_ObservabilityRecommendation(t *testing.T) {
	ctx := context.Background()
	repo := &fakeRepo{}
	adv := NewAdvisor(repo, nil)

	// Many pods should trigger observability recommendation
	clientset := fake.NewSimpleClientset()
	for i := 0; i < 20; i++ {
		_, _ = clientset.CoreV1().Pods("default").Create(ctx, &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "pod-" + strconv.Itoa(i), Namespace: "default"},
		}, metav1.CreateOptions{})
	}
	client := k8s.NewClientForTest(clientset)

	recs, err := adv.GetRecommendations(ctx, "cluster-1", client)
	assert.NoError(t, err)

	foundProm := false
	for _, r := range recs {
		if r.AddonID == "kube-prometheus-stack" {
			foundProm = true
		}
	}
	assert.True(t, foundProm, "Should recommend kube-prometheus-stack for many pods")
}
