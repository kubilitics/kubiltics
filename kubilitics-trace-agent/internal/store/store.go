package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite" // register "sqlite" driver
)

// Store wraps a SQLite database and provides all persistence operations for the
// trace agent.
type Store struct {
	db *sqlx.DB
}

// NewStore opens (or creates) the SQLite database at dbPath, applies the schema
// migrations, and returns a ready-to-use Store.
//
// WAL journal mode and a 5-second busy timeout are set via the DSN so that
// concurrent readers and the single writer do not block each other.
func NewStore(dbPath string) (*Store, error) {
	dsn := dbPath + "?_journal_mode=WAL&_busy_timeout=5000"
	db, err := sqlx.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open sqlite: %w", err)
	}

	// SQLite performs best with a single writer connection.
	db.SetMaxOpenConns(1)

	if err := Migrate(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: migrate: %w", err)
	}

	return &Store{db: db}, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// InsertSpans batch-inserts (or replaces) spans inside a single transaction.
func (s *Store) InsertSpans(ctx context.Context, spans []Span) error {
	if len(spans) == 0 {
		return nil
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	const q = `
INSERT OR REPLACE INTO spans (
    span_id, trace_id, parent_span_id, service_name, operation_name,
    span_kind, start_time, end_time, duration_ns, status_code, status_message,
    http_method, http_url, http_status_code, http_route,
    db_system, db_statement,
    k8s_pod_name, k8s_namespace, k8s_node_name, k8s_container, k8s_deployment,
    attributes, events
) VALUES (
    :span_id, :trace_id, :parent_span_id, :service_name, :operation_name,
    :span_kind, :start_time, :end_time, :duration_ns, :status_code, :status_message,
    :http_method, :http_url, :http_status_code, :http_route,
    :db_system, :db_statement,
    :k8s_pod_name, :k8s_namespace, :k8s_node_name, :k8s_container, :k8s_deployment,
    :attributes, :events
)`

	for i := range spans {
		if _, err = tx.NamedExecContext(ctx, q, &spans[i]); err != nil {
			return fmt.Errorf("store: insert span %s: %w", spans[i].SpanID, err)
		}
	}

	if err = tx.Commit(); err != nil {
		return fmt.Errorf("store: commit: %w", err)
	}
	return nil
}

// InsertTraceSummary upserts a TraceSummary record.
func (s *Store) InsertTraceSummary(ctx context.Context, t *TraceSummary) error {
	const q = `
INSERT OR REPLACE INTO traces (
    trace_id, root_service, root_operation, start_time, duration_ns,
    span_count, error_count, service_count, status, services, updated_at
) VALUES (
    :trace_id, :root_service, :root_operation, :start_time, :duration_ns,
    :span_count, :error_count, :service_count, :status, :services, :updated_at
)`
	if _, err := s.db.NamedExecContext(ctx, q, t); err != nil {
		return fmt.Errorf("store: insert trace summary %s: %w", t.TraceID, err)
	}
	return nil
}

// QueryTraces returns trace summaries matching the optional filters in q,
// ordered by start_time DESC. Limit defaults to 100 when q.Limit == 0.
func (s *Store) QueryTraces(ctx context.Context, q TraceQuery) ([]TraceSummary, error) {
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}

	var conditions []string
	var args []interface{}

	if q.Service != "" {
		conditions = append(conditions, "root_service = ?")
		args = append(args, q.Service)
	}
	if q.Status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, q.Status)
	}
	if q.From > 0 {
		conditions = append(conditions, "start_time >= ?")
		args = append(args, q.From)
	}
	if q.To > 0 {
		conditions = append(conditions, "start_time <= ?")
		args = append(args, q.To)
	}

	query := "SELECT * FROM traces"
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY start_time DESC LIMIT ?"
	args = append(args, limit)

	var results []TraceSummary
	if err := s.db.SelectContext(ctx, &results, query, args...); err != nil {
		return nil, fmt.Errorf("store: query traces: %w", err)
	}
	return results, nil
}

// GetTrace returns the full TraceDetail (all spans) for the given traceID.
func (s *Store) GetTrace(ctx context.Context, traceID string) (*TraceDetail, error) {
	var spans []Span
	const q = `SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC`
	if err := s.db.SelectContext(ctx, &spans, q, traceID); err != nil {
		return nil, fmt.Errorf("store: get trace %s spans: %w", traceID, err)
	}
	return &TraceDetail{TraceID: traceID, Spans: spans}, nil
}

// GetServiceMap builds a service dependency graph from spans within the given
// [from, to] nanosecond window. Pass 0 for both to query all time.
func (s *Store) GetServiceMap(ctx context.Context, from, to int64) (*ServiceMap, error) {
	// Build optional time filter for both queries.
	var timeFilter string
	var timeArgs []interface{}
	if from > 0 && to > 0 {
		timeFilter = " WHERE start_time >= ? AND start_time <= ?"
		timeArgs = []interface{}{from, to}
	} else if from > 0 {
		timeFilter = " WHERE start_time >= ?"
		timeArgs = []interface{}{from}
	} else if to > 0 {
		timeFilter = " WHERE start_time <= ?"
		timeArgs = []interface{}{to}
	}

	// Nodes: one row per distinct service.
	nodeQuery := `
SELECT
    service_name                                                         AS name,
    COUNT(*)                                                             AS span_count,
    SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END)              AS error_count,
    CAST(AVG(duration_ns) AS INTEGER)                                    AS avg_duration_ns
FROM spans` + timeFilter + `
GROUP BY service_name`

	type nodeRow struct {
		Name          string `db:"name"`
		SpanCount     int    `db:"span_count"`
		ErrorCount    int    `db:"error_count"`
		AvgDurationNs int64  `db:"avg_duration_ns"`
	}
	var nodeRows []nodeRow
	if err := s.db.SelectContext(ctx, &nodeRows, nodeQuery, timeArgs...); err != nil {
		return nil, fmt.Errorf("store: service map nodes: %w", err)
	}

	nodes := make([]ServiceMapNode, 0, len(nodeRows))
	for _, r := range nodeRows {
		if r.Name == "" {
			continue
		}
		nodes = append(nodes, ServiceMapNode{
			Name:          r.Name,
			SpanCount:     r.SpanCount,
			ErrorCount:    r.ErrorCount,
			AvgDurationNs: r.AvgDurationNs,
		})
	}

	// Edges: cross-service parent→child calls.
	// We join each child span to its parent span and keep only rows where the
	// two services differ.
	edgeQuery := `
SELECT
    p.service_name AS source,
    c.service_name AS target,
    COUNT(*)       AS count
FROM spans c
JOIN spans p ON c.parent_span_id = p.span_id
WHERE p.service_name != c.service_name
  AND p.service_name != ''
  AND c.service_name != ''`

	var edgeTimeArgs []interface{}
	if from > 0 && to > 0 {
		edgeQuery += " AND c.start_time >= ? AND c.start_time <= ?"
		edgeTimeArgs = []interface{}{from, to}
	} else if from > 0 {
		edgeQuery += " AND c.start_time >= ?"
		edgeTimeArgs = []interface{}{from}
	} else if to > 0 {
		edgeQuery += " AND c.start_time <= ?"
		edgeTimeArgs = []interface{}{to}
	}
	edgeQuery += " GROUP BY p.service_name, c.service_name"

	type edgeRow struct {
		Source string `db:"source"`
		Target string `db:"target"`
		Count  int    `db:"count"`
	}
	var edgeRows []edgeRow
	if err := s.db.SelectContext(ctx, &edgeRows, edgeQuery, edgeTimeArgs...); err != nil {
		return nil, fmt.Errorf("store: service map edges: %w", err)
	}

	edges := make([]ServiceMapEdge, 0, len(edgeRows))
	for _, r := range edgeRows {
		edges = append(edges, ServiceMapEdge{Source: r.Source, Target: r.Target, Count: r.Count})
	}

	return &ServiceMap{Nodes: nodes, Edges: edges}, nil
}

// GetHealth returns a summary of the store's current state.
func (s *Store) GetHealth(ctx context.Context) (*HealthInfo, error) {
	var count int64
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM spans").Scan(&count); err != nil {
		return nil, fmt.Errorf("store: health count: %w", err)
	}

	var oldest int64
	// MIN returns NULL when the table is empty; Scan into *int64 handles that.
	row := s.db.QueryRowContext(ctx, "SELECT COALESCE(MIN(start_time), 0) FROM spans")
	if err := row.Scan(&oldest); err != nil {
		return nil, fmt.Errorf("store: health oldest: %w", err)
	}

	status := "ok"
	return &HealthInfo{
		Status:     status,
		SpanCount:  count,
		OldestSpan: oldest,
	}, nil
}

// GetTracesSince returns trace summaries whose updated_at is strictly greater
// than sinceNs, ordered ascending by updated_at. Used by the backend puller for
// incremental sync.
func (s *Store) GetTracesSince(ctx context.Context, sinceNs int64, limit int) ([]TraceSummary, error) {
	if limit <= 0 {
		limit = 100
	}
	var results []TraceSummary
	const q = `
SELECT * FROM traces
WHERE updated_at > ?
ORDER BY updated_at ASC
LIMIT ?`
	if err := s.db.SelectContext(ctx, &results, q, sinceNs, limit); err != nil {
		return nil, fmt.Errorf("store: get traces since %d: %w", sinceNs, err)
	}
	return results, nil
}

// PruneOlderThan deletes spans and traces whose start_time is before cutoffNs.
// This is used by a background goroutine to enforce retention limits.
func (s *Store) PruneOlderThan(ctx context.Context, cutoffNs int64) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: prune begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.ExecContext(ctx, "DELETE FROM spans WHERE start_time < ?", cutoffNs); err != nil {
		return fmt.Errorf("store: prune spans: %w", err)
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM traces WHERE start_time < ?", cutoffNs); err != nil {
		return fmt.Errorf("store: prune traces: %w", err)
	}

	if err = tx.Commit(); err != nil {
		return fmt.Errorf("store: prune commit: %w", err)
	}
	return nil
}
