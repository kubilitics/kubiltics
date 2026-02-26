package service

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/addon/registry"
	"github.com/kubilitics/kubilitics-backend/internal/addon/resolver"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	dbmigrations "github.com/kubilitics/kubilitics-backend/migrations"
)

// ──────────────────────────────────────────────────────────────────────────────
// Test DB helper
// ──────────────────────────────────────────────────────────────────────────────

func setupServiceRepo(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "svc.db")
	repo, err := repository.NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteRepository: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })

	entries, err := dbmigrations.FS.ReadDir(".")
	if err != nil {
		t.Fatalf("read embedded migrations dir: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		sql, readErr := dbmigrations.FS.ReadFile(e.Name())
		if readErr != nil {
			t.Fatalf("read migration %s: %v", e.Name(), readErr)
		}
		if runErr := repo.RunMigrations(string(sql)); runErr != nil {
			t.Fatalf("run migration %s: %v", e.Name(), runErr)
		}
	}

	// Create a cluster record required for FK constraints on install rows.
	cluster := &models.Cluster{
		ID:            "cluster-1",
		Name:          "cluster-1",
		Context:       "cluster-1",
		ServerURL:     "https://cluster-1.example",
		Status:        "connected",
		LastConnected: time.Now().UTC(),
	}
	if err := repo.Create(context.Background(), cluster); err != nil {
		t.Fatalf("create cluster: %v", err)
	}
	return repo
}

// seedCertManager adds a minimal cert-manager entry into the catalog.
func seedCertManager(t *testing.T, repo *repository.SQLiteRepository) models.AddOnEntry {
	t.Helper()
	ctx := context.Background()
	entry := models.AddOnEntry{
		ID:               "kubilitics/cert-manager",
		Name:             "cert-manager",
		DisplayName:      "Cert Manager",
		Description:      "Automates TLS certificate management.",
		Tier:             string(models.TierCORE),
		Version:          "1.16.3",
		K8sCompatMin:     "1.24",
		HelmRepoURL:      "https://charts.jetstack.io",
		HelmChart:        "cert-manager",
		HelmChartVersion: "v1.16.3",
		Tags:             []string{"security", "certificates"},
	}
	err := repo.SeedCatalog(ctx, []models.AddOnEntry{entry}, nil, nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("SeedCatalog: %v", err)
	}
	return entry
}

// ──────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ──────────────────────────────────────────────────────────────────────────────

// mockHelmClient records calls and returns configurable results.
type mockHelmClient struct {
	installResult *helm.InstallResult
	installErr    error
	upgradeResult *helm.UpgradeResult
	upgradeErr    error
	rollbackErr   error
	uninstallErr  error
	dryRunResult  *helm.DryRunResult
	dryRunErr     error
}

func (m *mockHelmClient) Install(_ context.Context, _ helm.InstallRequest) (*helm.InstallResult, error) {
	if m.installErr != nil {
		return nil, m.installErr
	}
	if m.installResult != nil {
		return m.installResult, nil
	}
	return &helm.InstallResult{ReleaseName: "cert-manager", Namespace: "cert-manager", Revision: 1, Status: "deployed"}, nil
}

func (m *mockHelmClient) Upgrade(_ context.Context, _ helm.UpgradeRequest) (*helm.UpgradeResult, error) {
	if m.upgradeErr != nil {
		return nil, m.upgradeErr
	}
	if m.upgradeResult != nil {
		return m.upgradeResult, nil
	}
	return &helm.UpgradeResult{ReleaseName: "cert-manager", Namespace: "cert-manager", Revision: 2, PreviousRevision: 1, Status: "deployed"}, nil
}

func (m *mockHelmClient) Rollback(_ context.Context, _ helm.RollbackRequest) error {
	return m.rollbackErr
}
func (m *mockHelmClient) Uninstall(_ context.Context, _ helm.UninstallRequest) error {
	return m.uninstallErr
}
func (m *mockHelmClient) Status(_ context.Context, _, _ string) (*helm.ReleaseStatus, error) {
	return &helm.ReleaseStatus{Status: "deployed", Revision: 1}, nil
}
func (m *mockHelmClient) History(_ context.Context, _, _ string) ([]models.HelmReleaseRevision, error) {
	return nil, nil
}
func (m *mockHelmClient) DryRun(_ context.Context, _ helm.InstallRequest) (*helm.DryRunResult, error) {
	if m.dryRunErr != nil {
		return nil, m.dryRunErr
	}
	if m.dryRunResult != nil {
		return m.dryRunResult, nil
	}
	return &helm.DryRunResult{Manifest: "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: cert-manager\n", ResourceCount: 1}, nil
}
func (m *mockHelmClient) Test(_ context.Context, _, _ string, _ time.Duration) (*helm.TestResult, error) {
	return &helm.TestResult{Passed: true}, nil
}
func (m *mockHelmClient) ListReleases(_ context.Context, _ string) ([]*models.HelmReleaseInfo, error) {
	return nil, nil
}

var _ helm.HelmClient = (*mockHelmClient)(nil)

// mockPreflightRunner returns a controlled report.
type mockPreflightRunner struct {
	report *models.PreflightReport
	err    error
}

func (m *mockPreflightRunner) RunPreflight(_ context.Context, _ string, _ models.InstallPlan) (*models.PreflightReport, error) {
	if m.err != nil {
		return nil, m.err
	}
	if m.report != nil {
		return m.report, nil
	}
	return &models.PreflightReport{OverallStatus: models.PreflightGO}, nil
}

var _ PreflightRunner = (*mockPreflightRunner)(nil)

// buildService assembles a complete AddOnServiceImpl from real repo + mocks.
func buildService(
	t *testing.T,
	repo *repository.SQLiteRepository,
	hc helm.HelmClient,
	pf PreflightRunner,
) *AddOnServiceImpl {
	t.Helper()
	reg := registry.NewRegistry(repo, slog.Default())
	res := resolver.NewDependencyResolver(repo, slog.Default())
	factory := func(_ string) (helm.HelmClient, error) { return hc, nil }
	if pf == nil {
		pf = &mockPreflightRunner{}
	}
	svc := NewAddOnServiceImpl(repo, reg, pf, res, factory, nil, nil, nil, slog.Default())
	return svc
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

// TestPlanInstall_CertManager verifies that planning cert-manager returns a plan
// whose primary step targets cert-manager.
func TestPlanInstall_CertManager(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)

	svc := buildService(t, repo, &mockHelmClient{}, nil)
	plan, err := svc.PlanInstall(context.Background(), "cluster-1", "kubilitics/cert-manager", "cert-manager")
	if err != nil {
		t.Fatalf("PlanInstall error: %v", err)
	}
	if plan == nil {
		t.Fatal("expected non-nil plan")
	}
	if plan.RequestedAddonID != "kubilitics/cert-manager" {
		t.Errorf("RequestedAddonID = %q, want %q", plan.RequestedAddonID, "kubilitics/cert-manager")
	}
	if len(plan.Steps) == 0 {
		t.Fatal("expected at least one install step")
	}
	found := false
	for _, s := range plan.Steps {
		if s.AddonID == "kubilitics/cert-manager" && s.Action == models.ActionInstall {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("plan steps do not include cert-manager ActionInstall: %+v", plan.Steps)
	}
}

// TestRunPreflight_SufficientRBAC verifies that a GO preflight result propagates through
// the service's RunPreflight wrapper without modification.
func TestRunPreflight_SufficientRBAC(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)

	goReport := &models.PreflightReport{
		OverallStatus: models.PreflightGO,
		Checks: []models.PreflightCheck{{
			Type:   models.CheckRBAC,
			Status: models.PreflightGO,
			Title:  "RBAC permissions sufficient",
		}},
	}
	svc := buildService(t, repo, &mockHelmClient{}, &mockPreflightRunner{report: goReport})
	plan, _ := svc.PlanInstall(context.Background(), "cluster-1", "kubilitics/cert-manager", "cert-manager")

	report, err := svc.RunPreflight(context.Background(), "cluster-1", plan)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if report.OverallStatus != models.PreflightGO {
		t.Errorf("OverallStatus = %v, want PreflightGO", report.OverallStatus)
	}
}

// TestRunPreflight_InsufficientRBAC_Returns_BLOCK verifies that a BLOCK preflight result
// propagates correctly and OverallStatus is PreflightBLOCK.
func TestRunPreflight_InsufficientRBAC_Returns_BLOCK(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)

	blockReport := &models.PreflightReport{
		OverallStatus: models.PreflightBLOCK,
		Blockers:      []string{"Missing RBAC: create/pods"},
		Checks: []models.PreflightCheck{{
			Type:   models.CheckRBAC,
			Status: models.PreflightBLOCK,
			Title:  "Missing RBAC permissions",
		}},
	}
	svc := buildService(t, repo, &mockHelmClient{}, &mockPreflightRunner{report: blockReport})
	plan, _ := svc.PlanInstall(context.Background(), "cluster-1", "kubilitics/cert-manager", "cert-manager")

	report, err := svc.RunPreflight(context.Background(), "cluster-1", plan)
	if err != nil {
		t.Fatalf("RunPreflight error: %v", err)
	}
	if report.OverallStatus != models.PreflightBLOCK {
		t.Errorf("OverallStatus = %v, want PreflightBLOCK", report.OverallStatus)
	}
}

// TestExecuteInstall_DryRunOnly_NoHelmRelease verifies DryRunInstall calls the helm DryRun
// method and returns a manifest without touching the install DB table.
func TestExecuteInstall_DryRunOnly_NoHelmRelease(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)

	expectedManifest := "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: cert-manager\n"
	hc := &mockHelmClient{dryRunResult: &helm.DryRunResult{
		Manifest:      expectedManifest,
		ResourceCount: 3,
	}}
	svc := buildService(t, repo, hc, nil)

	result, err := svc.DryRunInstall(context.Background(), "cluster-1", InstallRequest{
		AddonID:     "kubilitics/cert-manager",
		ReleaseName: "cert-manager",
		Namespace:   "cert-manager",
		Actor:       "test-user",
	})
	if err != nil {
		t.Fatalf("DryRunInstall error: %v", err)
	}
	if result.ResourceCount == 0 {
		t.Error("DryRunResult.ResourceCount should be > 0")
	}
	if result.Manifest == "" {
		t.Error("DryRunResult.Manifest should not be empty")
	}

	// Confirm no DB install record was created.
	installs, err := repo.ListClusterInstalls(context.Background(), "cluster-1")
	if err != nil {
		t.Fatalf("ListClusterInstalls: %v", err)
	}
	if len(installs) != 0 {
		t.Errorf("expected 0 install records after DryRun, got %d", len(installs))
	}
}

// TestExecuteInstall_Then_Upgrade verifies a successful install followed by an upgrade
// results in a revision bump in the DB.
func TestExecuteInstall_Then_Upgrade(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)
	ctx := context.Background()

	hc := &mockHelmClient{
		installResult: &helm.InstallResult{Revision: 1, Status: "deployed"},
		upgradeResult: &helm.UpgradeResult{Revision: 2, PreviousRevision: 1, Status: "deployed"},
	}
	svc := buildService(t, repo, hc, nil)

	install, err := svc.ExecuteInstall(ctx, "cluster-1", InstallRequest{
		AddonID:     "kubilitics/cert-manager",
		ReleaseName: "cert-manager",
		Namespace:   "cert-manager",
		Actor:       "alice",
	}, nil)
	if err != nil {
		t.Fatalf("ExecuteInstall error: %v", err)
	}
	if install == nil || install.ID == "" {
		t.Fatal("expected non-nil install with ID")
	}

	// Now upgrade
	err = svc.ExecuteUpgrade(ctx, "cluster-1", install.ID, UpgradeRequest{
		Version: "v1.17.0",
		Actor:   "alice",
	}, nil)
	if err != nil {
		t.Fatalf("ExecuteUpgrade error: %v", err)
	}

	// Verify DB shows updated revision and INSTALLED status.
	updated, err := repo.GetInstall(ctx, install.ID)
	if err != nil {
		t.Fatalf("GetInstall: %v", err)
	}
	if updated.HelmRevision != 2 {
		t.Errorf("HelmRevision = %d, want 2", updated.HelmRevision)
	}
	if updated.Status != string(models.StatusInstalled) {
		t.Errorf("Status = %q, want %q", updated.Status, models.StatusInstalled)
	}
}

// TestExecuteRollback_To_Previous_Revision installs then rolls back and verifies no error.
func TestExecuteRollback_To_Previous_Revision(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)
	ctx := context.Background()

	hc := &mockHelmClient{
		installResult: &helm.InstallResult{Revision: 1, Status: "deployed"},
	}
	svc := buildService(t, repo, hc, nil)

	install, err := svc.ExecuteInstall(ctx, "cluster-1", InstallRequest{
		AddonID:     "kubilitics/cert-manager",
		ReleaseName: "cert-manager",
		Namespace:   "cert-manager",
		Actor:       "alice",
	}, nil)
	if err != nil {
		t.Fatalf("ExecuteInstall error: %v", err)
	}

	if err := svc.ExecuteRollback(ctx, "cluster-1", install.ID, 1); err != nil {
		t.Fatalf("ExecuteRollback error: %v", err)
	}

	updated, err := repo.GetInstall(ctx, install.ID)
	if err != nil {
		t.Fatalf("GetInstall after rollback: %v", err)
	}
	if updated.Status != string(models.StatusInstalled) {
		t.Errorf("Status after rollback = %q, want INSTALLED", updated.Status)
	}
}

// TestExecuteUninstall_Removes_DB_Record installs then uninstalls and checks the record is gone.
func TestExecuteUninstall_Removes_DB_Record(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)
	ctx := context.Background()

	hc := &mockHelmClient{
		installResult: &helm.InstallResult{Revision: 1, Status: "deployed"},
	}
	svc := buildService(t, repo, hc, nil)

	install, err := svc.ExecuteInstall(ctx, "cluster-1", InstallRequest{
		AddonID:     "kubilitics/cert-manager",
		ReleaseName: "cert-manager",
		Namespace:   "cert-manager",
		Actor:       "alice",
	}, nil)
	if err != nil {
		t.Fatalf("ExecuteInstall error: %v", err)
	}

	if err := svc.ExecuteUninstall(ctx, "cluster-1", install.ID, false); err != nil {
		t.Fatalf("ExecuteUninstall error: %v", err)
	}

	// ExecuteUninstall calls repo.DeleteInstall, so the record should be absent.
	installs, err := repo.ListClusterInstalls(ctx, "cluster-1")
	if err != nil {
		t.Fatalf("ListClusterInstalls: %v", err)
	}
	for _, i := range installs {
		if i.ID == install.ID {
			t.Errorf("install record %s should have been deleted after uninstall, but still present with status %s", install.ID, i.Status)
		}
	}
}

// TestIdempotentInstall_SameKeyReturnsExistingInstall verifies that sending two install
// requests with the same idempotency key returns the same install_id without running
// a second Helm install.
func TestIdempotentInstall_SameKeyReturnsExistingInstall(t *testing.T) {
	repo := setupServiceRepo(t)
	seedCertManager(t, repo)
	ctx := context.Background()

	callCount := 0
	hc := &mockHelmClient{}
	// Override Install to track call count.
	customFactory := func(_ string) (helm.HelmClient, error) {
		return &countingHelmClient{inner: hc, counter: &callCount}, nil
	}
	reg := registry.NewRegistry(repo, slog.Default())
	res := resolver.NewDependencyResolver(repo, slog.Default())
	svc := NewAddOnServiceImpl(repo, reg, &mockPreflightRunner{}, res, customFactory, nil, nil, nil, slog.Default())

	req := InstallRequest{
		AddonID:        "kubilitics/cert-manager",
		ReleaseName:    "cert-manager",
		Namespace:      "cert-manager",
		Actor:          "alice",
		IdempotencyKey: "deploy-abc-123",
	}

	install1, err := svc.ExecuteInstall(ctx, "cluster-1", req, nil)
	if err != nil {
		t.Fatalf("first ExecuteInstall error: %v", err)
	}

	install2, err := svc.ExecuteInstall(ctx, "cluster-1", req, nil)
	if err != nil {
		t.Fatalf("second ExecuteInstall (idempotent) error: %v", err)
	}

	if install1.ID != install2.ID {
		t.Errorf("idempotent install returned different IDs: %q vs %q", install1.ID, install2.ID)
	}
	if callCount != 1 {
		t.Errorf("helm Install called %d times, want exactly 1 (idempotent retry must not re-install)", callCount)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: countingHelmClient wraps a HelmClient and increments a counter on Install.
// ──────────────────────────────────────────────────────────────────────────────

type countingHelmClient struct {
	inner   helm.HelmClient
	counter *int
}

func (c *countingHelmClient) Install(ctx context.Context, req helm.InstallRequest) (*helm.InstallResult, error) {
	*c.counter++
	return c.inner.Install(ctx, req)
}
func (c *countingHelmClient) Upgrade(ctx context.Context, req helm.UpgradeRequest) (*helm.UpgradeResult, error) {
	return c.inner.Upgrade(ctx, req)
}
func (c *countingHelmClient) Rollback(ctx context.Context, req helm.RollbackRequest) error {
	return c.inner.Rollback(ctx, req)
}
func (c *countingHelmClient) Uninstall(ctx context.Context, req helm.UninstallRequest) error {
	return c.inner.Uninstall(ctx, req)
}
func (c *countingHelmClient) Status(ctx context.Context, rn, ns string) (*helm.ReleaseStatus, error) {
	return c.inner.Status(ctx, rn, ns)
}
func (c *countingHelmClient) History(ctx context.Context, rn, ns string) ([]models.HelmReleaseRevision, error) {
	return c.inner.History(ctx, rn, ns)
}
func (c *countingHelmClient) DryRun(ctx context.Context, req helm.InstallRequest) (*helm.DryRunResult, error) {
	return c.inner.DryRun(ctx, req)
}
func (c *countingHelmClient) Test(ctx context.Context, rn, ns string, timeout time.Duration) (*helm.TestResult, error) {
	return c.inner.Test(ctx, rn, ns, timeout)
}
func (c *countingHelmClient) ListReleases(ctx context.Context, ns string) ([]*models.HelmReleaseInfo, error) {
	return c.inner.ListReleases(ctx, ns)
}

// Ensure countingHelmClient satisfies the interface.
var _ helm.HelmClient = (*countingHelmClient)(nil)
