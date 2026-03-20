package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func (r *SQLiteRepository) ListProfiles(ctx context.Context) ([]models.ClusterProfile, error) {
	rows, err := r.db.QueryxContext(ctx, `
		SELECT id, name, description, addons, is_builtin, created_at, updated_at
		FROM cluster_profiles
		ORDER BY is_builtin DESC, name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list profiles: %w", err)
	}
	defer rows.Close()

	var profiles []models.ClusterProfile
	for rows.Next() {
		var p models.ClusterProfile
		var addonsJSON string
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &addonsJSON, &p.IsBuiltin, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan profile: %w", err)
		}
		if err := json.Unmarshal([]byte(addonsJSON), &p.Addons); err != nil {
			p.Addons = []models.ProfileAddon{}
		}
		profiles = append(profiles, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate profiles: %w", err)
	}
	return profiles, nil
}

func (r *SQLiteRepository) GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error) {
	var p models.ClusterProfile
	var addonsJSON string
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, description, addons, is_builtin, created_at, updated_at
		FROM cluster_profiles WHERE id = ? OR name = ?
	`, id, id).Scan(&p.ID, &p.Name, &p.Description, &addonsJSON, &p.IsBuiltin, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("profile not found: %s", id)
	}
	if err != nil {
		return nil, fmt.Errorf("get profile: %w", err)
	}
	if err := json.Unmarshal([]byte(addonsJSON), &p.Addons); err != nil {
		p.Addons = []models.ProfileAddon{}
	}
	return &p, nil
}

func (r *SQLiteRepository) CreateProfile(ctx context.Context, profile *models.ClusterProfile) error {
	if profile.ID == "" {
		profile.ID = uuid.New().String()
	}
	addonsJSON, err := json.Marshal(profile.Addons)
	if err != nil {
		return fmt.Errorf("marshal profile addons: %w", err)
	}
	now := time.Now().UTC()
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO cluster_profiles (id, name, description, addons, is_builtin, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, profile.ID, profile.Name, profile.Description, string(addonsJSON), profile.IsBuiltin, now, now)
	if err != nil {
		return fmt.Errorf("create profile: %w", err)
	}
	profile.CreatedAt = now
	profile.UpdatedAt = now
	return nil
}

// SeedBuiltinProfiles inserts the three built-in bootstrap profiles.
// Uses INSERT OR IGNORE so it is idempotent across restarts.
func (r *SQLiteRepository) SeedBuiltinProfiles(ctx context.Context) error {
	builtins := []models.ClusterProfile{
		{
			ID:          "builtin-production-security",
			Name:        "Production Security Stack",
			Description: "Kyverno policy engine, Falco runtime security, Sealed Secrets, and cert-manager for a production-grade security baseline.",
			IsBuiltin:   true,
			Addons: []models.ProfileAddon{
				{AddonID: "kubilitics/cert-manager", Namespace: "cert-manager"},
				{AddonID: "kubilitics/kyverno", Namespace: "kyverno"},
				{AddonID: "kubilitics/falco", Namespace: "falco"},
				{AddonID: "kubilitics/sealed-secrets", Namespace: "kube-system"},
			},
		},
		{
			ID:          "builtin-full-observability",
			Name:        "Full Observability",
			Description: "kube-prometheus-stack for metrics and alerting, Loki for log aggregation, and OpenCost for cost visibility.",
			IsBuiltin:   true,
			Addons: []models.ProfileAddon{
				{AddonID: "kubilitics/kube-prometheus-stack", Namespace: "monitoring"},
				{AddonID: "kubilitics/loki-stack", Namespace: "monitoring"},
				{AddonID: "kubilitics/opencost", Namespace: "opencost"},
			},
		},
		{
			ID:          "builtin-gitops-ready",
			Name:        "GitOps Ready",
			Description: "Argo CD for GitOps deployments, cert-manager for TLS, and ingress-nginx as the cluster ingress controller.",
			IsBuiltin:   true,
			Addons: []models.ProfileAddon{
				{AddonID: "kubilitics/cert-manager", Namespace: "cert-manager"},
				{AddonID: "kubilitics/ingress-nginx", Namespace: "ingress-nginx"},
				{AddonID: "kubilitics/argocd", Namespace: "argocd"},
			},
		},
	}

	for _, p := range builtins {
		addonsJSON, err := json.Marshal(p.Addons)
		if err != nil {
			return fmt.Errorf("marshal addons for profile %s: %w", p.Name, err)
		}
		_, err = r.db.ExecContext(ctx, `
			INSERT OR IGNORE INTO cluster_profiles (id, name, description, addons, is_builtin, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		`, p.ID, p.Name, p.Description, string(addonsJSON), 1)
		if err != nil {
			return fmt.Errorf("seed builtin profile %s: %w", p.Name, err)
		}
	}
	return nil
}
