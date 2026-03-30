package repository

import (
	"context"
	"time"
)

// MetricsHistoryRow represents a single row in the metrics_history table.
type MetricsHistoryRow struct {
	ClusterID string  `db:"cluster_id"`
	Namespace string  `db:"namespace"`
	PodName   string  `db:"pod_name"`
	Timestamp int64   `db:"timestamp"`
	CPUMilli  float64 `db:"cpu_milli"`
	MemoryMiB float64 `db:"memory_mib"`
	NetworkRx int64   `db:"network_rx"`
	NetworkTx int64   `db:"network_tx"`
}

// InsertMetricsHistory bulk-inserts metrics history rows.
func (r *SQLiteRepository) InsertMetricsHistory(ctx context.Context, rows []MetricsHistoryRow) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO metrics_history (cluster_id, namespace, pod_name, timestamp, cpu_milli, memory_mib, network_rx, network_tx)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

	for _, row := range rows {
		if _, err := stmt.ExecContext(ctx, row.ClusterID, row.Namespace, row.PodName,
			row.Timestamp, row.CPUMilli, row.MemoryMiB, row.NetworkRx, row.NetworkTx); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// QueryMetricsHistory returns history for a specific pod within a time range.
func (r *SQLiteRepository) QueryMetricsHistory(ctx context.Context, clusterID, namespace, podName string, since, until time.Time) ([]MetricsHistoryRow, error) {
	var rows []MetricsHistoryRow
	err := r.db.SelectContext(ctx, &rows,
		`SELECT cluster_id, namespace, pod_name, timestamp, cpu_milli, memory_mib, network_rx, network_tx
		 FROM metrics_history
		 WHERE cluster_id = ? AND namespace = ? AND pod_name = ? AND timestamp >= ? AND timestamp <= ?
		 ORDER BY timestamp ASC`,
		clusterID, namespace, podName, since.Unix(), until.Unix())
	return rows, err
}

// QueryAggregatedMetricsHistory returns downsampled history (averaged over intervalSec windows).
// Used for longer time ranges (6h, 24h, 7d) to avoid returning thousands of rows.
func (r *SQLiteRepository) QueryAggregatedMetricsHistory(ctx context.Context, clusterID, namespace, podName string, since, until time.Time, intervalSec int) ([]MetricsHistoryRow, error) {
	var rows []MetricsHistoryRow
	err := r.db.SelectContext(ctx, &rows,
		`SELECT cluster_id, namespace, pod_name,
		        (timestamp / ? * ?) as timestamp,
		        AVG(cpu_milli) as cpu_milli,
		        AVG(memory_mib) as memory_mib,
		        MAX(network_rx) as network_rx,
		        MAX(network_tx) as network_tx
		 FROM metrics_history
		 WHERE cluster_id = ? AND namespace = ? AND pod_name = ? AND timestamp >= ? AND timestamp <= ?
		 GROUP BY cluster_id, namespace, pod_name, timestamp / ?
		 ORDER BY timestamp ASC`,
		intervalSec, intervalSec,
		clusterID, namespace, podName, since.Unix(), until.Unix(),
		intervalSec)
	return rows, err
}

// QueryControllerMetricsHistory returns aggregated history for all pods matching a prefix.
// Used for deployments, replicasets, etc.
func (r *SQLiteRepository) QueryControllerMetricsHistory(ctx context.Context, clusterID, namespace string, podNames []string, since, until time.Time, intervalSec int) ([]MetricsHistoryRow, error) {
	if len(podNames) == 0 {
		return nil, nil
	}

	// Build IN clause
	query := `SELECT '' as cluster_id, '' as namespace, '' as pod_name,
	                 (timestamp / ? * ?) as timestamp,
	                 SUM(cpu_milli) as cpu_milli,
	                 SUM(memory_mib) as memory_mib,
	                 SUM(network_rx) as network_rx,
	                 SUM(network_tx) as network_tx
	          FROM metrics_history
	          WHERE cluster_id = ? AND namespace = ? AND pod_name IN (` + placeholders(len(podNames)) + `)
	                AND timestamp >= ? AND timestamp <= ?
	          GROUP BY timestamp / ?
	          ORDER BY timestamp ASC`

	args := make([]interface{}, 0, 6+len(podNames))
	args = append(args, intervalSec, intervalSec, clusterID, namespace)
	for _, n := range podNames {
		args = append(args, n)
	}
	args = append(args, since.Unix(), until.Unix(), intervalSec)

	var rows []MetricsHistoryRow
	err := r.db.SelectContext(ctx, &rows, query, args...)
	return rows, err
}

// PurgeOldMetrics deletes rows older than the given duration.
func (r *SQLiteRepository) PurgeOldMetrics(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan).Unix()
	result, err := r.db.ExecContext(ctx, `DELETE FROM metrics_history WHERE timestamp < ?`, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// MetricsHistoryCount returns the total number of rows in the table.
func (r *SQLiteRepository) MetricsHistoryCount(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM metrics_history`)
	return count, err
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	s := "?"
	for i := 1; i < n; i++ {
		s += ",?"
	}
	return s
}
