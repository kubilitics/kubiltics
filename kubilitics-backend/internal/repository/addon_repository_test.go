package repository

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	dbmigrations "github.com/kubilitics/kubilitics-backend/migrations"
)

func setupAddOnRepo(t *testing.T) (*SQLiteRepository, context.Context) {
	t.Helper()
	ctx := context.Background()

	dbPath := filepath.Join(t.TempDir(), "addon_repo.db")
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("create sqlite repo: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })

	entries, err := dbmigrations.FS.ReadDir(".")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		sqlBytes, readErr := dbmigrations.FS.ReadFile(entry.Name())
		if readErr != nil {
			t.Fatalf("read migration %s: %v", entry.Name(), readErr)
		}
		if runErr := repo.RunMigrations(string(sqlBytes)); runErr != nil {
			t.Fatalf("run migration %s: %v", entry.Name(), runErr)
		}
	}

	cluster := &models.Cluster{
		ID:            "cluster-1",
		Name:          "cluster-1",
		Context:       "cluster-1",
		ServerURL:     "https://cluster-1.example",
		Status:        "connected",
		LastConnected: time.Now().UTC(),
	}
	if err := repo.Create(ctx, cluster); err != nil {
		t.Fatalf("create cluster: %v", err)
	}
	return repo, ctx
}

func TestAddOnRepositorySeedCatalogAndGetAddOn(t *testing.T) {
	repo, ctx := setupAddOnRepo(t)

	entry := models.AddOnEntry{
		ID:               "kubilitics/cert-manager",
		Name:             "cert-manager",
		DisplayName:      "Cert Manager",
		Description:      "Certificate controller",
		Tier:             string(models.TierCORE),
		Version:          "1.16.3",
		K8sCompatMin:     "1.24",
		HelmRepoURL:      "https://charts.jetstack.io",
		HelmChart:        "cert-manager",
		HelmChartVersion: "v1.16.3",
		Tags:             []string{"security", "certificates"},
	}
	baseEntry := models.AddOnEntry{
		ID:               "kubilitics/base",
		Name:             "base",
		DisplayName:      "Base",
		Tier:             string(models.TierCORE),
		Version:          "1.0.0",
		K8sCompatMin:     "1.24",
		HelmRepoURL:      "https://charts.kubilitics.io",
		HelmChart:        "base",
		HelmChartVersion: "1.0.0",
	}
	legacyEntry := models.AddOnEntry{
		ID:               "kubilitics/legacy-cert",
		Name:             "legacy-cert",
		DisplayName:      "Legacy Cert",
		Tier:             string(models.TierCORE),
		Version:          "0.9.0",
		K8sCompatMin:     "1.24",
		HelmRepoURL:      "https://charts.kubilitics.io",
		HelmChart:        "legacy-cert",
		HelmChartVersion: "0.9.0",
	}
	deps := []models.AddOnDependency{
		{AddonID: entry.ID, DependsOnID: "kubilitics/base", DependencyType: string(models.DependencyOptional), VersionConstraint: ">=1.0.0"},
	}
	conflicts := []models.AddOnConflict{
		{AddonID: entry.ID, ConflictsWithID: "kubilitics/legacy-cert", Reason: "CRD overlap"},
	}
	crds := []models.AddOnCRDOwnership{
		{AddonID: entry.ID, CRDGroup: "cert-manager.io", CRDResource: "certificates", CRDVersion: "v1"},
	}
	rbac := []models.AddOnRBACRule{
		{AddonID: entry.ID, APIGroups: []string{""}, Resources: []string{"secrets"}, Verbs: []string{"get", "list"}, Scope: string(models.ScopeNamespace)},
	}
	costs := []models.AddOnCostModel{
		{AddonID: entry.ID, ClusterTier: string(models.TierDev), CPUMillicores: 100, MemoryMB: 128, StorageGB: 0, MonthlyCostUSDEstimate: 2, ReplicaCount: 1},
	}

	if err := repo.SeedCatalog(ctx, []models.AddOnEntry{entry, baseEntry, legacyEntry}, deps, conflicts, crds, rbac, costs, nil); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	detail, err := repo.GetAddOn(ctx, entry.ID)
	if err != nil {
		t.Fatalf("get addon detail: %v", err)
	}

	if detail.ID != entry.ID {
		t.Fatalf("unexpected addon id: got %s want %s", detail.ID, entry.ID)
	}
	if len(detail.Dependencies) != 1 || len(detail.Conflicts) != 1 || len(detail.CRDsOwned) != 1 || len(detail.RBACRequired) != 1 || len(detail.CostModels) != 1 {
		t.Fatalf("unexpected relation counts: deps=%d conflicts=%d crds=%d rbac=%d costs=%d",
			len(detail.Dependencies), len(detail.Conflicts), len(detail.CRDsOwned), len(detail.RBACRequired), len(detail.CostModels))
	}
}

func TestAddOnRepositoryInstallLifecycleAndAudit(t *testing.T) {
	repo, ctx := setupAddOnRepo(t)

	entry := models.AddOnEntry{
		ID:               "kubilitics/opencost",
		Name:             "opencost",
		DisplayName:      "OpenCost",
		Tier:             string(models.TierCORE),
		Version:          "1.43.0",
		K8sCompatMin:     "1.24",
		HelmRepoURL:      "https://opencost.github.io/opencost-helm-chart",
		HelmChart:        "opencost",
		HelmChartVersion: "1.43.0",
	}
	if err := repo.SeedCatalog(ctx, []models.AddOnEntry{entry}, nil, nil, nil, nil, nil, nil); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	install := &models.AddOnInstall{
		ClusterID:        "cluster-1",
		AddonID:          entry.ID,
		ReleaseName:      "opencost",
		Namespace:        "opencost",
		HelmRevision:     1,
		InstalledVersion: "1.43.0",
		ValuesJSON:       "{}",
		Status:           string(models.StatusInstalling),
		InstalledBy:      "tester@kubilitics",
	}
	if err := repo.CreateInstall(ctx, install); err != nil {
		t.Fatalf("create install: %v", err)
	}

	if err := repo.UpdateInstallStatus(ctx, install.ID, models.StatusInstalled, 2); err != nil {
		t.Fatalf("update install status: %v", err)
	}
	if err := repo.UpdateInstallVersion(ctx, install.ID, "1.43.1"); err != nil {
		t.Fatalf("update install version: %v", err)
	}

	if err := repo.UpsertHealth(ctx, &models.AddOnHealth{
		AddonInstallID: install.ID,
		HealthStatus:   string(models.HealthHealthy),
		ReadyPods:      1,
		TotalPods:      1,
	}); err != nil {
		t.Fatalf("upsert health: %v", err)
	}

	if err := repo.UpsertUpgradePolicy(ctx, &models.AddOnUpgradePolicy{
		AddonInstallID:       install.ID,
		Policy:               string(models.PolicyPatchOnly),
		NextAvailableVersion: "1.43.2",
		AutoUpgradeEnabled:   true,
	}); err != nil {
		t.Fatalf("upsert policy: %v", err)
	}

	if err := repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
		ClusterID:      "cluster-1",
		AddonInstallID: install.ID,
		AddonID:        entry.ID,
		ReleaseName:    "opencost",
		Actor:          "tester@kubilitics",
		Operation:      string(models.OpInstall),
		Result:         string(models.ResultSuccess),
	}); err != nil {
		t.Fatalf("create audit event: %v", err)
	}

	gotInstall, err := repo.GetInstall(ctx, install.ID)
	if err != nil {
		t.Fatalf("get install: %v", err)
	}
	if gotInstall.Health == nil || gotInstall.Policy == nil || gotInstall.CatalogEntry == nil {
		t.Fatalf("expected health, policy, and catalog entry to be populated")
	}

	events, err := repo.ListAuditEvents(ctx, models.AddOnAuditFilter{ClusterID: "cluster-1", AddonInstallID: install.ID, Limit: 10})
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 audit event, got %d", len(events))
	}
	if _, err := repo.db.ExecContext(ctx, `UPDATE addon_audit_events SET result = 'FAILURE' WHERE id = ?`, events[0].ID); err == nil {
		t.Fatalf("expected update on addon_audit_events to fail due to append-only trigger")
	}
	if _, err := repo.db.ExecContext(ctx, `DELETE FROM addon_audit_events WHERE id = ?`, events[0].ID); err == nil {
		t.Fatalf("expected delete on addon_audit_events to fail due to append-only trigger")
	}

	if err := repo.DeleteInstall(ctx, install.ID); err != nil {
		t.Fatalf("delete install: %v", err)
	}
}
