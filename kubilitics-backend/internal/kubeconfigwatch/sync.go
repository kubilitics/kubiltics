package kubeconfigwatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/client-go/tools/clientcmd"
)

// ErrReadFailed is returned by Sync when any watched kubeconfig path could
// not be read or parsed. Callers should log and retry on the next tick; Sync
// is fail-safe and never mutates state when this error is returned.
var ErrReadFailed = errors.New("kubeconfigwatch: read failed")

// ErrSafetyCapTriggered is returned by Sync when the computed orphan set
// would exceed either the absolute or ratio safety cap. No mutations are
// applied; a loud warning is logged and an audit entry is written so an
// operator can decide whether to raise the cap or delete the orphans manually
// via the UI.
var ErrSafetyCapTriggered = errors.New("kubeconfigwatch: safety cap triggered")

// ClusterSyncService is the subset of *service.clusterService that Syncer
// depends on. Defined here so tests can pass a fake without importing the
// real service package and its transitive dependencies.
type ClusterSyncService interface {
	ListClusters(ctx context.Context) ([]*models.Cluster, error)
	RemoveCluster(ctx context.Context, id string) error
}

// AuditLogRepository is the subset of *repository.SQLiteRepository that
// Syncer depends on. Same rationale as ClusterSyncService.
type AuditLogRepository interface {
	CreateAuditLog(ctx context.Context, e *models.AuditLogEntry) error
}

// Syncer computes the diff between a set of kubeconfig file contexts and the
// persisted cluster registry, then removes orphans via ClusterSyncService.
// All destructive operations are gated by safety caps and recorded in the
// audit log.
type Syncer struct {
	svc         ClusterSyncService
	audit       AuditLogRepository
	paths       []string
	snapshotDir string
	cfg         *config.Config
	log         *slog.Logger
}

// NewSyncer constructs a Syncer with the given dependencies.
func NewSyncer(svc ClusterSyncService, audit AuditLogRepository, paths []string, snapshotDir string, cfg *config.Config) *Syncer {
	return &Syncer{
		svc:         svc,
		audit:       audit,
		paths:       paths,
		snapshotDir: snapshotDir,
		cfg:         cfg,
		log:         slog.Default(),
	}
}

// Sync runs one pass: read all kubeconfig paths, compute orphans, check
// safety cap, write snapshot, write audit entries, and call RemoveCluster
// for each orphan.
func (s *Syncer) Sync(ctx context.Context, trigger string) error {
	contextSet, err := s.readContexts()
	if err != nil {
		s.log.Warn("kubeconfig sync: read failed",
			"err", err, "paths", s.paths, "trigger", trigger)
		return fmt.Errorf("%w: %v", ErrReadFailed, err)
	}

	persisted, err := s.svc.ListClusters(ctx)
	if err != nil {
		s.log.Error("kubeconfig sync: list clusters failed", "err", err)
		return fmt.Errorf("list clusters: %w", err)
	}

	eligible, orphans := partition(persisted, contextSet)
	if len(orphans) == 0 {
		s.log.Debug("kubeconfig sync: nothing to do",
			"persisted", len(persisted),
			"eligible_kubeconfig_sourced", len(eligible),
			"kubeconfig_contexts", len(contextSet),
			"trigger", trigger)
		return nil
	}

	if s.capTriggered(len(orphans), len(eligible)) {
		s.logSafetyCap(ctx, orphans, eligible, trigger)
		return ErrSafetyCapTriggered
	}

	// Pre-destructive snapshot.
	snap := Snapshot{
		Timestamp:    time.Now().UTC(),
		Trigger:      trigger,
		WatchedPaths: s.paths,
		OrphanIDs:    idsOf(orphans),
		AllClusters:  redactAll(persisted),
	}
	if path, err := WriteSnapshot(s.snapshotDir, snap); err != nil {
		s.log.Warn("kubeconfig sync: snapshot write failed (continuing)",
			"err", err, "dir", s.snapshotDir)
	} else {
		_ = PruneSnapshots(s.snapshotDir, 10)
		s.log.Info("kubeconfig sync: snapshot written", "path", path)
	}

	for _, c := range orphans {
		s.writeAuditForRemoval(ctx, c, trigger)
		if err := s.svc.RemoveCluster(ctx, c.ID); err != nil {
			s.log.Error("kubeconfig sync: RemoveCluster failed",
				"cluster_id", c.ID, "context", c.Context, "err", err)
			continue
		}
		s.log.Info("kubeconfig sync: removed orphan cluster",
			"cluster_id", c.ID, "context", c.Context, "trigger", trigger)
	}

	return nil
}

func (s *Syncer) readContexts() (map[string]struct{}, error) {
	set := make(map[string]struct{})
	for _, p := range s.paths {
		cfg, err := clientcmd.LoadFromFile(p)
		if err != nil {
			return nil, fmt.Errorf("load %s: %w", p, err)
		}
		for name := range cfg.Contexts {
			set[name] = struct{}{}
		}
	}
	return set, nil
}

func partition(persisted []*models.Cluster, contextSet map[string]struct{}) (eligible []*models.Cluster, orphans []*models.Cluster) {
	for _, c := range persisted {
		if c.Source != "kubeconfig" {
			continue
		}
		eligible = append(eligible, c)
		if _, ok := contextSet[c.Context]; !ok {
			orphans = append(orphans, c)
		}
	}
	return eligible, orphans
}

func (s *Syncer) capTriggered(orphanCount, eligibleCount int) bool {
	if orphanCount >= s.cfg.KubeconfigSyncMaxAbsoluteRemovals {
		return true
	}
	if eligibleCount == 0 {
		return false
	}
	ratio := float64(orphanCount) / float64(eligibleCount)
	return ratio > s.cfg.KubeconfigSyncMaxRemovalRatio
}

func (s *Syncer) logSafetyCap(ctx context.Context, orphans, eligible []*models.Cluster, trigger string) {
	orphanContexts := contextsOf(orphans)
	ratio := 0.0
	if len(eligible) > 0 {
		ratio = float64(len(orphans)) / float64(len(eligible))
	}

	s.log.Warn("kubeconfig sync: safety cap triggered — aborting",
		"orphans_detected", len(orphans),
		"eligible_total", len(eligible),
		"removal_ratio", ratio,
		"cap_absolute", s.cfg.KubeconfigSyncMaxAbsoluteRemovals,
		"cap_ratio", s.cfg.KubeconfigSyncMaxRemovalRatio,
		"orphan_contexts", strings.Join(orphanContexts, ","),
		"trigger", trigger)

	details := map[string]string{
		"orphans_detected": fmt.Sprintf("%d", len(orphans)),
		"eligible_total":   fmt.Sprintf("%d", len(eligible)),
		"removal_ratio":    fmt.Sprintf("%.2f", ratio),
		"orphan_contexts":  strings.Join(orphanContexts, ","),
		"watched_paths":    strings.Join(s.paths, ","),
		"trigger":          trigger,
	}
	detailsJSON, _ := json.Marshal(details)

	entry := &models.AuditLogEntry{
		Action:    "cluster_sync_safety_cap_triggered",
		Username:  "kubeconfig-sync",
		RequestIP: "127.0.0.1",
		Timestamp: time.Now(),
		Details:   string(detailsJSON),
	}
	if err := s.audit.CreateAuditLog(ctx, entry); err != nil {
		s.log.Error("kubeconfig sync: failed to write safety cap audit", "err", err)
	}
}

func (s *Syncer) writeAuditForRemoval(ctx context.Context, c *models.Cluster, trigger string) {
	details := map[string]string{
		"reason":          "kubeconfig_context_missing",
		"trigger":         trigger,
		"watched_paths":   strings.Join(s.paths, ","),
		"kubeconfig_path": c.KubeconfigPath,
		"context":         c.Context,
	}
	detailsJSON, _ := json.Marshal(details)

	clusterID := c.ID
	resourceKind := "cluster"
	resourceName := c.Context

	entry := &models.AuditLogEntry{
		Action:       "cluster_auto_removed",
		ClusterID:    &clusterID,
		ResourceKind: &resourceKind,
		ResourceName: &resourceName,
		Username:     "kubeconfig-sync",
		RequestIP:    "127.0.0.1",
		Timestamp:    time.Now(),
		Details:      string(detailsJSON),
	}
	if err := s.audit.CreateAuditLog(ctx, entry); err != nil {
		s.log.Warn("kubeconfig sync: failed to write removal audit",
			"cluster_id", c.ID, "err", err)
	}
}

func idsOf(cs []*models.Cluster) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.ID
	}
	return out
}

func contextsOf(cs []*models.Cluster) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.Context
	}
	return out
}

func redactAll(cs []*models.Cluster) []RedactedCluster {
	out := make([]RedactedCluster, len(cs))
	for i, c := range cs {
		out[i] = RedactedCluster{
			ID:             c.ID,
			Name:           c.Name,
			Context:        c.Context,
			KubeconfigPath: c.KubeconfigPath,
			ServerURL:      c.ServerURL,
			Version:        c.Version,
			Provider:       c.Provider,
			Source:         c.Source,
			CreatedAt:      c.CreatedAt,
			UpdatedAt:      c.UpdatedAt,
		}
	}
	return out
}
