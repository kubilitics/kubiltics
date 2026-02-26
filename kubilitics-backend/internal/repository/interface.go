package repository

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ClusterRepository defines cluster data access methods
type ClusterRepository interface {
	Create(ctx context.Context, cluster *models.Cluster) error
	Get(ctx context.Context, id string) (*models.Cluster, error)
	List(ctx context.Context) ([]*models.Cluster, error)
	Update(ctx context.Context, cluster *models.Cluster) error
	Delete(ctx context.Context, id string) error
}

// TopologyRepository defines topology data access methods
type TopologyRepository interface {
	SaveSnapshot(ctx context.Context, snapshot *models.TopologySnapshot) error
	GetSnapshot(ctx context.Context, id string) (*models.TopologySnapshot, error)
	ListSnapshots(ctx context.Context, clusterID string, limit int) ([]*models.TopologySnapshot, error)
	GetLatestSnapshot(ctx context.Context, clusterID, namespace string) (*models.TopologySnapshot, error)
	DeleteOldSnapshots(ctx context.Context, clusterID string, olderThan time.Time) error
}

// HistoryRepository defines resource history data access methods
type HistoryRepository interface {
	Create(ctx context.Context, history *models.ResourceHistory) error
	List(ctx context.Context, clusterID, resourceType, namespace, name string, limit int) ([]*models.ResourceHistory, error)
	GetDiff(ctx context.Context, id string) (string, error)
}

// ProjectRepository defines project data access methods for multi-cluster, multi-tenancy
type ProjectRepository interface {
	CreateProject(ctx context.Context, p *models.Project) error
	GetProject(ctx context.Context, id string) (*models.Project, error)
	ListProjects(ctx context.Context) ([]*models.ProjectListItem, error)
	UpdateProject(ctx context.Context, p *models.Project) error
	DeleteProject(ctx context.Context, id string) error
	AddClusterToProject(ctx context.Context, pc *models.ProjectCluster) error
	RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error
	ListProjectClusters(ctx context.Context, projectID string) ([]*models.ProjectCluster, error)
	AddNamespaceToProject(ctx context.Context, pn *models.ProjectNamespace) error
	RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error
	ListProjectNamespaces(ctx context.Context, projectID string) ([]*models.ProjectNamespace, error)
}

// AddOnRepository defines add-on catalog, installation, lifecycle, and audit data access.
type AddOnRepository interface {
	SeedCatalog(ctx context.Context, entries []models.AddOnEntry, deps []models.AddOnDependency, conflicts []models.AddOnConflict, crds []models.AddOnCRDOwnership, rbac []models.AddOnRBACRule, costs []models.AddOnCostModel, versions []models.VersionChangelog) error
	// GetCatalogMeta retrieves a value from the addon_catalog_meta key-value store (e.g., the catalog content hash).
	GetCatalogMeta(ctx context.Context, key string) (string, error)
	// SetCatalogMeta upserts a value in the addon_catalog_meta key-value store.
	SetCatalogMeta(ctx context.Context, key, value string) error
	GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error)
	ListAddOns(ctx context.Context, tier string, tags []string, search string) ([]models.AddOnEntry, error)
	CreateInstall(ctx context.Context, install *models.AddOnInstall) error
	// FindInstallByIdempotencyKey returns an existing install for the given cluster and idempotency key,
	// or nil, nil when no matching install exists. Used to deduplicate retried install requests.
	FindInstallByIdempotencyKey(ctx context.Context, clusterID, idempotencyKey string) (*models.AddOnInstallWithHealth, error)
	GetInstall(ctx context.Context, id string) (*models.AddOnInstallWithHealth, error)
	ListClusterInstalls(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error)
	UpdateInstallStatus(ctx context.Context, id string, status models.AddOnStatus, helmRevision int) error
	UpdateInstallVersion(ctx context.Context, id string, version string) error
	UpsertHealth(ctx context.Context, health *models.AddOnHealth) error
	CreateAuditEvent(ctx context.Context, event *models.AddOnAuditEvent) error
	ListAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error)
	GetUpgradePolicy(ctx context.Context, installID string) (*models.AddOnUpgradePolicy, error)
	UpsertUpgradePolicy(ctx context.Context, policy *models.AddOnUpgradePolicy) error
	DeleteInstall(ctx context.Context, id string) error

	// Profile methods — cluster bootstrap profiles.
	ListProfiles(ctx context.Context) ([]models.ClusterProfile, error)
	GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error)
	CreateProfile(ctx context.Context, profile *models.ClusterProfile) error
	// SeedBuiltinProfiles inserts the three built-in profiles on startup
	// using INSERT OR IGNORE so it is safe to call on every server start.
	SeedBuiltinProfiles(ctx context.Context) error

	// Rollout methods — multi-cluster addon fleet upgrades (T8.06).
	CreateRollout(ctx context.Context, rollout *models.AddonRollout) error
	GetRollout(ctx context.Context, id string) (*models.AddonRollout, error)
	ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error)
	UpdateRolloutStatus(ctx context.Context, id string, status models.RolloutStatus) error
	UpsertRolloutClusterStatus(ctx context.Context, cs *models.RolloutClusterStatus) error

	// Notification channel methods (T8.11).
	CreateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error
	GetNotificationChannel(ctx context.Context, id string) (*models.NotificationChannel, error)
	ListNotificationChannels(ctx context.Context) ([]models.NotificationChannel, error)
	UpdateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error
	DeleteNotificationChannel(ctx context.Context, id string) error

	// Maintenance window methods (T9.03).
	// Maintenance windows define recurring time ranges during which auto-upgrades are permitted.
	CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error
	GetMaintenanceWindow(ctx context.Context, id string) (*models.AddonMaintenanceWindow, error)
	ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error)
	DeleteMaintenanceWindow(ctx context.Context, id string) error
	// SetPolicyNextEligibleAt records the earliest time an auto-upgrade may run for an install
	// (set when the upgrade is deferred due to being outside a maintenance window).
	SetPolicyNextEligibleAt(ctx context.Context, installID string, t time.Time) error

	// Private catalog source methods (T9.04).
	// Sources are user-configured Helm or OCI registries that add PRIVATE tier addons to the catalog.
	CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error
	GetCatalogSource(ctx context.Context, id string) (*models.PrivateCatalogSource, error)
	ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error)
	DeleteCatalogSource(ctx context.Context, id string) error
	// UpdateCatalogSourceSyncedAt records the time of the last successful sync for a source.
	UpdateCatalogSourceSyncedAt(ctx context.Context, id string, t time.Time) error
	// UpsertAddonEntries performs bulk INSERT OR REPLACE for catalog entries (used by private source sync).
	UpsertAddonEntries(ctx context.Context, entries []models.AddOnEntry) error
}

// Repository aggregates all repositories
type Repository struct {
	Cluster  ClusterRepository
	Topology TopologyRepository
	History  HistoryRepository
	Project  ProjectRepository
	AddOn    AddOnRepository
}
