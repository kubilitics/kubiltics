package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ─── Budget Store (AI-006) ───────────────────────────────────────────────────

func (s *sqliteStore) AppendBudgetRecord(ctx context.Context, rec *BudgetRecord) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO token_usage (user_id, investigation_id, provider, input_tokens, output_tokens, cost_usd, recorded_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, rec.UserID, rec.InvestigationID, rec.Provider, rec.InputTokens, rec.OutputTokens, rec.CostUSD, rec.RecordedAt)
	if err != nil {
		return fmt.Errorf("append budget record: %w", err)
	}
	return nil
}

func (s *sqliteStore) QueryBudgetRecords(ctx context.Context, userID string, from, to time.Time) ([]*BudgetRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, investigation_id, provider, input_tokens, output_tokens, cost_usd, recorded_at
		FROM token_usage
		WHERE user_id = ? AND recorded_at >= ? AND recorded_at <= ?
		ORDER BY recorded_at ASC
	`, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query budget records: %w", err)
	}
	defer rows.Close()

	var results []*BudgetRecord
	for rows.Next() {
		var r BudgetRecord
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.InvestigationID, &r.Provider,
			&r.InputTokens, &r.OutputTokens, &r.CostUSD, &r.RecordedAt,
		); err != nil {
			return nil, fmt.Errorf("scan budget record: %w", err)
		}
		results = append(results, &r)
	}
	return results, nil
}

func (s *sqliteStore) GlobalBudgetTotal(ctx context.Context, from, to time.Time) (float64, error) {
	var total float64
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(cost_usd), 0.0)
		FROM token_usage
		WHERE recorded_at >= ? AND recorded_at <= ?
	`, from, to).Scan(&total)
	if err != nil {
		return 0.0, fmt.Errorf("global budget total: %w", err)
	}
	return total, nil
}

func (s *sqliteStore) GetUserBudget(ctx context.Context, userID string) (float64, time.Time, error) {
	var limit float64
	var periodStart time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT limit_usd, period_start
		FROM budget_limits
		WHERE user_id = ?
	`, userID).Scan(&limit, &periodStart)
	if err == sql.ErrNoRows {
		return 0.0, time.Time{}, nil // Return 0 if no limit set
	}
	if err != nil {
		return 0.0, time.Time{}, fmt.Errorf("get user budget: %w", err)
	}
	return limit, periodStart, nil
}

func (s *sqliteStore) SetUserBudget(ctx context.Context, userID string, limitUSD float64) error {
	// Upsert: SQLite 3.24+ supports ON CONFLICT
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO budget_limits (user_id, limit_usd, period_start, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			limit_usd = excluded.limit_usd,
			updated_at = CURRENT_TIMESTAMP
	`, userID, limitUSD, time.Now().UTC())

	if err != nil {
		return fmt.Errorf("set user budget: %w", err)
	}
	return nil
}

func (s *sqliteStore) ResetUserBudget(ctx context.Context, userID string) error {
	// Upsert period_start to NOW+1s for the user.
	// We add 1 second to ensure any records written in the same wall-clock second
	// as the reset are excluded from the next summary query.
	// We use UPSERT (INSERT … ON CONFLICT) so this works even when the user has
	// no existing row in budget_limits (e.g. limit was set via config, not DB).
	newPeriodStart := time.Now().UTC().Add(time.Second)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO budget_limits (user_id, limit_usd, period_start, updated_at)
		VALUES (?, 0, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(user_id) DO UPDATE SET
			period_start = excluded.period_start,
			updated_at   = CURRENT_TIMESTAMP
	`, userID, newPeriodStart)
	if err != nil {
		return fmt.Errorf("reset user budget: %w", err)
	}
	return nil
}

// RolloverAllBudgets advances period_start to now for ALL users in budget_limits.
// This is called by the server's monthly rollover cron goroutine (AI-016) so that
// per-user spending windows reset without requiring a service restart.
func (s *sqliteStore) RolloverAllBudgets(ctx context.Context) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		UPDATE budget_limits
		SET period_start = ?, updated_at = CURRENT_TIMESTAMP
	`, now)
	if err != nil {
		return fmt.Errorf("rollover all budgets: %w", err)
	}
	return nil
}
