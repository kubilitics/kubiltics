package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// CreateMaintenanceWindow persists a new maintenance window record.
func (r *SQLiteRepository) CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	const q = `
		INSERT INTO addon_maintenance_windows
			(id, cluster_id, name, day_of_week, start_hour, start_minute, timezone, duration_minutes, apply_to, created_at)
		VALUES
			(:id, :cluster_id, :name, :day_of_week, :start_hour, :start_minute, :timezone, :duration_minutes, :apply_to, :created_at)`
	if _, err := r.db.NamedExecContext(ctx, q, w); err != nil {
		return fmt.Errorf("create maintenance window: %w", err)
	}
	return nil
}

// GetMaintenanceWindow fetches a single maintenance window by ID.
func (r *SQLiteRepository) GetMaintenanceWindow(ctx context.Context, id string) (*models.AddonMaintenanceWindow, error) {
	const q = `SELECT * FROM addon_maintenance_windows WHERE id = ?`
	var w models.AddonMaintenanceWindow
	if err := r.db.GetContext(ctx, &w, q, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get maintenance window %s: %w", id, err)
	}
	return &w, nil
}

// ListMaintenanceWindows returns all maintenance windows for a cluster.
func (r *SQLiteRepository) ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error) {
	const q = `SELECT * FROM addon_maintenance_windows WHERE cluster_id = ? ORDER BY created_at`
	var windows []models.AddonMaintenanceWindow
	if err := r.db.SelectContext(ctx, &windows, q, clusterID); err != nil {
		return nil, fmt.Errorf("list maintenance windows: %w", err)
	}
	return windows, nil
}

// DeleteMaintenanceWindow removes a maintenance window by ID.
func (r *SQLiteRepository) DeleteMaintenanceWindow(ctx context.Context, id string) error {
	const q = `DELETE FROM addon_maintenance_windows WHERE id = ?`
	if _, err := r.db.ExecContext(ctx, q, id); err != nil {
		return fmt.Errorf("delete maintenance window %s: %w", id, err)
	}
	return nil
}

// SetPolicyNextEligibleAt records the earliest time an auto-upgrade may run
// for the given install (used when an upgrade is deferred outside a maintenance window).
func (r *SQLiteRepository) SetPolicyNextEligibleAt(ctx context.Context, installID string, t time.Time) error {
	const q = `
		UPDATE addon_upgrade_policies
		SET next_eligible_at = ?
		WHERE addon_install_id = ?`
	if _, err := r.db.ExecContext(ctx, q, t.UTC(), installID); err != nil {
		return fmt.Errorf("set next_eligible_at for install %s: %w", installID, err)
	}
	return nil
}
