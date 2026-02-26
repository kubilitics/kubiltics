package service

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/addon/financial"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// InstallRequest is the payload for addon install (and dry-run).
type InstallRequest struct {
	AddonID         string
	ReleaseName     string
	Namespace       string
	Values          map[string]interface{}
	CreateNamespace bool
	DryRun          bool
	Actor           string
	// IdempotencyKey is an optional caller-supplied token (X-Idempotency-Key header).
	// When set, ExecuteInstall returns the existing install record if one with the same
	// (clusterID, idempotencyKey) already exists, preventing duplicate Helm installs on retry.
	IdempotencyKey string
}

// UpgradeRequest is the payload for addon upgrade.
type UpgradeRequest struct {
	Version     string
	Values      map[string]interface{}
	ReuseValues bool
	Actor       string
}

// InstallProgressEvent is emitted during install/upgrade for streaming.
type InstallProgressEvent struct {
	Step      string    `json:"step"`
	Message   string    `json:"message"`
	Status    string    `json:"status"` // pending, running, success, error, complete, failed
	Timestamp time.Time `json:"timestamp"`
	// InstallRunID is a UUID generated once per ExecuteInstall call.
	// It ties every progress event and every backend log line to the same logical install run,
	// making it easy to correlate UI events with structured log output.
	InstallRunID string `json:"install_run_id,omitempty"`
}

// AddOnService is the single entry point for all add-on operations.
// It orchestrates registry, scanner, resolver, helm, lifecycle, financial, and rbac.
type AddOnService interface {
	BrowseCatalog(ctx context.Context, tier, search string, tags []string, k8sVersion string) ([]models.AddOnEntry, error)
	// ListCatalog returns one page of packages from Artifact Hub with total count (no tier filtering).
	ListCatalog(ctx context.Context, search string, limit, offset int) ([]models.AddOnEntry, int, error)
	GetAddOn(ctx context.Context, addonID string) (*models.AddOnDetail, error)
	PlanInstall(ctx context.Context, clusterID, addonID, namespace string) (*models.InstallPlan, error)
	EstimateCost(ctx context.Context, clusterID string, plan *models.InstallPlan) (*financial.PlanCostEstimate, error)
	RunPreflight(ctx context.Context, clusterID string, plan *models.InstallPlan) (*models.PreflightReport, error)
	DryRunInstall(ctx context.Context, clusterID string, req InstallRequest) (*helm.DryRunResult, error)
	ExecuteInstall(ctx context.Context, clusterID string, req InstallRequest, progressCh chan<- InstallProgressEvent) (*models.AddOnInstall, error)
	ExecuteUpgrade(ctx context.Context, clusterID, installID string, req UpgradeRequest, progressCh chan<- InstallProgressEvent) error
	ExecuteRollback(ctx context.Context, clusterID, installID string, toRevision int) error
	ExecuteUninstall(ctx context.Context, clusterID, installID string, deleteCRDs bool) error
	ListClusterAddOns(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error)
	GetInstall(ctx context.Context, installID string) (*models.AddOnInstallWithHealth, error)
	GetReleaseHistory(ctx context.Context, clusterID, installID string) ([]models.HelmReleaseRevision, error)
	GetAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error)
	SetUpgradePolicy(ctx context.Context, installID string, policy models.AddOnUpgradePolicy) error
	GetFinancialStack(ctx context.Context, clusterID string) (*financial.FinancialStack, error)
	BuildFinancialStackPlan(ctx context.Context, clusterID string) (*models.InstallPlan, error)
	GenerateRBACManifest(ctx context.Context, clusterID, addonID, namespace string) (string, error)

	// Profile methods — cluster bootstrap profiles.
	ListProfiles(ctx context.Context) ([]models.ClusterProfile, error)
	GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error)
	CreateProfile(ctx context.Context, profile *models.ClusterProfile) error
	// ApplyProfile resolves each profile addon's dependency graph, deduplicates,
	// and installs all addons in topological order, emitting progress events.
	ApplyProfile(ctx context.Context, clusterID, profileID, actor string, progressCh chan<- InstallProgressEvent) error

	// Rollout methods — multi-cluster fleet-wide addon upgrades (T8.06).
	// CreateRollout creates a new rollout record and starts a background goroutine that
	// upgrades each target cluster sequentially (or canary-batched) and tracks per-cluster status.
	CreateRollout(ctx context.Context, addonID, targetVersion, strategy string, canaryPercent int, clusterIDs []string, actor string) (*models.AddonRollout, error)
	GetRollout(ctx context.Context, rolloutID string) (*models.AddonRollout, error)
	ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error)
	AbortRollout(ctx context.Context, rolloutID string) error

	// Rightsizing (T8.10)
	GetRecommendations(ctx context.Context, clusterID, installID string) (*financial.RightsizingRecommendation, error)

	// Advisor (T8.14)
	GetAdvisorRecommendations(ctx context.Context, clusterID string) ([]models.AdvisorRecommendation, error)

	// Helm test execution (T9.01)
	RunAddonTests(ctx context.Context, clusterID, installID string) (*helm.TestResult, error)

	// Maintenance window management (T9.03).
	// Maintenance windows control when auto-upgrades are allowed to run.
	CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error
	ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error)
	DeleteMaintenanceWindow(ctx context.Context, id string) error

	// Private registry management (T9.04)
	ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error)
	CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error
	DeleteCatalogSource(ctx context.Context, id string) error
}

// LifecycleRegistrar is used to register/deregister clusters with the lifecycle controller (LMC).
// Implemented by *lifecycle.LifecycleController to avoid import cycles.
type LifecycleRegistrar interface {
	RegisterCluster(clusterID string) error
	DeregisterCluster(clusterID string) error
}

// PreflightRunner runs preflight checks for an install plan. Implemented by *scanner.ClusterScanner.
type PreflightRunner interface {
	RunPreflight(ctx context.Context, clusterID string, plan models.InstallPlan) (*models.PreflightReport, error)
}
