package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// ─── Safety Policy Implementation (A-CORE-011) ────────────────────────────────

// internal struct for JSON serialization in DB
type policyConfig struct {
	Condition string `json:"condition"`
	Effect    string `json:"effect"`
	Reason    string `json:"reason"`
}

func (s *sqliteStore) ListPolicies(ctx context.Context) ([]*SafetyPolicyRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT name, component_config, updated_at
		FROM safety_policies
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}
	defer rows.Close()

	var results []*SafetyPolicyRecord
	for rows.Next() {
		var configJSON string

		var r SafetyPolicyRecord
		// Scan directly into struct fields where possible
		// Start with Name, JSON config, UpdatedAt
		if err := rows.Scan(&r.Name, &configJSON, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan policy: %w", err)
		}

		// Unmarshal config
		var cfg policyConfig
		if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
			// Log error but continue? or fail? Better to fail or skip.
			return nil, fmt.Errorf("unmarshal policy config for %s: %w", r.Name, err)
		}
		r.Condition = cfg.Condition
		r.Effect = cfg.Effect
		r.Reason = cfg.Reason

		results = append(results, &r)
	}
	return results, nil
}

func (s *sqliteStore) GetPolicy(ctx context.Context, name string) (*SafetyPolicyRecord, error) {
	var configJSON string
	var r SafetyPolicyRecord
	r.Name = name

	err := s.db.QueryRowContext(ctx, `
		SELECT component_config, updated_at
		FROM safety_policies
		WHERE name = ?
	`, name).Scan(&configJSON, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("get policy: %w", err)
	}

	var cfg policyConfig
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal policy config: %w", err)
	}
	r.Condition = cfg.Condition
	r.Effect = cfg.Effect
	r.Reason = cfg.Reason

	return &r, nil
}

func (s *sqliteStore) CreatePolicy(ctx context.Context, rec *SafetyPolicyRecord) error {
	cfg := policyConfig{
		Condition: rec.Condition,
		Effect:    rec.Effect,
		Reason:    rec.Reason,
	}
	configJSON, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal policy config: %w", err)
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO safety_policies (name, component_config, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
	`, rec.Name, string(configJSON))
	if err != nil {
		return fmt.Errorf("create policy: %w", err)
	}
	return nil
}

func (s *sqliteStore) UpdatePolicy(ctx context.Context, rec *SafetyPolicyRecord) error {
	cfg := policyConfig{
		Condition: rec.Condition,
		Effect:    rec.Effect,
		Reason:    rec.Reason,
	}
	configJSON, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal policy config: %w", err)
	}

	res, err := s.db.ExecContext(ctx, `
		UPDATE safety_policies
		SET component_config = ?, updated_at = CURRENT_TIMESTAMP
		WHERE name = ?
	`, string(configJSON), rec.Name)
	if err != nil {
		return fmt.Errorf("update policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("policy not found: %s", rec.Name)
	}
	return nil
}

func (s *sqliteStore) DeletePolicy(ctx context.Context, name string) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM safety_policies WHERE name = ?", name)
	if err != nil {
		return fmt.Errorf("delete policy: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("policy not found: %s", name)
	}
	return nil
}
