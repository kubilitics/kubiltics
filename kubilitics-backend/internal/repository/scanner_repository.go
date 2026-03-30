package repository

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ScannerRepository defines data access for security scan data.
type ScannerRepository interface {
	CreateScanRun(ctx context.Context, run *models.ScanRun) error
	GetScanRun(ctx context.Context, id string) (*models.ScanRun, error)
	UpdateScanRun(ctx context.Context, run *models.ScanRun) error
	ListScanRuns(ctx context.Context, limit, offset int) ([]*models.ScanRun, int, error)
	CreateScanFindings(ctx context.Context, findings []models.ScanFinding) error
	ListScanFindings(ctx context.Context, runID string, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error)
	ListAllFindings(ctx context.Context, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error)
	GetScanStats(ctx context.Context) (*models.ScanStats, error)
	GetScanTrend(ctx context.Context, days int) ([]models.ScanTrend, error)
}

// --- SQLiteRepository implements ScannerRepository ---

func (r *SQLiteRepository) CreateScanRun(ctx context.Context, run *models.ScanRun) error {
	query := `
		INSERT INTO scan_runs (id, status, target_type, target_path, scanners, total_findings,
			critical_count, high_count, medium_count, low_count, info_count, duration_ms,
			error_message, started_at, completed_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := r.db.ExecContext(ctx, query,
		run.ID, run.Status, run.TargetType, run.TargetPath, run.Scanners,
		run.TotalFindings, run.CriticalCount, run.HighCount, run.MediumCount, run.LowCount, run.InfoCount,
		run.DurationMs, run.ErrorMessage, run.StartedAt, run.CompletedAt, run.CreatedAt,
	)
	return err
}

func (r *SQLiteRepository) GetScanRun(ctx context.Context, id string) (*models.ScanRun, error) {
	var run models.ScanRun
	err := r.db.QueryRowContext(ctx,
		`SELECT id, status, target_type, target_path, scanners, total_findings,
			critical_count, high_count, medium_count, low_count, info_count, duration_ms,
			error_message, started_at, completed_at, created_at
		FROM scan_runs WHERE id = ?`, id,
	).Scan(
		&run.ID, &run.Status, &run.TargetType, &run.TargetPath, &run.Scanners,
		&run.TotalFindings, &run.CriticalCount, &run.HighCount, &run.MediumCount, &run.LowCount, &run.InfoCount,
		&run.DurationMs, &run.ErrorMessage, &run.StartedAt, &run.CompletedAt, &run.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *SQLiteRepository) UpdateScanRun(ctx context.Context, run *models.ScanRun) error {
	query := `
		UPDATE scan_runs SET status = ?, total_findings = ?, critical_count = ?, high_count = ?,
			medium_count = ?, low_count = ?, info_count = ?, duration_ms = ?,
			error_message = ?, started_at = ?, completed_at = ?
		WHERE id = ?
	`
	_, err := r.db.ExecContext(ctx, query,
		run.Status, run.TotalFindings, run.CriticalCount, run.HighCount,
		run.MediumCount, run.LowCount, run.InfoCount, run.DurationMs,
		run.ErrorMessage, run.StartedAt, run.CompletedAt, run.ID,
	)
	return err
}

func (r *SQLiteRepository) ListScanRuns(ctx context.Context, limit, offset int) ([]*models.ScanRun, int, error) {
	var total int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM scan_runs`).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	rows, err := r.db.QueryContext(ctx,
		`SELECT id, status, target_type, target_path, scanners, total_findings,
			critical_count, high_count, medium_count, low_count, info_count, duration_ms,
			error_message, started_at, completed_at, created_at
		FROM scan_runs ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = rows.Close() }()

	var runs []*models.ScanRun
	for rows.Next() {
		var run models.ScanRun
		if err := rows.Scan(
			&run.ID, &run.Status, &run.TargetType, &run.TargetPath, &run.Scanners,
			&run.TotalFindings, &run.CriticalCount, &run.HighCount, &run.MediumCount, &run.LowCount, &run.InfoCount,
			&run.DurationMs, &run.ErrorMessage, &run.StartedAt, &run.CompletedAt, &run.CreatedAt,
		); err != nil {
			return nil, 0, err
		}
		runs = append(runs, &run)
	}
	return runs, total, nil
}

func (r *SQLiteRepository) CreateScanFindings(ctx context.Context, findings []models.ScanFinding) error {
	if len(findings) == 0 {
		return nil
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO scan_findings (id, run_id, tool, rule_id, severity, title, description,
			file_path, start_line, end_line, remediation, cwe, cve, confidence, metadata,
			status, first_seen_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

	for _, f := range findings {
		_, err := stmt.ExecContext(ctx,
			f.ID, f.RunID, f.Tool, f.RuleID, f.Severity, f.Title, f.Description,
			f.FilePath, f.StartLine, f.EndLine, f.Remediation, f.CWE, f.CVE,
			f.Confidence, f.MetadataRaw, f.Status, f.FirstSeenAt, f.LastSeenAt,
		)
		if err != nil {
			return fmt.Errorf("insert finding %s: %w", f.ID, err)
		}
	}
	return tx.Commit()
}

func (r *SQLiteRepository) ListScanFindings(ctx context.Context, runID string, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error) {
	whereClause := "WHERE run_id = ?"
	args := []interface{}{runID}

	if severity != "" {
		whereClause += " AND severity = ?"
		args = append(args, severity)
	}
	if tool != "" {
		whereClause += " AND tool = ?"
		args = append(args, tool)
	}
	if status != "" {
		whereClause += " AND status = ?"
		args = append(args, status)
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	err := r.db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM scan_findings %s`, whereClause), countArgs...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, run_id, tool, rule_id, severity, title, description, file_path,
			start_line, end_line, remediation, cwe, cve, confidence, metadata,
			status, first_seen_at, last_seen_at
		FROM scan_findings %s
		ORDER BY CASE severity
			WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2
			WHEN 'LOW' THEN 3 ELSE 4 END, title
		LIMIT ? OFFSET ?
	`, whereClause)
	args = append(args, limit, offset)

	return r.queryScanFindings(ctx, query, args, total)
}

func (r *SQLiteRepository) ListAllFindings(ctx context.Context, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error) {
	whereClause := "WHERE 1=1"
	var args []interface{}

	if severity != "" {
		whereClause += " AND severity = ?"
		args = append(args, severity)
	}
	if tool != "" {
		whereClause += " AND tool = ?"
		args = append(args, tool)
	}
	if status != "" {
		whereClause += " AND status = ?"
		args = append(args, status)
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	err := r.db.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM scan_findings %s`, whereClause), countArgs...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, run_id, tool, rule_id, severity, title, description, file_path,
			start_line, end_line, remediation, cwe, cve, confidence, metadata,
			status, first_seen_at, last_seen_at
		FROM scan_findings %s
		ORDER BY last_seen_at DESC, CASE severity
			WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2
			WHEN 'LOW' THEN 3 ELSE 4 END
		LIMIT ? OFFSET ?
	`, whereClause)
	args = append(args, limit, offset)

	return r.queryScanFindings(ctx, query, args, total)
}

func (r *SQLiteRepository) queryScanFindings(ctx context.Context, query string, args []interface{}, total int) ([]models.ScanFinding, int, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = rows.Close() }()

	var findings []models.ScanFinding
	for rows.Next() {
		var f models.ScanFinding
		if err := rows.Scan(
			&f.ID, &f.RunID, &f.Tool, &f.RuleID, &f.Severity, &f.Title, &f.Description,
			&f.FilePath, &f.StartLine, &f.EndLine, &f.Remediation, &f.CWE, &f.CVE,
			&f.Confidence, &f.MetadataRaw, &f.Status, &f.FirstSeenAt, &f.LastSeenAt,
		); err != nil {
			return nil, 0, err
		}
		findings = append(findings, f)
	}
	return findings, total, nil
}

func (r *SQLiteRepository) GetScanStats(ctx context.Context) (*models.ScanStats, error) {
	stats := &models.ScanStats{
		BySeverity: make(map[string]int),
		ByTool:     make(map[string]int),
	}

	// Total runs
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM scan_runs`).Scan(&stats.TotalRuns); err != nil {
		return nil, fmt.Errorf("count scan_runs: %w", err)
	}

	// Total open findings
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM scan_findings WHERE status = 'open'`).Scan(&stats.TotalFindings); err != nil {
		return nil, fmt.Errorf("count scan_findings: %w", err)
	}

	// By severity
	rows, err := r.db.QueryContext(ctx, `SELECT severity, COUNT(*) FROM scan_findings WHERE status = 'open' GROUP BY severity`)
	if err != nil {
		return nil, fmt.Errorf("findings by severity: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var sev string
		var count int
		if rows.Scan(&sev, &count) == nil {
			stats.BySeverity[sev] = count
		}
	}

	// By tool
	rows2, err := r.db.QueryContext(ctx, `SELECT tool, COUNT(*) FROM scan_findings WHERE status = 'open' GROUP BY tool`)
	if err != nil {
		return nil, fmt.Errorf("findings by tool: %w", err)
	}
	defer func() { _ = rows2.Close() }()
	for rows2.Next() {
		var tool string
		var count int
		if rows2.Scan(&tool, &count) == nil {
			stats.ByTool[tool] = count
		}
	}

	return stats, nil
}

func (r *SQLiteRepository) GetScanTrend(ctx context.Context, days int) ([]models.ScanTrend, error) {
	query := `
		SELECT DATE(sr.created_at) as date,
			SUM(sr.critical_count) as critical,
			SUM(sr.high_count) as high,
			SUM(sr.medium_count) as medium,
			SUM(sr.low_count) as low,
			SUM(sr.info_count) as info
		FROM scan_runs sr
		WHERE sr.status = 'completed' AND sr.created_at >= DATE('now', ?)
		GROUP BY DATE(sr.created_at)
		ORDER BY date
	`
	rows, err := r.db.QueryContext(ctx, query, fmt.Sprintf("-%d days", days))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var trends []models.ScanTrend
	for rows.Next() {
		var t models.ScanTrend
		if err := rows.Scan(&t.Date, &t.Critical, &t.High, &t.Medium, &t.Low, &t.Info); err != nil {
			return nil, err
		}
		trends = append(trends, t)
	}
	return trends, nil
}
