package fleet

import (
	"context"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// FleetRepository is the interface for persisting fleet health records.
// This is satisfied by the SQLite repository's InsertFleetHealth method.
type FleetRepository interface {
	InsertFleetHealth(ctx context.Context, record FleetHealthRecord) error
}

// FleetHealthRecord is the row stored in fleet_health_history.
type FleetHealthRecord struct {
	ClusterID      string  `json:"cluster_id"       db:"cluster_id"`
	HealthScore    float64 `json:"health_score"     db:"health_score"`
	SPOFCount      int     `json:"spof_count"       db:"spof_count"`
	CriticalCount  int     `json:"critical_count"   db:"critical_count"`
	PDBCoverage    float64 `json:"pdb_coverage"     db:"pdb_coverage"`
	HPACoverage    float64 `json:"hpa_coverage"     db:"hpa_coverage"`
	NetPolCoverage float64 `json:"netpol_coverage"  db:"netpol_coverage"`
	TotalWorkloads int     `json:"total_workloads"  db:"total_workloads"`
	TotalNodes     int     `json:"total_nodes"      db:"total_nodes"`
	RecordedAt     int64   `json:"recorded_at"      db:"recorded_at"` // unix ms
}

// SummaryJob runs a background loop that periodically aggregates metrics
// from all cluster graph engines and persists them to the fleet health
// history table.
type SummaryJob struct {
	engines  map[string]*graph.ClusterGraphEngine
	repo     FleetRepository
	interval time.Duration
	stopCh   chan struct{}
	log      *slog.Logger
}

// NewSummaryJob creates a new background summary job.
func NewSummaryJob(
	engines map[string]*graph.ClusterGraphEngine,
	repo FleetRepository,
	interval time.Duration,
) *SummaryJob {
	return &SummaryJob{
		engines:  engines,
		repo:     repo,
		interval: interval,
		stopCh:   make(chan struct{}),
		log:      slog.Default().With("component", "fleet-summary-job"),
	}
}

// Start begins the periodic aggregation loop. It runs until Stop() is called
// or the context is cancelled. The first tick fires immediately.
func (j *SummaryJob) Start(ctx context.Context) {
	go j.run(ctx)
}

// Stop signals the background loop to exit.
func (j *SummaryJob) Stop() {
	select {
	case <-j.stopCh:
		// already stopped
	default:
		close(j.stopCh)
	}
}

// run is the internal loop that executes on each tick.
func (j *SummaryJob) run(ctx context.Context) {
	j.log.Info("fleet summary job starting", "interval", j.interval)

	// Immediate first tick
	j.tick(ctx)

	ticker := time.NewTicker(j.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			j.log.Info("fleet summary job stopping: context cancelled")
			return
		case <-j.stopCh:
			j.log.Info("fleet summary job stopping: stop signal received")
			return
		case <-ticker.C:
			j.tick(ctx)
		}
	}
}

// tick aggregates metrics for all clusters and stores them.
func (j *SummaryJob) tick(ctx context.Context) {
	for clusterID, engine := range j.engines {
		snap := engine.Snapshot()
		if snap == nil || !snap.Status().Ready {
			j.log.Debug("skipping cluster (snapshot not ready)", "cluster", clusterID)
			continue
		}

		metrics := AggregateCluster(snap)
		record := FleetHealthRecord{
			ClusterID:      clusterID,
			HealthScore:    metrics.HealthScore,
			SPOFCount:      metrics.SPOFCount,
			CriticalCount:  metrics.CriticalCount,
			PDBCoverage:    metrics.PDBCoverage,
			HPACoverage:    metrics.HPACoverage,
			NetPolCoverage: metrics.NetPolCoverage,
			TotalWorkloads: metrics.TotalWorkloads,
			TotalNodes:     metrics.TotalNodes,
			RecordedAt:     time.Now().UnixMilli(),
		}

		if j.repo != nil {
			if err := j.repo.InsertFleetHealth(ctx, record); err != nil {
				j.log.Error("failed to insert fleet health record",
					"cluster", clusterID,
					"error", err,
				)
			}
		}
	}
	j.log.Debug("fleet summary tick complete", "clusters", len(j.engines))
}
