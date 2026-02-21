package worldmodel

import (
	"context"
	"fmt"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// ResourceFetcher is the minimal interface the synchronizer needs from the backend proxy.
type ResourceFetcher interface {
	ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error)
}

// ChangeRecorder allows the synchronizer to notify the temporal store of changes.
type ChangeRecorder interface {
	RecordChange(updateType string, before, after *pb.Resource)
	AddSnapshotDirect(resources []*pb.Resource)
}

// SyncConfig holds synchronizer configuration.
type SyncConfig struct {
	// FullSyncInterval is how often to do a complete re-sync from backend.
	FullSyncInterval time.Duration
	// ResourceKinds is the list of K8s resource kinds to sync.
	ResourceKinds []string
	// Namespaces to sync; empty means all namespaces.
	Namespaces []string
}

// DefaultSyncConfig returns sensible defaults.
func DefaultSyncConfig() SyncConfig {
	return SyncConfig{
		FullSyncInterval: 5 * time.Minute,
		ResourceKinds: []string{
			"Pod", "Deployment", "ReplicaSet", "StatefulSet", "DaemonSet",
			"Job", "CronJob", "Service", "Endpoints", "Ingress",
			"ConfigMap", "Secret", "PersistentVolumeClaim", "PersistentVolume",
			"Node", "Namespace", "ServiceAccount",
			"HorizontalPodAutoscaler", "NetworkPolicy",
		},
	}
}

// Synchronizer keeps the WorldModel up to date with the cluster state.
type Synchronizer struct {
	mu sync.Mutex

	wm       *WorldModel
	fetcher  ResourceFetcher
	temporal ChangeRecorder
	cfg      SyncConfig

	stopCh chan struct{}
	doneCh chan struct{}

	// Stats
	lastFullSync   time.Time
	totalSyncs     int64
	totalResources int64
}

// NewSynchronizer creates a new WorldModel synchronizer.
func NewSynchronizer(wm *WorldModel, fetcher ResourceFetcher, cfg SyncConfig) *Synchronizer {
	return &Synchronizer{
		wm:      wm,
		fetcher: fetcher,
		cfg:     cfg,
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}
}

// WithTemporalStore attaches a temporal store to receive change notifications.
func (s *Synchronizer) WithTemporalStore(t ChangeRecorder) *Synchronizer {
	s.temporal = t
	return s
}

// Start performs an initial bootstrap sync and then runs periodic full syncs.
func (s *Synchronizer) Start(ctx context.Context) error {
	// Initial bootstrap
	if err := s.fullSync(ctx); err != nil {
		return fmt.Errorf("initial bootstrap: %w", err)
	}

	// Background periodic sync
	go func() {
		defer close(s.doneCh)
		ticker := time.NewTicker(s.cfg.FullSyncInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = s.fullSync(ctx)
			case <-s.stopCh:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	return nil
}

// Stop halts the synchronizer.
func (s *Synchronizer) Stop() {
	close(s.stopCh)
	<-s.doneCh
}

// ForceSync triggers an immediate full sync.
func (s *Synchronizer) ForceSync(ctx context.Context) error {
	return s.fullSync(ctx)
}

// ApplyUpdate applies an incremental update from a watch stream.
func (s *Synchronizer) ApplyUpdate(ctx context.Context, updateType string, resource *pb.Resource) error {
	update := &pb.StateUpdate{
		UpdateType: updateType,
		Resource:   resource,
	}

	// Get the existing resource (for before state in temporal)
	var before *pb.Resource
	if s.temporal != nil && (updateType == "MODIFIED" || updateType == "DELETED") {
		existing, err := s.wm.GetResource(ctx, resource.Kind, resource.Namespace, resource.Name)
		if err == nil {
			before = existing
		}
	}

	if err := s.wm.ApplyUpdate(ctx, update); err != nil {
		return err
	}

	// Notify temporal store
	if s.temporal != nil {
		var after *pb.Resource
		if updateType != "DELETED" {
			after = resource
		}
		s.temporal.RecordChange(updateType, before, after)
	}
	return nil
}

// GetStats returns synchronizer statistics.
func (s *Synchronizer) GetStats() map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]interface{}{
		"last_full_sync":    s.lastFullSync,
		"total_syncs":       s.totalSyncs,
		"total_resources":   s.totalResources,
		"world_model_stats": s.wm.GetStats(),
	}
}

// fullSync fetches all configured resource kinds and bootstraps the world model.
func (s *Synchronizer) fullSync(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var allResources []*pb.Resource

	namespaces := s.cfg.Namespaces
	if len(namespaces) == 0 {
		namespaces = []string{""} // empty string = all namespaces
	}

	for _, kind := range s.cfg.ResourceKinds {
		for _, ns := range namespaces {
			resources, err := s.fetcher.ListResources(ctx, kind, ns)
			if err != nil {
				// Non-fatal: log and continue with other kinds
				continue
			}
			allResources = append(allResources, resources...)
		}
	}

	// Bootstrap world model with fresh data
	if err := s.wm.Bootstrap(ctx, allResources); err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}

	// Notify temporal store with a full snapshot
	if s.temporal != nil {
		s.temporal.AddSnapshotDirect(allResources)
	}

	s.lastFullSync = time.Now()
	s.totalSyncs++
	s.totalResources = int64(len(allResources))
	return nil
}
