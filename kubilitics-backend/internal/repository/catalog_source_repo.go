package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// CreateCatalogSource persists a new private catalog source.
func (r *SQLiteRepository) CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error {
	const q = `
		INSERT INTO private_catalog_sources
			(id, name, url, type, auth_type, sync_enabled, last_synced_at, created_at)
		VALUES
			(:id, :name, :url, :type, :auth_type, :sync_enabled, :last_synced_at, :created_at)`
	if _, err := r.db.NamedExecContext(ctx, q, s); err != nil {
		return fmt.Errorf("create catalog source: %w", err)
	}
	return nil
}

// GetCatalogSource fetches a single private catalog source by ID.
func (r *SQLiteRepository) GetCatalogSource(ctx context.Context, id string) (*models.PrivateCatalogSource, error) {
	const q = `SELECT * FROM private_catalog_sources WHERE id = ?`
	var s models.PrivateCatalogSource
	if err := r.db.GetContext(ctx, &s, q, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get catalog source %s: %w", id, err)
	}
	return &s, nil
}

// ListCatalogSources returns all private catalog sources.
func (r *SQLiteRepository) ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error) {
	const q = `SELECT * FROM private_catalog_sources ORDER BY created_at`
	var sources []models.PrivateCatalogSource
	if err := r.db.SelectContext(ctx, &sources, q); err != nil {
		return nil, fmt.Errorf("list catalog sources: %w", err)
	}
	return sources, nil
}

// DeleteCatalogSource removes a private catalog source by ID.
func (r *SQLiteRepository) DeleteCatalogSource(ctx context.Context, id string) error {
	const q = `DELETE FROM private_catalog_sources WHERE id = ?`
	if _, err := r.db.ExecContext(ctx, q, id); err != nil {
		return fmt.Errorf("delete catalog source %s: %w", id, err)
	}
	return nil
}

// UpdateCatalogSourceSyncedAt records the time of the last successful sync.
func (r *SQLiteRepository) UpdateCatalogSourceSyncedAt(ctx context.Context, id string, t time.Time) error {
	const q = `UPDATE private_catalog_sources SET last_synced_at = ? WHERE id = ?`
	if _, err := r.db.ExecContext(ctx, q, t.UTC(), id); err != nil {
		return fmt.Errorf("update catalog source synced_at %s: %w", id, err)
	}
	return nil
}

// UpsertAddonEntries bulk-inserts or replaces catalog entries.
// Used by private source sync to add PRIVATE tier addons without touching CORE/COMMUNITY entries.
func (r *SQLiteRepository) UpsertAddonEntries(ctx context.Context, entries []models.AddOnEntry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin upsert entries tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	const q = `
		INSERT OR REPLACE INTO addon_catalog
			(id, name, display_name, description, tier, version,
			 k8s_compat_min, k8s_compat_max, helm_repo_url, helm_chart,
			 helm_chart_version, icon_url, home_url, source_url, maintainer,
			 is_deprecated, chart_digest, stars, created_at, updated_at)
		VALUES
			(:id, :name, :display_name, :description, :tier, :version,
			 :k8s_compat_min, :k8s_compat_max, :helm_repo_url, :helm_chart,
			 :helm_chart_version, :icon_url, :home_url, :source_url, :maintainer,
			 :is_deprecated, :chart_digest, :stars, :created_at, :updated_at)`

	for i := range entries {
		if _, err = tx.NamedExecContext(ctx, q, &entries[i]); err != nil {
			return fmt.Errorf("upsert addon entry %s: %w", entries[i].ID, err)
		}
	}
	return tx.Commit()
}
