package repository

import (
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// UpsertEvents stores K8s events in SQLite for persistence beyond K8s event TTL.
// Uses INSERT OR REPLACE so duplicate events (same UID) are updated.
func (r *SQLiteRepository) UpsertEvents(clusterID string, events []*models.Event) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := r.db.Beginx()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.Preparex(`
		INSERT OR REPLACE INTO events (id, cluster_id, type, reason, message, resource_kind, resource_name, namespace, first_timestamp, last_timestamp, count, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

	now := time.Now()
	for _, e := range events {
		if e.ID == "" {
			continue // Skip events without UID
		}
		ft := e.FirstTimestamp
		if ft.IsZero() {
			ft = now
		}
		lt := e.LastTimestamp
		if lt.IsZero() {
			lt = ft
		}
		_, err := stmt.Exec(e.ID, clusterID, e.Type, e.Reason, e.Message, e.ResourceKind, e.ResourceName, e.Namespace, ft, lt, e.Count, now)
		if err != nil {
			continue // Non-fatal: skip individual failures
		}
	}
	return tx.Commit()
}

// GetStoredEvents retrieves previously persisted events from SQLite.
// Used when K8s events have expired (>1 hour old) but we still have them cached.
func (r *SQLiteRepository) GetStoredEvents(clusterID, namespace, kind, name string, limit int) ([]*models.Event, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := r.db.Queryx(`
		SELECT id, type, reason, message, resource_kind, resource_name, namespace, first_timestamp, last_timestamp, count
		FROM events
		WHERE cluster_id = ? AND resource_kind = ? AND resource_name = ? AND namespace = ?
		ORDER BY last_timestamp DESC
		LIMIT ?
	`, clusterID, kind, name, namespace, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var events []*models.Event
	for rows.Next() {
		var e models.Event
		var ft, lt time.Time
		if err := rows.Scan(&e.ID, &e.Type, &e.Reason, &e.Message, &e.ResourceKind, &e.ResourceName, &e.Namespace, &ft, &lt, &e.Count); err != nil {
			continue
		}
		e.FirstTimestamp = ft
		e.LastTimestamp = lt
		e.Historical = true
		events = append(events, &e)
	}
	return events, nil
}

// CleanupOldEvents deletes events older than the given duration.
func (r *SQLiteRepository) CleanupOldEvents(maxAge time.Duration) (int64, error) {
	cutoff := time.Now().Add(-maxAge)
	result, err := r.db.Exec("DELETE FROM events WHERE last_timestamp < ?", cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
