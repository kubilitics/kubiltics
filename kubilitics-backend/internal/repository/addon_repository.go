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

func (r *SQLiteRepository) SeedCatalog(
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
		INSERT OR REPLACE INTO addon_catalog (
			id, name, display_name, description, tier, version, k8s_compat_min, k8s_compat_max,
			helm_repo_url, helm_chart, helm_chart_version, icon_url, tags, home_url, source_url,
			maintainer, is_deprecated, chart_digest, stars, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`
	for i := range entries {
		tagJSON, encodeErr := encodeStringSlice(entries[i].Tags)
		if encodeErr != nil {
			return fmt.Errorf("encode tags for addon %s: %w", entries[i].ID, encodeErr)
		}
		stars := entries[i].Stars
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
			stars,
		); err != nil {
			return fmt.Errorf("insert addon_catalog entry %s: %w", entries[i].ID, err)
		}
	}

	insertDependency := `
		INSERT OR REPLACE INTO addon_dependencies (
			addon_id, depends_on_id, dependency_type, version_constraint, reason
		) VALUES (?, ?, ?, ?, ?)
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
		INSERT OR REPLACE INTO addon_conflicts (
			addon_id, conflicts_with_id, reason
		) VALUES (?, ?, ?)
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
		INSERT OR REPLACE INTO addon_crds_owned (
			addon_id, crd_group, crd_resource, crd_version
		) VALUES (?, ?, ?, ?)
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

	insertRBAC := `
		INSERT INTO addon_rbac_required (
			addon_id, api_groups, resources, verbs, scope
		) VALUES (?, ?, ?, ?, ?)
	`
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
		INSERT OR REPLACE INTO addon_cost_model (
			addon_id, cluster_tier, cpu_millicores, memory_mb, storage_gb, monthly_cost_usd_estimate, replica_count
		) VALUES (?, ?, ?, ?, ?, ?, ?)
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
		INSERT OR REPLACE INTO addon_versions (
			addon_id, version, release_date, changelog_url, breaking_changes, highlights
		) VALUES (?, ?, ?, ?, ?, ?)
	`
	for i := range versions {
		breakingJSON, _ := json.Marshal(versions[i].BreakingChanges)
		highlightsJSON, _ := json.Marshal(versions[i].Highlights)
		if _, err = tx.ExecContext(ctx, insertVersion,
			versions[i].AddonID, // Wait, I need to add AddonID to VersionChangelog or use context
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

func (r *SQLiteRepository) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
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
		WHERE c.id = ?
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
	vQuery := `SELECT version, release_date, changelog_url, breaking_changes, highlights FROM addon_versions WHERE addon_id = ? ORDER BY release_date DESC`
	vRows, err := r.db.QueryxContext(ctx, vQuery, id)
	if err == nil {
		defer vRows.Close()
		for vRows.Next() {
			var v models.VersionChangelog
			var breakingJSON, highlightsJSON string
			if err := vRows.Scan(&v.Version, &v.ReleaseDate, &v.ChangelogURL, &breakingJSON, &highlightsJSON); err == nil {
				json.Unmarshal([]byte(breakingJSON), &v.BreakingChanges)
				json.Unmarshal([]byte(highlightsJSON), &v.Highlights)
				versions = append(versions, v)
			}
		}
		detail.Versions = versions
	}

	return detail, nil
}

func (r *SQLiteRepository) ListAddOns(ctx context.Context, tier string, tags []string, search string) ([]models.AddOnEntry, error) {
	baseQuery := `
		SELECT id, name, display_name, description, tier, version, k8s_compat_min, k8s_compat_max,
		       helm_repo_url, helm_chart, helm_chart_version, icon_url, tags, home_url, source_url,
		       maintainer, is_deprecated, chart_digest, stars, created_at, updated_at
		FROM addon_catalog
	`
	var whereParts []string
	var args []interface{}

	if tier != "" {
		whereParts = append(whereParts, "tier = ?")
		args = append(args, tier)
	}
	for i := range tags {
		trimmed := strings.TrimSpace(tags[i])
		if trimmed == "" {
			continue
		}
		whereParts = append(whereParts, "tags LIKE ?")
		args = append(args, "%"+trimmed+"%")
	}
	if search != "" {
		searchTerm := "%" + strings.ToLower(strings.TrimSpace(search)) + "%"
		whereParts = append(whereParts, "(LOWER(name) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)")
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
		return nil, fmt.Errorf("list addon_catalog: %w", err)
	}

	result := make([]models.AddOnEntry, 0, len(rows))
	for i := range rows {
		decodedTags, decErr := decodeStringSlice(rows[i].Tags.String)
		if decErr != nil {
			return nil, fmt.Errorf("decode tags for addon %s: %w", rows[i].ID, decErr)
		}
		result = append(result, models.AddOnEntry{
			ID:               rows[i].ID,
			Name:             rows[i].Name,
			DisplayName:      rows[i].DisplayName,
			Description:      rows[i].Description.String,
			Tier:             rows[i].Tier,
			Version:          rows[i].Version,
			K8sCompatMin:     rows[i].K8sCompatMin,
			K8sCompatMax:     rows[i].K8sCompatMax.String,
			HelmRepoURL:      rows[i].HelmRepoURL,
			HelmChart:        rows[i].HelmChart,
			HelmChartVersion: rows[i].HelmChartVersion,
			IconURL:          rows[i].IconURL.String,
			Tags:             decodedTags,
			HomeURL:          rows[i].HomeURL.String,
			SourceURL:        rows[i].SourceURL.String,
			Maintainer:       rows[i].Maintainer.String,
			IsDeprecated:     rows[i].IsDeprecated == 1,
			ChartDigest:      rows[i].ChartDigest.String,
			Stars:            rows[i].Stars,
			CreatedAt:        rows[i].CreatedAt,
			UpdatedAt:        rows[i].UpdatedAt,
		})
	}

	return result, nil
}

func (r *SQLiteRepository) CreateInstall(ctx context.Context, install *models.AddOnInstall) error {
	if install == nil {
		return fmt.Errorf("install is required")
	}
	if install.ID == "" {
		install.ID = uuid.NewString()
	}
	if strings.TrimSpace(install.ValuesJSON) == "" {
		install.ValuesJSON = "{}"
	}

	query := `
		INSERT INTO cluster_addon_installs (
			id, cluster_id, addon_id, release_name, namespace, helm_revision, installed_version,
			values_json, status, installed_by, idempotency_key, installed_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`
	if _, err := r.db.ExecContext(ctx, query,
		install.ID,
		install.ClusterID,
		install.AddonID,
		install.ReleaseName,
		install.Namespace,
		install.HelmRevision,
		install.InstalledVersion,
		install.ValuesJSON,
		install.Status,
		nullIfEmpty(install.InstalledBy),
		nullIfEmpty(install.IdempotencyKey),
	); err != nil {
		return fmt.Errorf("create cluster_addon_install %s: %w", install.ID, err)
	}

	policyQuery := `
		INSERT OR IGNORE INTO addon_upgrade_policies (
			addon_install_id, policy, auto_upgrade_enabled
		) VALUES (?, 'CONSERVATIVE', 0)
	`
	if _, err := r.db.ExecContext(ctx, policyQuery, install.ID); err != nil {
		return fmt.Errorf("create default addon_upgrade_policy for install %s: %w", install.ID, err)
	}
	return nil
}

// FindInstallByIdempotencyKey returns an existing install record matching (clusterID, idempotencyKey).
// Returns nil, nil when no record exists — callers must check for nil before dereferencing.
func (r *SQLiteRepository) FindInstallByIdempotencyKey(ctx context.Context, clusterID, idempotencyKey string) (*models.AddOnInstallWithHealth, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, nil
	}
	installs, err := r.listInstalls(ctx, "i.cluster_id = ? AND i.idempotency_key = ?", []interface{}{clusterID, idempotencyKey})
	if err != nil {
		return nil, fmt.Errorf("find install by idempotency key: %w", err)
	}
	if len(installs) == 0 {
		return nil, nil
	}
	return &installs[0], nil
}

// GetCatalogMeta retrieves a value from the addon_catalog_meta key-value store.
// Returns empty string and nil error when the key does not exist.
func (r *SQLiteRepository) GetCatalogMeta(ctx context.Context, key string) (string, error) {
	var value string
	query := `SELECT value FROM addon_catalog_meta WHERE key = ?`
	err := r.db.GetContext(ctx, &value, query, key)
	if err != nil {
		// sql.ErrNoRows is returned as a string "sql: no rows in result set" by sqlx.
		if err.Error() == "sql: no rows in result set" {
			return "", nil
		}
		return "", fmt.Errorf("get catalog meta %s: %w", key, err)
	}
	return value, nil
}

// SetCatalogMeta upserts a value in the addon_catalog_meta key-value store.
func (r *SQLiteRepository) SetCatalogMeta(ctx context.Context, key, value string) error {
	query := `
		INSERT INTO addon_catalog_meta (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`
	if _, err := r.db.ExecContext(ctx, query, key, value); err != nil {
		return fmt.Errorf("set catalog meta %s: %w", key, err)
	}
	return nil
}

func (r *SQLiteRepository) GetInstall(ctx context.Context, id string) (*models.AddOnInstallWithHealth, error) {
	installs, err := r.listInstalls(ctx, "i.id = ?", []interface{}{id})
	if err != nil {
		return nil, err
	}
	if len(installs) == 0 {
		return nil, fmt.Errorf("addon install not found: %s", id)
	}
	return &installs[0], nil
}

func (r *SQLiteRepository) ListClusterInstalls(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error) {
	return r.listInstalls(ctx, "i.cluster_id = ?", []interface{}{clusterID})
}

func (r *SQLiteRepository) UpdateInstallStatus(ctx context.Context, id string, status models.AddOnStatus, helmRevision int) error {
	query := `
		UPDATE cluster_addon_installs
		SET status = ?, helm_revision = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`
	result, err := r.db.ExecContext(ctx, query, string(status), helmRevision, id)
	if err != nil {
		return fmt.Errorf("update install status %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected update install status %s: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("addon install not found: %s", id)
	}
	return nil
}

func (r *SQLiteRepository) UpdateInstallVersion(ctx context.Context, id string, version string) error {
	query := `
		UPDATE cluster_addon_installs
		SET installed_version = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`
	result, err := r.db.ExecContext(ctx, query, version, id)
	if err != nil {
		return fmt.Errorf("update install version %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected update install version %s: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("addon install not found: %s", id)
	}
	return nil
}

func (r *SQLiteRepository) UpsertHealth(ctx context.Context, health *models.AddOnHealth) error {
	if health == nil {
		return fmt.Errorf("health is required")
	}
	if health.LastCheckedAt.IsZero() {
		health.LastCheckedAt = time.Now().UTC()
	}

	query := `
		INSERT INTO cluster_addon_health (
			addon_install_id, last_checked_at, health_status, ready_pods, total_pods, last_error
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(addon_install_id) DO UPDATE SET
			last_checked_at = excluded.last_checked_at,
			health_status = excluded.health_status,
			ready_pods = excluded.ready_pods,
			total_pods = excluded.total_pods,
			last_error = excluded.last_error
	`
	_, err := r.db.ExecContext(ctx, query,
		health.AddonInstallID,
		health.LastCheckedAt,
		health.HealthStatus,
		health.ReadyPods,
		health.TotalPods,
		nullIfEmpty(health.LastError),
	)
	if err != nil {
		return fmt.Errorf("upsert addon health for install %s: %w", health.AddonInstallID, err)
	}
	return nil
}

func (r *SQLiteRepository) CreateAuditEvent(ctx context.Context, event *models.AddOnAuditEvent) error {
	if event == nil {
		return fmt.Errorf("event is required")
	}
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}

	query := `
		INSERT INTO addon_audit_events (
			id, cluster_id, addon_install_id, addon_id, release_name, actor, operation, old_version,
			new_version, values_hash, result, error_message, duration_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := r.db.ExecContext(ctx, query,
		event.ID,
		event.ClusterID,
		nullIfEmpty(event.AddonInstallID),
		event.AddonID,
		event.ReleaseName,
		event.Actor,
		event.Operation,
		nullIfEmpty(event.OldVersion),
		nullIfEmpty(event.NewVersion),
		nullIfEmpty(event.ValuesHash),
		event.Result,
		nullIfEmpty(event.ErrorMessage),
		event.DurationMs,
		event.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("create addon audit event %s: %w", event.ID, err)
	}
	return nil
}

func (r *SQLiteRepository) ListAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	query := `
		SELECT id, cluster_id, addon_install_id, addon_id, release_name, actor, operation, old_version,
		       new_version, values_hash, result, error_message, duration_ms, created_at
		FROM addon_audit_events
	`
	var where []string
	var args []interface{}

	if filter.ClusterID != "" {
		where = append(where, "cluster_id = ?")
		args = append(args, filter.ClusterID)
	}
	if filter.AddonInstallID != "" {
		where = append(where, "addon_install_id = ?")
		args = append(args, filter.AddonInstallID)
	}
	if filter.AddonID != "" {
		where = append(where, "addon_id = ?")
		args = append(args, filter.AddonID)
	}
	if filter.Actor != "" {
		where = append(where, "actor = ?")
		args = append(args, filter.Actor)
	}
	if filter.Operation != "" {
		where = append(where, "operation = ?")
		args = append(args, filter.Operation)
	}
	if filter.Result != "" {
		where = append(where, "result = ?")
		args = append(args, filter.Result)
	}
	if filter.From != nil {
		where = append(where, "created_at >= ?")
		args = append(args, *filter.From)
	}
	if filter.To != nil {
		where = append(where, "created_at <= ?")
		args = append(args, *filter.To)
	}

	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY created_at DESC"

	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	query += " LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	var rows []struct {
		ID             string         `db:"id"`
		ClusterID      string         `db:"cluster_id"`
		AddonInstallID sql.NullString `db:"addon_install_id"`
		AddonID        string         `db:"addon_id"`
		ReleaseName    string         `db:"release_name"`
		Actor          string         `db:"actor"`
		Operation      string         `db:"operation"`
		OldVersion     sql.NullString `db:"old_version"`
		NewVersion     sql.NullString `db:"new_version"`
		ValuesHash     sql.NullString `db:"values_hash"`
		Result         string         `db:"result"`
		ErrorMessage   sql.NullString `db:"error_message"`
		DurationMs     sql.NullInt64  `db:"duration_ms"`
		CreatedAt      time.Time      `db:"created_at"`
	}
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("list addon audit events: %w", err)
	}

	events := make([]models.AddOnAuditEvent, 0, len(rows))
	for i := range rows {
		events = append(events, models.AddOnAuditEvent{
			ID:             rows[i].ID,
			ClusterID:      rows[i].ClusterID,
			AddonInstallID: rows[i].AddonInstallID.String,
			AddonID:        rows[i].AddonID,
			ReleaseName:    rows[i].ReleaseName,
			Actor:          rows[i].Actor,
			Operation:      rows[i].Operation,
			OldVersion:     rows[i].OldVersion.String,
			NewVersion:     rows[i].NewVersion.String,
			ValuesHash:     rows[i].ValuesHash.String,
			Result:         rows[i].Result,
			ErrorMessage:   rows[i].ErrorMessage.String,
			DurationMs:     rows[i].DurationMs.Int64,
			CreatedAt:      rows[i].CreatedAt,
		})
	}
	return events, nil
}

func (r *SQLiteRepository) GetUpgradePolicy(ctx context.Context, installID string) (*models.AddOnUpgradePolicy, error) {
	var row struct {
		AddonInstallID       string         `db:"addon_install_id"`
		Policy               string         `db:"policy"`
		PinnedVersion        sql.NullString `db:"pinned_version"`
		LastCheckAt          sql.NullTime   `db:"last_check_at"`
		NextAvailableVersion sql.NullString `db:"next_available_version"`
		AutoUpgradeEnabled   int            `db:"auto_upgrade_enabled"`
	}
	query := `
		SELECT addon_install_id, policy, pinned_version, last_check_at, next_available_version, auto_upgrade_enabled
		FROM addon_upgrade_policies
		WHERE addon_install_id = ?
	`
	if err := r.db.GetContext(ctx, &row, query, installID); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("upgrade policy not found for install: %s", installID)
		}
		return nil, fmt.Errorf("get upgrade policy for install %s: %w", installID, err)
	}

	var lastCheckAt *time.Time
	if row.LastCheckAt.Valid {
		t := row.LastCheckAt.Time
		lastCheckAt = &t
	}

	return &models.AddOnUpgradePolicy{
		AddonInstallID:       row.AddonInstallID,
		Policy:               row.Policy,
		PinnedVersion:        row.PinnedVersion.String,
		LastCheckAt:          lastCheckAt,
		NextAvailableVersion: row.NextAvailableVersion.String,
		AutoUpgradeEnabled:   row.AutoUpgradeEnabled == 1,
	}, nil
}

func (r *SQLiteRepository) UpsertUpgradePolicy(ctx context.Context, policy *models.AddOnUpgradePolicy) error {
	if policy == nil {
		return fmt.Errorf("policy is required")
	}
	query := `
		INSERT INTO addon_upgrade_policies (
			addon_install_id, policy, pinned_version, last_check_at, next_available_version, auto_upgrade_enabled
		) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(addon_install_id) DO UPDATE SET
			policy = excluded.policy,
			pinned_version = excluded.pinned_version,
			last_check_at = excluded.last_check_at,
			next_available_version = excluded.next_available_version,
			auto_upgrade_enabled = excluded.auto_upgrade_enabled
	`
	_, err := r.db.ExecContext(ctx, query,
		policy.AddonInstallID,
		policy.Policy,
		nullIfEmpty(policy.PinnedVersion),
		policy.LastCheckAt,
		nullIfEmpty(policy.NextAvailableVersion),
		boolToInt(policy.AutoUpgradeEnabled),
	)
	if err != nil {
		return fmt.Errorf("upsert upgrade policy for install %s: %w", policy.AddonInstallID, err)
	}
	return nil
}

func (r *SQLiteRepository) DeleteInstall(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM cluster_addon_installs WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete addon install %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected delete addon install %s: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("addon install not found: %s", id)
	}
	return nil
}

func (r *SQLiteRepository) listInstalls(ctx context.Context, where string, args []interface{}) ([]models.AddOnInstallWithHealth, error) {
	query := `
		SELECT
			i.id AS install_id,
			i.cluster_id,
			i.addon_id,
			i.release_name,
			i.namespace,
			i.helm_revision,
			i.installed_version,
			i.values_json,
			i.status AS install_status,
			i.installed_by,
			i.installed_at,
			i.updated_at,
			h.id AS health_id,
			h.addon_install_id AS health_addon_install_id,
			h.last_checked_at,
			h.health_status,
			h.ready_pods,
			h.total_pods,
			h.last_error,
			p.addon_install_id AS policy_addon_install_id,
			p.policy,
			p.pinned_version,
			p.last_check_at,
			p.next_available_version,
			p.auto_upgrade_enabled,
			c.id AS catalog_id,
			c.name AS catalog_name,
			c.display_name AS catalog_display_name,
			c.description AS catalog_description,
			c.tier AS catalog_tier,
			c.version AS catalog_version,
			c.k8s_compat_min AS catalog_k8s_compat_min,
			c.k8s_compat_max AS catalog_k8s_compat_max,
			c.helm_repo_url AS catalog_helm_repo_url,
			c.helm_chart AS catalog_helm_chart,
			c.helm_chart_version AS catalog_helm_chart_version,
			c.icon_url AS catalog_icon_url,
			c.tags AS catalog_tags,
			c.home_url AS catalog_home_url,
			c.source_url AS catalog_source_url,
			c.maintainer AS catalog_maintainer,
			c.is_deprecated AS catalog_is_deprecated,
			c.stars AS catalog_stars,
			c.created_at AS catalog_created_at,
			c.updated_at AS catalog_updated_at
		FROM cluster_addon_installs i
		LEFT JOIN cluster_addon_health h ON h.addon_install_id = i.id
		LEFT JOIN addon_upgrade_policies p ON p.addon_install_id = i.id
		LEFT JOIN addon_catalog c ON c.id = i.addon_id
	`
	if where != "" {
		query += " WHERE " + where
	}
	query += " ORDER BY i.installed_at DESC"

	type joinRow struct {
		InstallID        string         `db:"install_id"`
		ClusterID        string         `db:"cluster_id"`
		AddonID          string         `db:"addon_id"`
		ReleaseName      string         `db:"release_name"`
		Namespace        string         `db:"namespace"`
		HelmRevision     int            `db:"helm_revision"`
		InstalledVersion string         `db:"installed_version"`
		ValuesJSON       string         `db:"values_json"`
		InstallStatus    string         `db:"install_status"`
		InstalledBy      sql.NullString `db:"installed_by"`
		InstalledAt      time.Time      `db:"installed_at"`
		UpdatedAt        time.Time      `db:"updated_at"`

		HealthID             sql.NullInt64  `db:"health_id"`
		HealthAddonInstallID sql.NullString `db:"health_addon_install_id"`
		LastCheckedAt        sql.NullTime   `db:"last_checked_at"`
		HealthStatus         sql.NullString `db:"health_status"`
		ReadyPods            sql.NullInt64  `db:"ready_pods"`
		TotalPods            sql.NullInt64  `db:"total_pods"`
		LastError            sql.NullString `db:"last_error"`

		PolicyAddonInstallID sql.NullString `db:"policy_addon_install_id"`
		Policy               sql.NullString `db:"policy"`
		PinnedVersion        sql.NullString `db:"pinned_version"`
		LastCheckAt          sql.NullTime   `db:"last_check_at"`
		NextAvailableVersion sql.NullString `db:"next_available_version"`
		AutoUpgradeEnabled   sql.NullInt64  `db:"auto_upgrade_enabled"`

		CatalogID               sql.NullString `db:"catalog_id"`
		CatalogName             sql.NullString `db:"catalog_name"`
		CatalogDisplayName      sql.NullString `db:"catalog_display_name"`
		CatalogDescription      sql.NullString `db:"catalog_description"`
		CatalogTier             sql.NullString `db:"catalog_tier"`
		CatalogVersion          sql.NullString `db:"catalog_version"`
		CatalogK8sCompatMin     sql.NullString `db:"catalog_k8s_compat_min"`
		CatalogK8sCompatMax     sql.NullString `db:"catalog_k8s_compat_max"`
		CatalogHelmRepoURL      sql.NullString `db:"catalog_helm_repo_url"`
		CatalogHelmChart        sql.NullString `db:"catalog_helm_chart"`
		CatalogHelmChartVersion sql.NullString `db:"catalog_helm_chart_version"`
		CatalogIconURL          sql.NullString `db:"catalog_icon_url"`
		CatalogTags             sql.NullString `db:"catalog_tags"`
		CatalogHomeURL          sql.NullString `db:"catalog_home_url"`
		CatalogSourceURL        sql.NullString `db:"catalog_source_url"`
		CatalogMaintainer       sql.NullString `db:"catalog_maintainer"`
		CatalogIsDeprecated     sql.NullInt64  `db:"catalog_is_deprecated"`
		CatalogStars            int            `db:"catalog_stars"`
		CatalogCreatedAt        sql.NullTime   `db:"catalog_created_at"`
		CatalogUpdatedAt        sql.NullTime   `db:"catalog_updated_at"`
	}

	var rows []joinRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("list addon installs: %w", err)
	}

	result := make([]models.AddOnInstallWithHealth, 0, len(rows))
	for i := range rows {
		item := models.AddOnInstallWithHealth{
			AddOnInstall: models.AddOnInstall{
				ID:               rows[i].InstallID,
				ClusterID:        rows[i].ClusterID,
				AddonID:          rows[i].AddonID,
				ReleaseName:      rows[i].ReleaseName,
				Namespace:        rows[i].Namespace,
				HelmRevision:     rows[i].HelmRevision,
				InstalledVersion: rows[i].InstalledVersion,
				ValuesJSON:       rows[i].ValuesJSON,
				Status:           rows[i].InstallStatus,
				InstalledBy:      rows[i].InstalledBy.String,
				InstalledAt:      rows[i].InstalledAt,
				UpdatedAt:        rows[i].UpdatedAt,
			},
		}

		if rows[i].HealthID.Valid {
			item.Health = &models.AddOnHealth{
				ID:             rows[i].HealthID.Int64,
				AddonInstallID: rows[i].HealthAddonInstallID.String,
				LastCheckedAt:  rows[i].LastCheckedAt.Time,
				HealthStatus:   rows[i].HealthStatus.String,
				ReadyPods:      int(rows[i].ReadyPods.Int64),
				TotalPods:      int(rows[i].TotalPods.Int64),
				LastError:      rows[i].LastError.String,
			}
		}

		if rows[i].PolicyAddonInstallID.Valid {
			var lastCheckAt *time.Time
			if rows[i].LastCheckAt.Valid {
				t := rows[i].LastCheckAt.Time
				lastCheckAt = &t
			}
			item.Policy = &models.AddOnUpgradePolicy{
				AddonInstallID:       rows[i].PolicyAddonInstallID.String,
				Policy:               rows[i].Policy.String,
				PinnedVersion:        rows[i].PinnedVersion.String,
				LastCheckAt:          lastCheckAt,
				NextAvailableVersion: rows[i].NextAvailableVersion.String,
				AutoUpgradeEnabled:   rows[i].AutoUpgradeEnabled.Int64 == 1,
			}
		}

		if rows[i].CatalogID.Valid {
			tags, err := decodeStringSlice(rows[i].CatalogTags.String)
			if err != nil {
				return nil, fmt.Errorf("decode tags for catalog addon %s: %w", rows[i].CatalogID.String, err)
			}
			item.CatalogEntry = &models.AddOnEntry{
				ID:               rows[i].CatalogID.String,
				Name:             rows[i].CatalogName.String,
				DisplayName:      rows[i].CatalogDisplayName.String,
				Description:      rows[i].CatalogDescription.String,
				Tier:             rows[i].CatalogTier.String,
				Version:          rows[i].CatalogVersion.String,
				K8sCompatMin:     rows[i].CatalogK8sCompatMin.String,
				K8sCompatMax:     rows[i].CatalogK8sCompatMax.String,
				HelmRepoURL:      rows[i].CatalogHelmRepoURL.String,
				HelmChart:        rows[i].CatalogHelmChart.String,
				HelmChartVersion: rows[i].CatalogHelmChartVersion.String,
				IconURL:          rows[i].CatalogIconURL.String,
				Tags:             tags,
				HomeURL:          rows[i].CatalogHomeURL.String,
				SourceURL:        rows[i].CatalogSourceURL.String,
				Maintainer:       rows[i].CatalogMaintainer.String,
				IsDeprecated:     rows[i].CatalogIsDeprecated.Int64 == 1,
				Stars:            rows[i].CatalogStars,
				CreatedAt:        rows[i].CatalogCreatedAt.Time,
				UpdatedAt:        rows[i].CatalogUpdatedAt.Time,
			}
		}

		result = append(result, item)
	}
	return result, nil
}

func encodeStringSlice(value []string) (string, error) {
	if len(value) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func decodeStringSlice(raw string) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return []string{}, nil
	}
	var value []string
	if err := json.Unmarshal([]byte(trimmed), &value); err == nil {
		return value, nil
	}
	parts := strings.Split(trimmed, ",")
	value = make([]string, 0, len(parts))
	for i := range parts {
		item := strings.TrimSpace(parts[i])
		if item != "" {
			value = append(value, item)
		}
	}
	return value, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func nullIfEmpty(v string) interface{} {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

// ── Rollout repository methods (T8.06) ────────────────────────────────────────

func (r *SQLiteRepository) CreateRollout(ctx context.Context, rollout *models.AddonRollout) error {
	if rollout == nil {
		return fmt.Errorf("rollout is required")
	}
	if rollout.ID == "" {
		rollout.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	if rollout.CreatedAt.IsZero() {
		rollout.CreatedAt = now
	}
	rollout.UpdatedAt = now

	query := `
		INSERT INTO addon_rollouts (id, addon_id, target_version, strategy, canary_percent, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	if _, err := r.db.ExecContext(ctx, query,
		rollout.ID,
		rollout.AddonID,
		rollout.TargetVersion,
		string(rollout.Strategy),
		rollout.CanaryPercent,
		string(rollout.Status),
		rollout.CreatedBy,
		rollout.CreatedAt,
		rollout.UpdatedAt,
	); err != nil {
		return fmt.Errorf("create addon_rollout %s: %w", rollout.ID, err)
	}

	// Insert initial cluster statuses.
	for i := range rollout.ClusterStatuses {
		rollout.ClusterStatuses[i].RolloutID = rollout.ID
		if err := r.UpsertRolloutClusterStatus(ctx, &rollout.ClusterStatuses[i]); err != nil {
			return fmt.Errorf("insert rollout cluster status for %s: %w", rollout.ClusterStatuses[i].ClusterID, err)
		}
	}
	return nil
}

func (r *SQLiteRepository) GetRollout(ctx context.Context, id string) (*models.AddonRollout, error) {
	var row struct {
		ID            string    `db:"id"`
		AddonID       string    `db:"addon_id"`
		TargetVersion string    `db:"target_version"`
		Strategy      string    `db:"strategy"`
		CanaryPercent int       `db:"canary_percent"`
		Status        string    `db:"status"`
		CreatedBy     string    `db:"created_by"`
		CreatedAt     time.Time `db:"created_at"`
		UpdatedAt     time.Time `db:"updated_at"`
	}
	if err := r.db.GetContext(ctx, &row,
		`SELECT id, addon_id, target_version, strategy, canary_percent, status, created_by, created_at, updated_at FROM addon_rollouts WHERE id = ?`,
		id,
	); err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, fmt.Errorf("rollout not found: %s", id)
		}
		return nil, fmt.Errorf("get rollout %s: %w", id, err)
	}

	rollout := &models.AddonRollout{
		ID:            row.ID,
		AddonID:       row.AddonID,
		TargetVersion: row.TargetVersion,
		Strategy:      models.RolloutStrategy(row.Strategy),
		CanaryPercent: row.CanaryPercent,
		Status:        models.RolloutStatus(row.Status),
		CreatedBy:     row.CreatedBy,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}

	var statuses []struct {
		RolloutID    string       `db:"rollout_id"`
		ClusterID    string       `db:"cluster_id"`
		Status       string       `db:"status"`
		ErrorMessage string       `db:"error_message"`
		StartedAt    sql.NullTime `db:"started_at"`
		CompletedAt  sql.NullTime `db:"completed_at"`
	}
	if err := r.db.SelectContext(ctx, &statuses,
		`SELECT rollout_id, cluster_id, status, error_message, started_at, completed_at FROM addon_rollout_cluster_status WHERE rollout_id = ?`,
		id,
	); err != nil {
		return nil, fmt.Errorf("get rollout cluster statuses for %s: %w", id, err)
	}
	for _, s := range statuses {
		cs := models.RolloutClusterStatus{
			RolloutID:    s.RolloutID,
			ClusterID:    s.ClusterID,
			Status:       s.Status,
			ErrorMessage: s.ErrorMessage,
		}
		if s.StartedAt.Valid {
			t := s.StartedAt.Time
			cs.StartedAt = &t
		}
		if s.CompletedAt.Valid {
			t := s.CompletedAt.Time
			cs.CompletedAt = &t
		}
		rollout.ClusterStatuses = append(rollout.ClusterStatuses, cs)
	}
	return rollout, nil
}

func (r *SQLiteRepository) ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error) {
	query := `SELECT id, addon_id, target_version, strategy, canary_percent, status, created_by, created_at, updated_at FROM addon_rollouts`
	var args []interface{}
	if addonID != "" {
		query += " WHERE addon_id = ?"
		args = append(args, addonID)
	}
	query += " ORDER BY created_at DESC"

	var rows []struct {
		ID            string    `db:"id"`
		AddonID       string    `db:"addon_id"`
		TargetVersion string    `db:"target_version"`
		Strategy      string    `db:"strategy"`
		CanaryPercent int       `db:"canary_percent"`
		Status        string    `db:"status"`
		CreatedBy     string    `db:"created_by"`
		CreatedAt     time.Time `db:"created_at"`
		UpdatedAt     time.Time `db:"updated_at"`
	}
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("list addon_rollouts: %w", err)
	}
	result := make([]models.AddonRollout, 0, len(rows))
	for _, row := range rows {
		result = append(result, models.AddonRollout{
			ID:            row.ID,
			AddonID:       row.AddonID,
			TargetVersion: row.TargetVersion,
			Strategy:      models.RolloutStrategy(row.Strategy),
			CanaryPercent: row.CanaryPercent,
			Status:        models.RolloutStatus(row.Status),
			CreatedBy:     row.CreatedBy,
			CreatedAt:     row.CreatedAt,
			UpdatedAt:     row.UpdatedAt,
		})
	}
	return result, nil
}

func (r *SQLiteRepository) UpdateRolloutStatus(ctx context.Context, id string, status models.RolloutStatus) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE addon_rollouts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		string(status), id,
	)
	if err != nil {
		return fmt.Errorf("update rollout status %s: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected update rollout status %s: %w", id, err)
	}
	if affected == 0 {
		return fmt.Errorf("rollout not found: %s", id)
	}
	return nil
}

func (r *SQLiteRepository) UpsertRolloutClusterStatus(ctx context.Context, cs *models.RolloutClusterStatus) error {
	if cs == nil {
		return fmt.Errorf("cluster status is required")
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO addon_rollout_cluster_status (rollout_id, cluster_id, status, error_message, started_at, completed_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(rollout_id, cluster_id) DO UPDATE SET
			status        = excluded.status,
			error_message = excluded.error_message,
			started_at    = COALESCE(excluded.started_at, addon_rollout_cluster_status.started_at),
			completed_at  = excluded.completed_at
	`,
		cs.RolloutID,
		cs.ClusterID,
		cs.Status,
		cs.ErrorMessage,
		cs.StartedAt,
		cs.CompletedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert rollout_cluster_status (%s, %s): %w", cs.RolloutID, cs.ClusterID, err)
	}
	return nil
}

// ── Notification Channel repository methods (T8.11) ──────────────────────────

func (r *SQLiteRepository) CreateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	if ch == nil {
		return fmt.Errorf("channel is required")
	}
	if ch.ID == "" {
		ch.ID = uuid.NewString()
	}
	eventsJSON, err := json.Marshal(ch.Events)
	if err != nil {
		return fmt.Errorf("marshal events: %w", err)
	}
	ch.CreatedAt = time.Now().UTC()
	ch.UpdatedAt = ch.CreatedAt
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO notification_channels (id, name, type, url, events, enabled, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, ch.ID, ch.Name, string(ch.Type), ch.URL, string(eventsJSON), boolToInt(ch.Enabled), ch.CreatedAt, ch.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create notification_channel %s: %w", ch.ID, err)
	}
	return nil
}

func (r *SQLiteRepository) GetNotificationChannel(ctx context.Context, id string) (*models.NotificationChannel, error) {
	var row struct {
		ID        string    `db:"id"`
		Name      string    `db:"name"`
		Type      string    `db:"type"`
		URL       string    `db:"url"`
		Events    string    `db:"events"`
		Enabled   int       `db:"enabled"`
		CreatedAt time.Time `db:"created_at"`
		UpdatedAt time.Time `db:"updated_at"`
	}
	if err := r.db.GetContext(ctx, &row,
		`SELECT id, name, type, url, events, enabled, created_at, updated_at FROM notification_channels WHERE id = ?`, id,
	); err != nil {
		if err.Error() == "sql: no rows in result set" {
			return nil, fmt.Errorf("notification channel not found: %s", id)
		}
		return nil, fmt.Errorf("get notification_channel %s: %w", id, err)
	}
	var events []string
	_ = json.Unmarshal([]byte(row.Events), &events)
	return &models.NotificationChannel{
		ID: row.ID, Name: row.Name, Type: models.NotificationChannelType(row.Type),
		URL: row.URL, Events: events, Enabled: row.Enabled == 1,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}, nil
}

func (r *SQLiteRepository) ListNotificationChannels(ctx context.Context) ([]models.NotificationChannel, error) {
	var rows []struct {
		ID        string    `db:"id"`
		Name      string    `db:"name"`
		Type      string    `db:"type"`
		URL       string    `db:"url"`
		Events    string    `db:"events"`
		Enabled   int       `db:"enabled"`
		CreatedAt time.Time `db:"created_at"`
		UpdatedAt time.Time `db:"updated_at"`
	}
	if err := r.db.SelectContext(ctx, &rows,
		`SELECT id, name, type, url, events, enabled, created_at, updated_at FROM notification_channels ORDER BY created_at DESC`,
	); err != nil {
		return nil, fmt.Errorf("list notification_channels: %w", err)
	}
	result := make([]models.NotificationChannel, 0, len(rows))
	for _, row := range rows {
		var events []string
		_ = json.Unmarshal([]byte(row.Events), &events)
		result = append(result, models.NotificationChannel{
			ID: row.ID, Name: row.Name, Type: models.NotificationChannelType(row.Type),
			URL: row.URL, Events: events, Enabled: row.Enabled == 1,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})
	}
	return result, nil
}

func (r *SQLiteRepository) UpdateNotificationChannel(ctx context.Context, ch *models.NotificationChannel) error {
	if ch == nil {
		return fmt.Errorf("channel is required")
	}
	eventsJSON, err := json.Marshal(ch.Events)
	if err != nil {
		return fmt.Errorf("marshal events: %w", err)
	}
	ch.UpdatedAt = time.Now().UTC()
	res, err := r.db.ExecContext(ctx, `
		UPDATE notification_channels SET name=?, type=?, url=?, events=?, enabled=?, updated_at=?
		WHERE id=?
	`, ch.Name, string(ch.Type), ch.URL, string(eventsJSON), boolToInt(ch.Enabled), ch.UpdatedAt, ch.ID)
	if err != nil {
		return fmt.Errorf("update notification_channel %s: %w", ch.ID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("notification channel not found: %s", ch.ID)
	}
	return nil
}

func (r *SQLiteRepository) DeleteNotificationChannel(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM notification_channels WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete notification_channel %s: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("notification channel not found: %s", id)
	}
	return nil
}
