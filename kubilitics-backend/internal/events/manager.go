package events

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"k8s.io/client-go/kubernetes"
)

// PipelineHealth describes the health of a single per-cluster event pipeline.
type PipelineHealth struct {
	ClusterID      string `json:"cluster_id"`
	Status         string `json:"status"`            // healthy, degraded, down
	LastEventTime  int64  `json:"last_event_time"`   // unix ms, 0 if never
	EventsLast5Min int    `json:"events_last_5min"`
	Uptime         int64  `json:"uptime_seconds"`
	CollectorOK    bool   `json:"collector_ok"`
	InsightsOK     bool   `json:"insights_ok"`
	SnapshotsOK    bool   `json:"snapshots_ok"`
	DroppedEvents  int64  `json:"dropped_events"`
}

// SystemHealth describes the overall health of the Events Intelligence system.
type SystemHealth struct {
	Status      string           `json:"status"`       // healthy, degraded, down
	Pipelines   []PipelineHealth `json:"pipelines"`
	DBSizeMB    float64          `json:"db_size_mb"`
	TotalEvents int              `json:"total_events"`
	Uptime      int64            `json:"uptime_seconds"`
}

// PipelineManager maintains one Pipeline per cluster, replacing the old
// single-pipeline approach that only served the first connected cluster.
type PipelineManager struct {
	db               *sqlx.DB
	pipelines        map[string]*Pipeline
	mu               sync.RWMutex
	metrics          MetricsProvider
	notifier         AlertNotifier
	startedAt        time.Time
	sharedChainCache *ChainCache // lazily created, shared across all cluster pipelines
}

// NewPipelineManager creates a manager that lazily creates per-cluster pipelines
// sharing the same SQLite database. EnsureTables is called here as a
// belt-and-suspenders guard: the SQL migration (053_causal_chains.sql) is the
// canonical path, but this covers cases where the migration runner is skipped
// (e.g. in-process SQLite on first launch before migrations apply).
func NewPipelineManager(db *sqlx.DB) *PipelineManager {
	m := &PipelineManager{
		db:        db,
		pipelines: make(map[string]*Pipeline),
		startedAt: time.Now(),
	}
	if err := NewStore(db).EnsureTables(); err != nil {
		log.Printf("events: EnsureTables: %v", err)
	}
	return m
}

// SetMetricsProvider configures a MetricsProvider applied to every pipeline.
func (m *PipelineManager) SetMetricsProvider(mp MetricsProvider) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.metrics = mp
}

// SetAlertNotifier configures an AlertNotifier applied to every pipeline.
func (m *PipelineManager) SetAlertNotifier(n AlertNotifier) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notifier = n
}

// GetSharedChainCache returns the single ChainCache shared across all cluster
// pipelines. It is lazily initialised on first call using the shared Store.
func (m *PipelineManager) GetSharedChainCache() *ChainCache {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sharedChainCache == nil {
		m.sharedChainCache = NewChainCache(m.GetStore(), 5*time.Minute)
	}
	return m.sharedChainCache
}

// StartCluster starts a pipeline for a specific cluster. Idempotent — calling
// it again for an already-running cluster is a no-op.
func (m *PipelineManager) StartCluster(clientset kubernetes.Interface, clusterID string) error {
	if clientset == nil {
		return fmt.Errorf("cannot start pipeline: clientset is nil for cluster %s", clusterID)
	}

	// Validate the clientset can actually connect before starting informers
	_, err := clientset.Discovery().ServerVersion()
	if err != nil {
		return fmt.Errorf("cannot start pipeline: cluster %s unreachable: %w", clusterID, err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.pipelines[clusterID]; exists {
		return nil // already running
	}

	// Detect cluster size and auto-tune pipeline settings.
	tuning := DetectClusterSize(context.Background(), clientset)

	pipeline := NewPipeline(m.db)
	pipeline.ApplyTuning(tuning)
	if m.metrics != nil {
		pipeline.SetMetricsProvider(m.metrics)
	}
	if m.notifier != nil {
		pipeline.SetAlertNotifier(m.notifier)
	}
	// Inject the shared chain cache so all cluster pipelines populate the same
	// in-memory store (lazily created on first StartCluster call).
	if m.sharedChainCache == nil {
		m.sharedChainCache = NewChainCache(m.GetStore(), 5*time.Minute)
	}
	pipeline.SetChainCache(m.sharedChainCache)

	if err := pipeline.Start(clientset, clusterID); err != nil {
		return fmt.Errorf("start pipeline for cluster %s: %w", clusterID, err)
	}

	m.pipelines[clusterID] = pipeline
	log.Printf("[events/manager] started pipeline for cluster %s (%s, %d pods)", clusterID, tuning.Size, tuning.PodCount)
	return nil
}

// StartLogCollector starts a log collector on the pipeline for the given cluster.
// No-op if the cluster pipeline does not exist.
func (m *PipelineManager) StartLogCollector(logsService service.LogsService, clientset kubernetes.Interface, clusterID string) {
	m.mu.RLock()
	p, ok := m.pipelines[clusterID]
	m.mu.RUnlock()
	if ok {
		p.StartLogCollector(logsService, clientset, clusterID)
	}
}

// StopCluster stops the pipeline for a specific cluster.
func (m *PipelineManager) StopCluster(clusterID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.pipelines[clusterID]; ok {
		p.Stop()
		delete(m.pipelines, clusterID)
	}
}

// StopAll stops all running pipelines.
func (m *PipelineManager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, p := range m.pipelines {
		p.Stop()
		delete(m.pipelines, id)
	}
}

// GetStore returns a shared store instance (all pipelines write to the same DB).
func (m *PipelineManager) GetStore() *Store {
	return NewStore(m.db)
}

// Subscribe returns an SSE channel that merges events from ALL running pipelines.
// The merged channel is closed when all source pipeline channels are closed.
func (m *PipelineManager) Subscribe() <-chan *WideEvent {
	merged := make(chan *WideEvent, 128)
	m.mu.RLock()
	defer m.mu.RUnlock()

	var wg sync.WaitGroup
	for _, p := range m.pipelines {
		pCh := p.Subscribe()
		wg.Add(1)
		go func(src <-chan *WideEvent) {
			defer wg.Done()
			var dropped atomic.Int64
			for evt := range src {
				select {
				case merged <- evt:
				default:
					// Buffer full — increment counter and log a warning every 100 drops
					// so operators know they are losing events.
					n := dropped.Add(1)
					if n%100 == 0 {
						log.Printf("[events/manager] dropped %d events for subscriber (buffer full)", n)
					}
				}
			}
		}(pCh)
	}

	// Close merged channel when all sources are done.
	go func() {
		wg.Wait()
		close(merged)
	}()

	if len(m.pipelines) == 0 {
		log.Printf("[events/manager] Subscribe called with no running pipelines")
	}
	return merged
}

// Health returns a system-wide health snapshot covering all pipelines and the
// shared SQLite database. It is used by the /system/events-health endpoint.
func (m *PipelineManager) Health(ctx context.Context) *SystemHealth {
	m.mu.RLock()
	pipelines := make([]*Pipeline, 0, len(m.pipelines))
	for _, p := range m.pipelines {
		pipelines = append(pipelines, p)
	}
	m.mu.RUnlock()

	sh := &SystemHealth{
		Uptime: int64(time.Since(m.startedAt).Seconds()),
	}

	healthyCount := 0
	downCount := 0

	for _, p := range pipelines {
		ph := p.Health(ctx)
		sh.Pipelines = append(sh.Pipelines, *ph)
		switch ph.Status {
		case "healthy":
			healthyCount++
		case "down":
			downCount++
		}
	}

	// Total events from database.
	store := NewStore(m.db)
	if total, err := store.CountEvents(ctx); err == nil {
		sh.TotalEvents = int(total)
	}

	// Database file size.
	sh.DBSizeMB = m.dbSizeMB()

	// Overall status.
	total := len(sh.Pipelines)
	switch {
	case total == 0:
		sh.Status = "down"
	case downCount == total:
		sh.Status = "down"
	case healthyCount == total:
		sh.Status = "healthy"
	default:
		sh.Status = "degraded"
	}

	return sh
}

// dbSizeMB returns the SQLite database file size in megabytes.
func (m *PipelineManager) dbSizeMB() float64 {
	// Extract the DSN from the sqlx.DB — use the pragma database_list.
	var dbPath string
	row := m.db.QueryRow("PRAGMA database_list")
	var seq int
	var name string
	if err := row.Scan(&seq, &name, &dbPath); err != nil {
		return 0
	}
	info, err := os.Stat(dbPath)
	if err != nil {
		return 0
	}
	return float64(info.Size()) / (1024 * 1024)
}

// Unsubscribe is a no-op at the manager level; individual pipeline subscriptions
// are cleaned up when the pipeline stops. This satisfies the handler interface.
func (m *PipelineManager) Unsubscribe(_ <-chan *WideEvent) {
	// No-op — subscribers are drained when pipelines stop.
}

// ---------------------------------------------------------------------------
// ClusterLifecycleHook implementation (rest.ClusterLifecycleHook)
// ---------------------------------------------------------------------------

// OnClusterConnected starts a pipeline for the given cluster.
// Idempotent — if a pipeline is already running for the cluster it is a no-op.
func (m *PipelineManager) OnClusterConnected(clientset kubernetes.Interface, clusterID string) error {
	return m.StartCluster(clientset, clusterID)
}

// OnClusterDisconnected stops the pipeline for the given cluster and frees resources.
func (m *PipelineManager) OnClusterDisconnected(clusterID string) {
	m.StopCluster(clusterID)
}
