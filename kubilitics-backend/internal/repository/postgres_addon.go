package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// SeedCatalog seeds the addon catalog with entries, dependencies, conflicts, CRDs, RBAC rules, costs, and versions
func (r *PostgresRepository) SeedCatalog(
	ctx context.Context,
	entries []models.AddOnEntry,
	deps []models.AddOnDependency,
	conflicts []models.AddOnConflict,
	crds []models.AddOnCRDOwnership,
	rbac []models.AddOnRBACRule,
	costs []models.AddOnCostModel,
	versions []models.VersionChangelog,
) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin seed catalog transaction: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_dependencies WHERE addon_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE') OR depends_on_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE')`); err != nil {
		return fmt.Errorf("delete core addon_dependencies: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_conflicts WHERE addon_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE') OR conflicts_with_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE')`); err != nil {
		return fmt.Errorf("delete core addon_conflicts: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_crds_owned WHERE addon_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE')`); err != nil {
		return fmt.Errorf("delete core addon_crds_owned: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_rbac_required WHERE addon_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE')`); err != nil {
		return fmt.Errorf("delete core addon_rbac_required: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_cost_model WHERE addon_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE')`); err != nil {
		return fmt.Errorf("delete core addon_cost_model: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_versions WHERE addon_id IN (SELECT id FROM addon_catalog WHERE tier = 'CORE')`); err != nil {
		return fmt.Errorf("delete core addon_versions: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM addon_catalog WHERE tier = 'CORE'`); err != nil {
		return fmt.Errorf("delete core addon_catalog: %w", err)
	}

	insertEntry := `
		INSERT INTO addon_catalog (
			id, name, display_name, description, tier, version, k8s_compat_min, k8s_compat_max,
			helm_repo_url, helm_chart, helm_chart_version, icon_url, tags, home_url, source_url,
			maintainer, is_deprecated, chart_digest, stars, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			name = $2, display_name = $3, description = $4, tier = $5, version = $6,
			k8s_compat_min = $7, k8s_compat_max = $8, helm_repo_url = $9, helm_chart = $10,
			helm_chart_version = $11, icon_url = $12, tags = $13, home_url = $14,
			source_url = $15, maintainer = $16, is_deprecated = $17, chart_digest = $18, stars = $19, updated_at = NOW()
	`
	for i := range entries {
		tagJSON, encodeErr := encodeStringSlice(entries[i].Tags)
		if encodeErr != nil {
			return fmt.Errorf("encode tags for addon %s: %w", entries[i].ID, encodeErr)
		}
		if _, err = tx.ExecContext(ctx, insertEntry,
			entries[i].ID,
			entries[i].Name,
			entries[i].DisplayName,
			entries[i].Description,
			entries[i].Tier,
			entries[i].Version,
			entries[i].K8sCompatMin,
			entries[i].K8sCompatMax,
			entries[i].HelmRepoURL,
			entries[i].HelmChart,
			entries[i].HelmChartVersion,
			entries[i].IconURL,
			tagJSON,
			entries[i].HomeURL,
			entries[i].SourceURL,
			entries[i].Maintainer,
			boolToInt(entries[i].IsDeprecated),
			entries[i].ChartDigest,
			entries[i].Stars,
		); err != nil {
			return fmt.Errorf("insert addon_catalog entry %s: %w", entries[i].ID, err)
		}
	}

	insertDependency := `
		INSERT INTO addon_dependencies (
			addon_id, depends_on_id, dependency_type, version_constraint, reason
		) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (addon_id, depends_on_id) DO UPDATE SET
			dependency_type = $3, version_constraint = $4, reason = $5
	`
	for i := range deps {
		if _, err = tx.ExecContext(ctx, insertDependency,
			deps[i].AddonID,
			deps[i].DependsOnID,
			deps[i].DependencyType,
			deps[i].VersionConstraint,
			deps[i].Reason,
		); err != nil {
			return fmt.Errorf("insert addon_dependency %s->%s: %w", deps[i].AddonID, deps[i].DependsOnID, err)
		}
	}

	insertConflict := `
		INSERT INTO addon_conflicts (
			addon_id, conflicts_with_id, reason
		) VALUES ($1, $2, $3)
		ON CONFLICT (addon_id, conflicts_with_id) DO UPDATE SET reason = $3
	`
	for i := range conflicts {
		if _, err = tx.ExecContext(ctx, insertConflict,
			conflicts[i].AddonID,
			conflicts[i].ConflictsWithID,
			conflicts[i].Reason,
		); err != nil {
			return fmt.Errorf("insert addon_conflict %s<->%s: %w", conflicts[i].AddonID, conflicts[i].ConflictsWithID, err)
		}
	}

	insertCRD := `
		INSERT INTO addon_crds_owned (
			addon_id, crd_group, crd_resource, crd_version
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (addon_id, crd_group, crd_resource, crd_version) DO NOTHING
	`
	for i := range crds {
		if _, err = tx.ExecContext(ctx, insertCRD,
			crds[i].AddonID,
			crds[i].CRDGroup,
			crds[i].CRDResource,
			crds[i].CRDVersion,
		); err != nil {
			return fmt.Errorf("insert addon_crd %s/%s: %w", crds[i].CRDGroup, crds[i].CRDResource, err)
		}
	}

	insertRBAC := `INSERT INTO addon_rbac_required (addon_id, api_groups, resources, verbs, scope) VALUES ($1, $2, $3, $4, $5)`
	for i := range rbac {
		apiGroupsJSON, encodeErr := encodeStringSlice(rbac[i].APIGroups)
		if encodeErr != nil {
			return fmt.Errorf("encode api_groups for addon %s: %w", rbac[i].AddonID, encodeErr)
		}
		resourcesJSON, encodeErr := encodeStringSlice(rbac[i].Resources)
		if encodeErr != nil {
			return fmt.Errorf("encode resources for addon %s: %w", rbac[i].AddonID, encodeErr)
		}
		verbsJSON, encodeErr := encodeStringSlice(rbac[i].Verbs)
		if encodeErr != nil {
			return fmt.Errorf("encode verbs for addon %s: %w", rbac[i].AddonID, encodeErr)
		}
		if _, err = tx.ExecContext(ctx, insertRBAC,
			rbac[i].AddonID,
			apiGroupsJSON,
			resourcesJSON,
			verbsJSON,
			rbac[i].Scope,
		); err != nil {
			return fmt.Errorf("insert addon_rbac_required for addon %s: %w", rbac[i].AddonID, err)
		}
	}

	insertCost := `
		INSERT INTO addon_cost_model (
			addon_id, cluster_tier, cpu_millicores, memory_mb, storage_gb, monthly_cost_usd_estimate, replica_count
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (addon_id, cluster_tier) DO UPDATE SET
			cpu_millicores = $3, memory_mb = $4, storage_gb = $5,
			monthly_cost_usd_estimate = $6, replica_count = $7
	`
	for i := range costs {
		if _, err = tx.ExecContext(ctx, insertCost,
			costs[i].AddonID,
			costs[i].ClusterTier,
			costs[i].CPUMillicores,
			costs[i].MemoryMB,
			costs[i].StorageGB,
			costs[i].MonthlyCostUSDEstimate,
			costs[i].ReplicaCount,
		); err != nil {
			return fmt.Errorf("insert addon_cost_model for addon %s tier %s: %w", costs[i].AddonID, costs[i].ClusterTier, err)
		}
	}

	insertVersion := `
		INSERT INTO addon_versions (
			addon_id, version, release_date, changelog_url, breaking_changes, highlights
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (addon_id, version) DO UPDATE SET
			release_date = $3, changelog_url = $4, breaking_changes = $5, highlights = $6
	`
	for i := range versions {
		breakingJSON, _ := json.Marshal(versions[i].BreakingChanges)
		highlightsJSON, _ := json.Marshal(versions[i].Highlights)
		if _, err = tx.ExecContext(ctx, insertVersion,
			versions[i].AddonID,
			versions[i].Version,
			versions[i].ReleaseDate,
			versions[i].ChangelogURL,
			string(breakingJSON),
			string(highlightsJSON),
		); err != nil {
			return fmt.Errorf("insert addon_version for addon %s version %s: %w", versions[i].AddonID, versions[i].Version, err)
		}
	}

	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit seed catalog transaction: %w", err)
	}
	return nil
}

// GetCatalogMeta retrieves a value from the addon_catalog_meta key-value store
func (r *PostgresRepository) GetCatalogMeta(ctx context.Context, key string) (string, error) {
	var value string
	err := r.db.GetContext(ctx, &value, `SELECT value FROM addon_catalog_meta WHERE key = $1`, key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetCatalogMeta upserts a value in the addon_catalog_meta key-value store
func (r *PostgresRepository) SetCatalogMeta(ctx context.Context, key, value string) error {
	query := `INSERT INTO addon_catalog_meta (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = $2`
	_, err := r.db.ExecContext(ctx, query, key, value)
	return err
}

// GetAddOn retrieves full addon details including dependencies, conflicts, CRDs, RBAC, and costs
func (r *PostgresRepository) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	const query = `
		SELECT
			c.id, c.name, c.display_name, c.description, c.tier, c.version, c.k8s_compat_min, c.k8s_compat_max,
			c.helm_repo_url, c.helm_chart, c.helm_chart_version, c.icon_url, c.tags, c.home_url, c.source_url,
			c.maintainer, c.is_deprecated, c.chart_digest, c.stars, c.created_at, c.updated_at,
			d.id AS dep_id, d.addon_id AS dep_addon_id, d.depends_on_id, d.dependency_type, d.version_constraint, d.reason AS dep_reason,
			f.id AS conflict_id, f.addon_id AS conflict_addon_id, f.conflicts_with_id, f.reason AS conflict_reason,
			o.id AS crd_id, o.addon_id AS crd_addon_id, o.crd_group, o.crd_resource, o.crd_version,
			r.id AS rbac_id, r.addon_id AS rbac_addon_id, r.api_groups, r.resources, r.verbs, r.scope,
			m.id AS cost_id, m.addon_id AS cost_addon_id, m.cluster_tier, m.cpu_millicores, m.memory_mb, m.storage_gb, m.monthly_cost_usd_estimate, m.replica_count
		FROM addon_catalog c
		LEFT JOIN addon_dependencies d ON d.addon_id = c.id
		LEFT JOIN addon_conflicts f ON f.addon_id = c.id
		LEFT JOIN addon_crds_owned o ON o.addon_id = c.id
		LEFT JOIN addon_rbac_required r ON r.addon_id = c.id
		LEFT JOIN addon_cost_model m ON m.addon_id = c.id
		WHERE c.id = $1
	`

	type row struct {
		ID               string         `db:"id"`
		Name             string         `db:"name"`
		DisplayName      string         `db:"display_name"`
		Description      sql.NullString `db:"description"`
		Tier             string         `db:"tier"`
		Version          string         `db:"version"`
		K8sCompatMin     string         `db:"k8s_compat_min"`
		K8sCompatMax     sql.NullString `db:"k8s_compat_max"`
		HelmRepoURL      string         `db:"helm_repo_url"`
		HelmChart        string         `db:"helm_chart"`
		HelmChartVersion string         `db:"helm_chart_version"`
		IconURL          sql.NullString `db:"icon_url"`
		Tags             sql.NullString `db:"tags"`
		HomeURL          sql.NullString `db:"home_url"`
		SourceURL        sql.NullString `db:"source_url"`
		Maintainer       sql.NullString `db:"maintainer"`
		IsDeprecated     int            `db:"is_deprecated"`
		CreatedAt        time.Time      `db:"created_at"`
		UpdatedAt        time.Time      `db:"updated_at"`

		DepID                sql.NullInt64  `db:"dep_id"`
		DepAddonID           sql.NullString `db:"dep_addon_id"`
		DependsOnID          sql.NullString `db:"depends_on_id"`
		DependencyType       sql.NullString `db:"dependency_type"`
		DepVersionConstraint sql.NullString `db:"version_constraint"`
		DepReason            sql.NullString `db:"dep_reason"`

		ConflictID      sql.NullInt64  `db:"conflict_id"`
		ConflictAddonID sql.NullString `db:"conflict_addon_id"`
		ConflictsWithID sql.NullString `db:"conflicts_with_id"`
		ConflictReason  sql.NullString `db:"conflict_reason"`

		CRDID       sql.NullInt64  `db:"crd_id"`
		CRDAddonID  sql.NullString `db:"crd_addon_id"`
		CRDGroup    sql.NullString `db:"crd_group"`
		CRDResource sql.NullString `db:"crd_resource"`
		CRDVersion  sql.NullString `db:"crd_version"`

		RBACID      sql.NullInt64  `db:"rbac_id"`
		RBACAddonID sql.NullString `db:"rbac_addon_id"`
		APIGroups   sql.NullString `db:"api_groups"`
		Resources   sql.NullString `db:"resources"`
		Verbs       sql.NullString `db:"verbs"`
		Scope       sql.NullString `db:"scope"`

		CostID                 sql.NullInt64   `db:"cost_id"`
		CostAddonID            sql.NullString  `db:"cost_addon_id"`
		ClusterTier            sql.NullString  `db:"cluster_tier"`
		CPUMillicores          sql.NullInt64   `db:"cpu_millicores"`
		MemoryMB               sql.NullInt64   `db:"memory_mb"`
		StorageGB              sql.NullInt64   `db:"storage_gb"`
		MonthlyCostUSDEstimate sql.NullFloat64 `db:"monthly_cost_usd_estimate"`
		ReplicaCount           sql.NullInt64   `db:"replica_count"`
		ChartDigest            sql.NullString  `db:"chart_digest"`
		Stars                  int             `db:"stars"`
	}

	var rows []row
	if err := r.db.SelectContext(ctx, &rows, query, id); err != nil {
		return nil, fmt.Errorf("query addon detail for %s: %w", id, err)
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("addon not found: %s", id)
	}

	tags, err := decodeStringSlice(rows[0].Tags.String)
	if err != nil {
		return nil, fmt.Errorf("decode tags for addon %s: %w", id, err)
	}
	detail := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{
			ID:               rows[0].ID,
			Name:             rows[0].Name,
			DisplayName:      rows[0].DisplayName,
			Description:      rows[0].Description.String,
			Tier:             rows[0].Tier,
			Version:          rows[0].Version,
			K8sCompatMin:     rows[0].K8sCompatMin,
			K8sCompatMax:     rows[0].K8sCompatMax.String,
			HelmRepoURL:      rows[0].HelmRepoURL,
			HelmChart:        rows[0].HelmChart,
			HelmChartVersion: rows[0].HelmChartVersion,
			IconURL:          rows[0].IconURL.String,
			Tags:             tags,
			HomeURL:          rows[0].HomeURL.String,
			SourceURL:        rows[0].SourceURL.String,
			Maintainer:       rows[0].Maintainer.String,
			IsDeprecated:     rows[0].IsDeprecated == 1,
			ChartDigest:      rows[0].ChartDigest.String,
			Stars:            rows[0].Stars,
			CreatedAt:        rows[0].CreatedAt,
			UpdatedAt:        rows[0].UpdatedAt,
		},
	}

	depSeen := make(map[int64]struct{})
	conflictSeen := make(map[int64]struct{})
	crdSeen := make(map[int64]struct{})
	rbacSeen := make(map[int64]struct{})
	costSeen := make(map[int64]struct{})

	for i := range rows {
		if rows[i].DepID.Valid {
			if _, ok := depSeen[rows[i].DepID.Int64]; !ok {
				depSeen[rows[i].DepID.Int64] = struct{}{}
				detail.Dependencies = append(detail.Dependencies, models.AddOnDependency{
					ID:                rows[i].DepID.Int64,
					AddonID:           rows[i].DepAddonID.String,
					DependsOnID:       rows[i].DependsOnID.String,
					DependencyType:    rows[i].DependencyType.String,
					VersionConstraint: rows[i].DepVersionConstraint.String,
					Reason:            rows[i].DepReason.String,
				})
			}
		}

		if rows[i].ConflictID.Valid {
			if _, ok := conflictSeen[rows[i].ConflictID.Int64]; !ok {
				conflictSeen[rows[i].ConflictID.Int64] = struct{}{}
				detail.Conflicts = append(detail.Conflicts, models.AddOnConflict{
					ID:              rows[i].ConflictID.Int64,
					AddonID:         rows[i].ConflictAddonID.String,
					ConflictsWithID: rows[i].ConflictsWithID.String,
					Reason:          rows[i].ConflictReason.String,
				})
			}
		}

		if rows[i].CRDID.Valid {
			if _, ok := crdSeen[rows[i].CRDID.Int64]; !ok {
				crdSeen[rows[i].CRDID.Int64] = struct{}{}
				detail.CRDsOwned = append(detail.CRDsOwned, models.AddOnCRDOwnership{
					ID:          rows[i].CRDID.Int64,
					AddonID:     rows[i].CRDAddonID.String,
					CRDGroup:    rows[i].CRDGroup.String,
					CRDResource: rows[i].CRDResource.String,
					CRDVersion:  rows[i].CRDVersion.String,
				})
			}
		}

		if rows[i].RBACID.Valid {
			if _, ok := rbacSeen[rows[i].RBACID.Int64]; !ok {
				rbacSeen[rows[i].RBACID.Int64] = struct{}{}
				apiGroups, decErr := decodeStringSlice(rows[i].APIGroups.String)
				if decErr != nil {
					return nil, fmt.Errorf("decode api_groups for addon %s: %w", id, decErr)
				}
				resources, decErr := decodeStringSlice(rows[i].Resources.String)
				if decErr != nil {
					return nil, fmt.Errorf("decode resources for addon %s: %w", id, decErr)
				}
				verbs, decErr := decodeStringSlice(rows[i].Verbs.String)
				if decErr != nil {
					return nil, fmt.Errorf("decode verbs for addon %s: %w", id, decErr)
				}
				detail.RBACRequired = append(detail.RBACRequired, models.AddOnRBACRule{
					ID:        rows[i].RBACID.Int64,
					AddonID:   rows[i].RBACAddonID.String,
					APIGroups: apiGroups,
					Resources: resources,
					Verbs:     verbs,
					Scope:     rows[i].Scope.String,
				})
			}
		}

		if rows[i].CostID.Valid {
			if _, ok := costSeen[rows[i].CostID.Int64]; !ok {
				costSeen[rows[i].CostID.Int64] = struct{}{}
				detail.CostModels = append(detail.CostModels, models.AddOnCostModel{
					ID:                     rows[i].CostID.Int64,
					AddonID:                rows[i].CostAddonID.String,
					ClusterTier:            rows[i].ClusterTier.String,
					CPUMillicores:          int(rows[i].CPUMillicores.Int64),
					MemoryMB:               int(rows[i].MemoryMB.Int64),
					StorageGB:              int(rows[i].StorageGB.Int64),
					MonthlyCostUSDEstimate: rows[i].MonthlyCostUSDEstimate.Float64,
					ReplicaCount:           int(rows[i].ReplicaCount.Int64),
				})
			}
		}
	}

	// Fetch version history separately to avoid Cartesian product explosion
	var versions []models.VersionChangelog
	vQuery := `SELECT version, release_date, changelog_url, breaking_changes, highlights FROM addon_versions WHERE addon_id = $1 ORDER BY release_date DESC`
	vRows, err := r.db.QueryxContext(ctx, vQuery, id)
	if err == nil {
		defer func() { _ = vRows.Close() }()
		for vRows.Next() {
			var v models.VersionChangelog
			var breakingJSON, highlightsJSON string
			if err := vRows.Scan(&v.Version, &v.ReleaseDate, &v.ChangelogURL, &breakingJSON, &highlightsJSON); err == nil {
				_ = json.Unmarshal([]byte(breakingJSON), &v.BreakingChanges)
				_ = json.Unmarshal([]byte(highlightsJSON), &v.Highlights)
				versions = append(versions, v)
			}
		}
		detail.Versions = versions
	}

	return detail, nil
}

// ListAddOns lists addons with optional filtering by tier, tags, and search
func (r *PostgresRepository) ListAddOns(ctx context.Context, tier string, tags []string, search string) ([]models.AddOnEntry, error) {
	baseQuery := `
		SELECT id, name, display_name, description, tier, version, k8s_compat_min, k8s_compat_max,
		       helm_repo_url, helm_chart, helm_chart_version, icon_url, tags, home_url, source_url,
		       maintainer, is_deprecated, chart_digest, stars, created_at, updated_at
		FROM addon_catalog
	`
	var whereParts []string
	var args []interface{}
	paramCount := 1

	if tier != "" {
		whereParts = append(whereParts, fmt.Sprintf("tier = $%d", paramCount))
		args = append(args, tier)
		paramCount++
	}
	for i := range tags {
		trimmed := strings.TrimSpace(tags[i])
		if trimmed == "" {
			continue
		}
		whereParts = append(whereParts, fmt.Sprintf("tags ILIKE $%d", paramCount))
		args = append(args, "%"+trimmed+"%")
		paramCount++
	}
	if search != "" {
		searchTerm := "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
		whereParts = append(whereParts, fmt.Sprintf("(LOWER(name) ILIKE $%d OR LOWER(display_name) ILIKE $%d OR LOWER(COALESCE(description, '')) ILIKE $%d)", paramCount, paramCount+1, paramCount+2))
		args = append(args, searchTerm, searchTerm, searchTerm)
	}

	query := baseQuery
	if len(whereParts) > 0 {
		query += " WHERE " + strings.Join(whereParts, " AND ")
	}
	query += " ORDER BY tier ASC, name ASC"

	var rows []struct {
		ID               string         `db:"id"`
		Name             string         `db:"name"`
		DisplayName      string         `db:"display_name"`
		Description      sql.NullString `db:"description"`
		Tier             string         `db:"tier"`
		Version          string         `db:"version"`
		K8sCompatMin     string         `db:"k8s_compat_min"`
		K8sCompatMax     sql.NullString `db:"k8s_compat_max"`
		HelmRepoURL      string         `db:"helm_repo_url"`
		HelmChart        string         `db:"helm_chart"`
		HelmChartVersion string         `db:"helm_chart_version"`
		IconURL          sql.NullString `db:"icon_url"`
		Tags             sql.NullString `db:"tags"`
		HomeURL          sql.NullString `db:"home_url"`
		SourceURL        sql.NullString `db:"source_url"`
		Maintainer       sql.NullString `db:"maintainer"`
		IsDeprecated     int            `db:"is_deprecated"`
		ChartDigest      sql.NullString `db:"chart_digest"`
		Stars            int            `db:"stars"`
		CreatedAt        time.Time      `db:"created_at"`
		UpdatedAt        time.Time      `db:"updated_at"`
	}
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, err
	}

	var entries []models.AddOnEntry
	for _, row := range rows {
		tags, _ := decodeStringSlice(row.Tags.String)
		entries = append(entries, models.AddOnEntry{
			ID:               row.ID,
			Name:             row.Name,
			DisplayName:      row.DisplayName,
			Description:      row.Description.String,
			Tier:             row.Tier,
			Version:          row.Version,
			K8sCompatMin:     row.K8sCompatMin,
			K8sCompatMax:     row.K8sCompatMax.String,
			HelmRepoURL:      row.HelmRepoURL,
			HelmChart:        row.HelmChart,
			HelmChartVersion: row.HelmChartVersion,
			IconURL:          row.IconURL.String,
			Tags:             tags,
			HomeURL:          row.HomeURL.String,
			SourceURL:        row.SourceURL.String,
			Maintainer:       row.Maintainer.String,
			IsDeprecated:     row.IsDeprecated == 1,
			ChartDigest:      row.ChartDigest.String,
			Stars:            row.Stars,
			CreatedAt:        row.CreatedAt,
			UpdatedAt:        row.UpdatedAt,
		})
	}

	return entries, nil
}

// CreateInstall creates a new addon install on a cluster
func (r *PostgresRepository) CreateInstall(ctx context.Context, install *models.AddOnInstall) error {
	if install.ID == "" {
		install.ID = uuid.New().String()
	}
	if strings.TrimSpace(install.ValuesJSON) == "" {
		install.ValuesJSON = "{}"
	}
	query := `
		INSERT INTO cluster_addon_installs (id, cluster_id, addon_id, release_name, namespace, helm_revision,
			installed_version, values_json, status, installed_by, idempotency_key, installed_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
	`
	_, err := r.db.ExecContext(ctx, query,
		install.ID, install.ClusterID, install.AddonID, install.ReleaseName, install.Namespace,
		install.HelmRevision, install.InstalledVersion, install.ValuesJSON,
		install.Status, install.InstalledBy, install.IdempotencyKey)
	return err
}

// FindInstallByIdempotencyKey returns an existing install for the given cluster and idempotency key
func (r *PostgresRepository) FindInstallByIdempotencyKey(ctx context.Context, clusterID, idempotencyKey string) (*models.AddOnInstallWithHealth, error) {
	query := `
		SELECT ai.id, ai.cluster_id, ai.addon_id, ai.release_name, ai.namespace, ai.status, ai.helm_revision,
			ai.installed_version, ai.values_json, ai.installed_by, ai.idempotency_key, ai.installed_at, ai.updated_at
		FROM cluster_addon_installs ai
		WHERE ai.cluster_id = $1 AND ai.idempotency_key = $2
	`
	var install models.AddOnInstallWithHealth
	err := r.db.GetContext(ctx, &install, query, clusterID, idempotencyKey)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &install, nil
}

// GetInstall retrieves an addon install by ID
func (r *PostgresRepository) GetInstall(ctx context.Context, id string) (*models.AddOnInstallWithHealth, error) {
	var install models.AddOnInstallWithHealth
	query := `
		SELECT ai.id, ai.cluster_id, ai.addon_id, ai.release_name, ai.namespace, ai.status, ai.helm_revision,
			ai.installed_version, ai.values_json, ai.installed_by, ai.idempotency_key, ai.installed_at, ai.updated_at
		FROM cluster_addon_installs ai
		WHERE ai.id = $1
	`
	err := r.db.GetContext(ctx, &install, query, id)
	return &install, err
}

// ListClusterInstalls lists all addon installs on a cluster
func (r *PostgresRepository) ListClusterInstalls(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error) {
	return r.listInstalls(ctx, "ai.cluster_id = $1", []interface{}{clusterID})
}

// UpdateInstallStatus updates the status and helm revision of an addon install
func (r *PostgresRepository) UpdateInstallStatus(ctx context.Context, id string, status models.AddOnStatus, helmRevision int) error {
	query := `UPDATE cluster_addon_installs SET status = $1, helm_revision = $2, updated_at = NOW() WHERE id = $3`
	_, err := r.db.ExecContext(ctx, query, status, helmRevision, id)
	return err
}

// UpdateInstallVersion updates the installed version of an addon
func (r *PostgresRepository) UpdateInstallVersion(ctx context.Context, id string, version string) error {
	query := `UPDATE cluster_addon_installs SET installed_version = $1, updated_at = NOW() WHERE id = $2`
	_, err := r.db.ExecContext(ctx, query, version, id)
	return err
}

// UpsertHealth creates or updates addon health information
func (r *PostgresRepository) UpsertHealth(ctx context.Context, health *models.AddOnHealth) error {
	if health.LastCheckedAt.IsZero() {
		health.LastCheckedAt = time.Now().UTC()
	}
	query := `
		INSERT INTO cluster_addon_health (addon_install_id, last_checked_at, health_status, ready_pods, total_pods, last_error)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (addon_install_id) DO UPDATE SET
			last_checked_at = EXCLUDED.last_checked_at,
			health_status = EXCLUDED.health_status,
			ready_pods = EXCLUDED.ready_pods,
			total_pods = EXCLUDED.total_pods,
			last_error = EXCLUDED.last_error
	`
	_, err := r.db.ExecContext(ctx, query, health.AddonInstallID, health.LastCheckedAt, health.HealthStatus, health.ReadyPods, health.TotalPods, health.LastError)
	return err
}

// CreateAuditEvent creates an addon audit event
func (r *PostgresRepository) CreateAuditEvent(ctx context.Context, event *models.AddOnAuditEvent) error {
	if event.ID == "" {
		event.ID = uuid.New().String()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	query := `
		INSERT INTO addon_audit_events (id, cluster_id, addon_install_id, addon_id, release_name, actor,
			operation, old_version, new_version, values_hash, result, error_message, duration_ms, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`
	_, err := r.db.ExecContext(ctx, query,
		event.ID, event.ClusterID, event.AddonInstallID, event.AddonID, event.ReleaseName,
		event.Actor, event.Operation, event.OldVersion, event.NewVersion, event.ValuesHash,
		event.Result, event.ErrorMessage, event.DurationMs, event.CreatedAt)
	return err
}

// ListAuditEvents lists addon audit events with filtering (matches SQLite filter model)
func (r *PostgresRepository) ListAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	query := `
		SELECT id, cluster_id, addon_install_id, addon_id, release_name, actor, operation, old_version,
		       new_version, values_hash, result, error_message, duration_ms, created_at
		FROM addon_audit_events
	`
	var where []string
	var args []interface{}
	paramCount := 1

	if filter.ClusterID != "" {
		where = append(where, fmt.Sprintf("cluster_id = $%d", paramCount))
		args = append(args, filter.ClusterID)
		paramCount++
	}
	if filter.AddonInstallID != "" {
		where = append(where, fmt.Sprintf("addon_install_id = $%d", paramCount))
		args = append(args, filter.AddonInstallID)
		paramCount++
	}
	if filter.AddonID != "" {
		where = append(where, fmt.Sprintf("addon_id = $%d", paramCount))
		args = append(args, filter.AddonID)
		paramCount++
	}
	if filter.Actor != "" {
		where = append(where, fmt.Sprintf("actor = $%d", paramCount))
		args = append(args, filter.Actor)
		paramCount++
	}
	if filter.Operation != "" {
		where = append(where, fmt.Sprintf("operation = $%d", paramCount))
		args = append(args, filter.Operation)
		paramCount++
	}
	if filter.Result != "" {
		where = append(where, fmt.Sprintf("result = $%d", paramCount))
		args = append(args, filter.Result)
		paramCount++
	}
	if filter.From != nil {
		where = append(where, fmt.Sprintf("created_at >= $%d", paramCount))
		args = append(args, *filter.From)
		paramCount++
	}
	if filter.To != nil {
		where = append(where, fmt.Sprintf("created_at <= $%d", paramCount))
		args = append(args, *filter.To)
		paramCount++
	}

	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}

	query += " ORDER BY created_at DESC"

	limit := filter.Limit
	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(" LIMIT $%d", paramCount)
	args = append(args, limit)
	paramCount++

	if filter.Offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", paramCount)
		args = append(args, filter.Offset)
	}

	var events []models.AddOnAuditEvent
	err := r.db.SelectContext(ctx, &events, query, args...)
	if err != nil {
		return nil, err
	}

	return events, nil
}

// GetUpgradePolicy retrieves the upgrade policy for an addon install
func (r *PostgresRepository) GetUpgradePolicy(ctx context.Context, installID string) (*models.AddOnUpgradePolicy, error) {
	var policy models.AddOnUpgradePolicy
	query := `SELECT addon_install_id, policy, pinned_version, last_check_at, next_available_version, auto_upgrade_enabled
		FROM addon_upgrade_policies WHERE addon_install_id = $1`
	err := r.db.GetContext(ctx, &policy, query, installID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &policy, err
}

// UpsertUpgradePolicy creates or updates an upgrade policy
func (r *PostgresRepository) UpsertUpgradePolicy(ctx context.Context, policy *models.AddOnUpgradePolicy) error {
	if policy == nil {
		return fmt.Errorf("policy is required")
	}
	query := `
		INSERT INTO addon_upgrade_policies (addon_install_id, policy, pinned_version, last_check_at, next_available_version, auto_upgrade_enabled)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (addon_install_id) DO UPDATE SET
			policy = EXCLUDED.policy,
			pinned_version = EXCLUDED.pinned_version,
			last_check_at = EXCLUDED.last_check_at,
			next_available_version = EXCLUDED.next_available_version,
			auto_upgrade_enabled = EXCLUDED.auto_upgrade_enabled
	`
	_, err := r.db.ExecContext(ctx, query,
		policy.AddonInstallID, policy.Policy, policy.PinnedVersion,
		policy.LastCheckAt, policy.NextAvailableVersion, policy.AutoUpgradeEnabled)
	return err
}

// DeleteInstall deletes an addon install
func (r *PostgresRepository) DeleteInstall(ctx context.Context, id string) error {
	query := `DELETE FROM cluster_addon_installs WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// listInstalls is a helper to list installs with dynamic WHERE clause
func (r *PostgresRepository) listInstalls(ctx context.Context, where string, args []interface{}) ([]models.AddOnInstallWithHealth, error) {
	query := fmt.Sprintf(`
		SELECT ai.id, ai.cluster_id, ai.addon_id, ai.release_name, ai.namespace, ai.status, ai.helm_revision,
			ai.installed_version, ai.values_json, ai.installed_by, ai.idempotency_key, ai.installed_at, ai.updated_at
		FROM cluster_addon_installs ai
		WHERE %s
		ORDER BY ai.installed_at DESC
	`, where)

	var installs []models.AddOnInstallWithHealth
	err := r.db.SelectContext(ctx, &installs, query, args...)
	if err != nil {
		return nil, err
	}

	return installs, nil
}

// Profile methods - cluster bootstrap profiles

// ListProfiles lists all cluster bootstrap profiles
func (r *PostgresRepository) ListProfiles(ctx context.Context) ([]models.ClusterProfile, error) {
	var profiles []models.ClusterProfile
	query := `SELECT id, name, description, addons, created_at, updated_at FROM cluster_profiles ORDER BY name ASC`
	rows, err := r.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var p models.ClusterProfile
		var addonsJSON string
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &addonsJSON, &p.CreatedAt, &p.UpdatedAt); err == nil {
			_ = json.Unmarshal([]byte(addonsJSON), &p.Addons)
			profiles = append(profiles, p)
		}
	}
	return profiles, nil
}

// GetProfile gets a cluster profile by ID
func (r *PostgresRepository) GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error) {
	var p models.ClusterProfile
	var addonsJSON string
	query := `SELECT id, name, description, addons, created_at, updated_at FROM cluster_profiles WHERE id = $1`
	err := r.db.QueryRowxContext(ctx, query, id).Scan(&p.ID, &p.Name, &p.Description, &addonsJSON, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(addonsJSON), &p.Addons)
	return &p, nil
}

// CreateProfile creates a new cluster profile
func (r *PostgresRepository) CreateProfile(ctx context.Context, profile *models.ClusterProfile) error {
	if profile.ID == "" {
		profile.ID = uuid.New().String()
	}
	addonsJSON, _ := json.Marshal(profile.Addons)
	query := `INSERT INTO cluster_profiles (id, name, description, addons, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())`
	_, err := r.db.ExecContext(ctx, query, profile.ID, profile.Name, profile.Description, addonsJSON)
	return err
}

// SeedBuiltinProfiles inserts the three built-in profiles on startup
func (r *PostgresRepository) SeedBuiltinProfiles(ctx context.Context) error {
	query := `INSERT INTO cluster_profiles (id, name, description, addons, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING`
	profiles := []struct {
		id    string
		name  string
		desc  string
		addos string
	}{
		{"minimal", "Minimal", "Minimal cluster profile", "[]"},
		{"standard", "Standard", "Standard cluster profile", "[]"},
		{"enterprise", "Enterprise", "Enterprise cluster profile", "[]"},
	}
	for _, p := range profiles {
		if _, err := r.db.ExecContext(ctx, query, p.id, p.name, p.desc, p.addos); err != nil {
			return err
		}
	}
	return nil
}

// Rollout methods - multi-cluster addon fleet upgrades

// CreateRollout creates a new addon rollout
func (r *PostgresRepository) CreateRollout(ctx context.Context, rollout *models.AddonRollout) error {
	if rollout.ID == "" {
		rollout.ID = uuid.New().String()
	}
	query := `INSERT INTO addon_rollouts (id, addon_id, target_version, strategy, canary_percent, status, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`
	_, err := r.db.ExecContext(ctx, query, rollout.ID, rollout.AddonID, rollout.TargetVersion, rollout.Strategy, rollout.CanaryPercent, rollout.Status, rollout.CreatedBy)
	return err
}

// GetRollout retrieves a rollout by ID
func (r *PostgresRepository) GetRollout(ctx context.Context, id string) (*models.AddonRollout, error) {
	var rollout models.AddonRollout
	query := `SELECT id, addon_id, target_version, strategy, canary_percent, status, created_by, created_at, updated_at FROM addon_rollouts WHERE id = $1`
	err := r.db.GetContext(ctx, &rollout, query, id)
	return &rollout, err
}

// ListRollouts lists rollouts for an addon
func (r *PostgresRepository) ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error) {
	var rollouts []models.AddonRollout
	query := `SELECT id, addon_id, target_version, strategy, canary_percent, status, created_by, created_at, updated_at FROM addon_rollouts WHERE addon_id = $1 ORDER BY created_at DESC`
	err := r.db.SelectContext(ctx, &rollouts, query, addonID)
	return rollouts, err
}

// UpdateRolloutStatus updates a rollout status
func (r *PostgresRepository) UpdateRolloutStatus(ctx context.Context, id string, status models.RolloutStatus) error {
	query := `UPDATE addon_rollouts SET status = $1, updated_at = NOW() WHERE id = $2`
	_, err := r.db.ExecContext(ctx, query, status, id)
	return err
}

// UpsertRolloutClusterStatus creates or updates rollout status for a cluster
func (r *PostgresRepository) UpsertRolloutClusterStatus(ctx context.Context, cs *models.RolloutClusterStatus) error {
	query := `INSERT INTO addon_rollout_cluster_status (rollout_id, cluster_id, status, error_message, started_at, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (rollout_id, cluster_id) DO UPDATE SET
			status = $3, error_message = $4, started_at = $5, completed_at = $6`
	_, err := r.db.ExecContext(ctx, query, cs.RolloutID, cs.ClusterID, cs.Status, cs.ErrorMessage, cs.StartedAt, cs.CompletedAt)
	return err
}

// Notification channel methods

// CreateNotificationChannel creates a notification channel
func (r *PostgresRepository) CreateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	if ch.ID == "" {
		ch.ID = uuid.New().String()
	}
	eventsJSON, _ := json.Marshal(ch.Events)
	ch.EventsRaw = string(eventsJSON)
	enabledInt := 0
	if ch.Enabled {
		enabledInt = 1
	}
	query := `INSERT INTO addon_notification_channels (id, name, type, url, events, enabled, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`
	_, err := r.db.ExecContext(ctx, query, ch.ID, ch.Name, ch.Type, ch.URL, ch.EventsRaw, enabledInt)
	return err
}

// GetNotificationChannel retrieves a notification channel
func (r *PostgresRepository) GetNotificationChannel(ctx context.Context, id string) (*models.NotificationChannel, error) {
	var ch models.NotificationChannel
	query := `SELECT id, name, type, url, events, enabled, created_at, updated_at FROM addon_notification_channels WHERE id = $1`
	err := r.db.QueryRowxContext(ctx, query, id).Scan(&ch.ID, &ch.Name, &ch.Type, &ch.URL, &ch.EventsRaw, &ch.EnabledDB, &ch.CreatedAt, &ch.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(ch.EventsRaw), &ch.Events)
	ch.Enabled = ch.EnabledDB == 1
	return &ch, nil
}

// ListNotificationChannels lists all notification channels
func (r *PostgresRepository) ListNotificationChannels(ctx context.Context) ([]models.NotificationChannel, error) {
	var channels []models.NotificationChannel
	query := `SELECT id, name, type, url, events, enabled, created_at, updated_at FROM addon_notification_channels ORDER BY name ASC`
	rows, err := r.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var ch models.NotificationChannel
		if err := rows.Scan(&ch.ID, &ch.Name, &ch.Type, &ch.URL, &ch.EventsRaw, &ch.EnabledDB, &ch.CreatedAt, &ch.UpdatedAt); err == nil {
			_ = json.Unmarshal([]byte(ch.EventsRaw), &ch.Events)
			ch.Enabled = ch.EnabledDB == 1
			channels = append(channels, ch)
		}
	}
	return channels, nil
}

// UpdateNotificationChannel updates a notification channel
func (r *PostgresRepository) UpdateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	eventsJSON, _ := json.Marshal(ch.Events)
	enabledInt := 0
	if ch.Enabled {
		enabledInt = 1
	}
	query := `UPDATE addon_notification_channels SET name = $1, type = $2, url = $3, events = $4, enabled = $5, updated_at = NOW() WHERE id = $6`
	_, err := r.db.ExecContext(ctx, query, ch.Name, ch.Type, ch.URL, string(eventsJSON), enabledInt, ch.ID)
	return err
}

// DeleteNotificationChannel deletes a notification channel
func (r *PostgresRepository) DeleteNotificationChannel(ctx context.Context, id string) error {
	query := `DELETE FROM addon_notification_channels WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// Maintenance window methods

// CreateMaintenanceWindow creates a maintenance window
func (r *PostgresRepository) CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	if w.ID == "" {
		w.ID = uuid.New().String()
	}
	query := `INSERT INTO addon_maintenance_windows (id, cluster_id, name, day_of_week, start_hour, start_minute, timezone, duration_minutes, apply_to, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`
	_, err := r.db.ExecContext(ctx, query, w.ID, w.ClusterID, w.Name, w.DayOfWeek, w.StartHour, w.StartMinute, w.Timezone, w.DurationMinutes, w.ApplyTo)
	return err
}

// GetMaintenanceWindow retrieves a maintenance window
func (r *PostgresRepository) GetMaintenanceWindow(ctx context.Context, id string) (*models.AddonMaintenanceWindow, error) {
	var w models.AddonMaintenanceWindow
	query := `SELECT id, cluster_id, name, day_of_week, start_hour, start_minute, timezone, duration_minutes, apply_to, created_at FROM addon_maintenance_windows WHERE id = $1`
	err := r.db.GetContext(ctx, &w, query, id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &w, err
}

// ListMaintenanceWindows lists maintenance windows for a cluster
func (r *PostgresRepository) ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error) {
	var windows []models.AddonMaintenanceWindow
	query := `SELECT id, cluster_id, name, day_of_week, start_hour, start_minute, timezone, duration_minutes, apply_to, created_at FROM addon_maintenance_windows WHERE cluster_id = $1 ORDER BY day_of_week ASC`
	err := r.db.SelectContext(ctx, &windows, query, clusterID)
	return windows, err
}

// UpdateMaintenanceWindow updates a maintenance window
func (r *PostgresRepository) UpdateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	query := `UPDATE addon_maintenance_windows SET name = $1, day_of_week = $2, start_hour = $3, start_minute = $4, timezone = $5, duration_minutes = $6, apply_to = $7 WHERE id = $8`
	_, err := r.db.ExecContext(ctx, query, w.Name, w.DayOfWeek, w.StartHour, w.StartMinute, w.Timezone, w.DurationMinutes, w.ApplyTo, w.ID)
	return err
}

// DeleteMaintenanceWindow deletes a maintenance window
func (r *PostgresRepository) DeleteMaintenanceWindow(ctx context.Context, id string) error {
	query := `DELETE FROM addon_maintenance_windows WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// SetPolicyNextEligibleAt records the earliest time an auto-upgrade may run
// for the given install (used when an upgrade is deferred outside a maintenance window).
func (r *PostgresRepository) SetPolicyNextEligibleAt(ctx context.Context, installID string, t time.Time) error {
	query := `UPDATE addon_upgrade_policies SET next_eligible_at = $1 WHERE addon_install_id = $2`
	_, err := r.db.ExecContext(ctx, query, t.UTC(), installID)
	return err
}

// Private Catalog Source methods

// CreateCatalogSource persists a new private catalog source.
func (r *PostgresRepository) CreateCatalogSource(ctx context.Context, s *models.PrivateCatalogSource) error {
	query := `INSERT INTO private_catalog_sources (id, name, url, type, auth_type, sync_enabled, last_synced_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := r.db.ExecContext(ctx, query, s.ID, s.Name, s.URL, s.Type, s.AuthType, s.SyncEnabled, s.LastSyncedAt, s.CreatedAt)
	return err
}

// GetCatalogSource fetches a single private catalog source by ID.
func (r *PostgresRepository) GetCatalogSource(ctx context.Context, id string) (*models.PrivateCatalogSource, error) {
	var s models.PrivateCatalogSource
	query := `SELECT id, name, url, type, auth_type, sync_enabled, last_synced_at, created_at FROM private_catalog_sources WHERE id = $1`
	err := r.db.GetContext(ctx, &s, query, id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get catalog source %s: %w", id, err)
	}
	return &s, nil
}

// ListCatalogSources returns all private catalog sources.
func (r *PostgresRepository) ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error) {
	var sources []models.PrivateCatalogSource
	query := `SELECT id, name, url, type, auth_type, sync_enabled, last_synced_at, created_at FROM private_catalog_sources ORDER BY created_at`
	err := r.db.SelectContext(ctx, &sources, query)
	if err != nil {
		return nil, fmt.Errorf("list catalog sources: %w", err)
	}
	return sources, nil
}

// DeleteCatalogSource removes a private catalog source by ID.
func (r *PostgresRepository) DeleteCatalogSource(ctx context.Context, id string) error {
	query := `DELETE FROM private_catalog_sources WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}

// UpdateCatalogSourceSyncedAt records the time of the last successful sync.
func (r *PostgresRepository) UpdateCatalogSourceSyncedAt(ctx context.Context, id string, t time.Time) error {
	query := `UPDATE private_catalog_sources SET last_synced_at = $1 WHERE id = $2`
	_, err := r.db.ExecContext(ctx, query, t.UTC(), id)
	return err
}

// UpsertAddonEntries bulk-inserts or replaces catalog entries.
// Used by private source sync to add PRIVATE tier addons to the catalog.
func (r *PostgresRepository) UpsertAddonEntries(ctx context.Context, entries []models.AddOnEntry) error {
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

	query := `
		INSERT INTO addon_catalog
			(id, name, display_name, description, tier, version,
			 k8s_compat_min, k8s_compat_max, helm_repo_url, helm_chart,
			 helm_chart_version, icon_url, home_url, source_url, maintainer,
			 is_deprecated, chart_digest, stars, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name, display_name = EXCLUDED.display_name,
			description = EXCLUDED.description, tier = EXCLUDED.tier,
			version = EXCLUDED.version, k8s_compat_min = EXCLUDED.k8s_compat_min,
			k8s_compat_max = EXCLUDED.k8s_compat_max, helm_repo_url = EXCLUDED.helm_repo_url,
			helm_chart = EXCLUDED.helm_chart, helm_chart_version = EXCLUDED.helm_chart_version,
			icon_url = EXCLUDED.icon_url, home_url = EXCLUDED.home_url,
			source_url = EXCLUDED.source_url, maintainer = EXCLUDED.maintainer,
			is_deprecated = EXCLUDED.is_deprecated, chart_digest = EXCLUDED.chart_digest,
			stars = EXCLUDED.stars, updated_at = EXCLUDED.updated_at`

	for i := range entries {
		e := &entries[i]
		if _, err = tx.ExecContext(ctx, query,
			e.ID, e.Name, e.DisplayName, e.Description, e.Tier, e.Version,
			e.K8sCompatMin, e.K8sCompatMax, e.HelmRepoURL, e.HelmChart,
			e.HelmChartVersion, e.IconURL, e.HomeURL, e.SourceURL, e.Maintainer,
			boolToInt(e.IsDeprecated), e.ChartDigest, e.Stars, e.CreatedAt, e.UpdatedAt,
		); err != nil {
			return fmt.Errorf("upsert addon entry %s: %w", e.ID, err)
		}
	}
	return tx.Commit()
}
