package otel

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// Store provides persistence operations for OTel spans and traces.
type Store struct {
	db *sqlx.DB
}

// NewStore creates a new OTel Store.
func NewStore(db *sqlx.DB) *Store {
	return &Store{db: db}
}

// InsertSpans batch-inserts spans using a transaction.
func (s *Store) InsertSpans(ctx context.Context, spans []Span) error {
	if len(spans) == 0 {
		return nil
	}

	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	const q = `
		INSERT OR REPLACE INTO spans (
			span_id, trace_id, parent_span_id,
			service_name, operation_name, span_kind,
			start_time, end_time, duration_ns,
			status_code, status_message,
			http_method, http_url, http_status_code, http_route,
			db_system, db_statement,
			k8s_pod_name, k8s_namespace, k8s_node_name, k8s_container, k8s_deployment,
			user_id, cluster_id,
			attributes, events, linked_event_ids
		) VALUES (
			:span_id, :trace_id, :parent_span_id,
			:service_name, :operation_name, :span_kind,
			:start_time, :end_time, :duration_ns,
			:status_code, :status_message,
			:http_method, :http_url, :http_status_code, :http_route,
			:db_system, :db_statement,
			:k8s_pod_name, :k8s_namespace, :k8s_node_name, :k8s_container, :k8s_deployment,
			:user_id, :cluster_id,
			:attributes, :events, :linked_event_ids
		)`

	for i := range spans {
		if _, err := tx.NamedExecContext(ctx, q, &spans[i]); err != nil {
			return fmt.Errorf("insert span %s: %w", spans[i].SpanID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// InsertTraceSummary upserts a trace summary record.
//
// Spans for the same trace can arrive in multiple batches (e.g. parent in
// batch 1, children in batch 2). We use ON CONFLICT to merge intelligently:
//   - root_service/root_operation: prefer the new value if non-empty, else
//     keep existing (the root span may not be in the current batch)
//   - span_count/error_count: accumulate (sum)
//   - start_time: take the minimum (earliest)
//   - duration_ns: extend if a later end_time arrives
//   - service_count/services: take the larger one (good enough until we
//     do proper set merging)
//   - status: ERROR sticks (any error in any batch → trace is ERROR)
func (s *Store) InsertTraceSummary(ctx context.Context, t *TraceSummary) error {
	const q = `
		INSERT INTO traces (
			trace_id, root_service, root_operation,
			start_time, duration_ns, span_count, error_count, service_count,
			status, cluster_id, services, updated_at
		) VALUES (
			:trace_id, :root_service, :root_operation,
			:start_time, :duration_ns, :span_count, :error_count, :service_count,
			:status, :cluster_id, :services, :updated_at
		)
		ON CONFLICT(trace_id) DO UPDATE SET
			root_service = CASE WHEN excluded.root_service != '' THEN excluded.root_service ELSE traces.root_service END,
			root_operation = CASE WHEN excluded.root_operation != '' THEN excluded.root_operation ELSE traces.root_operation END,
			start_time = MIN(traces.start_time, excluded.start_time),
			duration_ns = MAX(traces.duration_ns, excluded.duration_ns),
			span_count = traces.span_count + excluded.span_count,
			error_count = traces.error_count + excluded.error_count,
			service_count = MAX(traces.service_count, excluded.service_count),
			status = CASE WHEN traces.status = 'ERROR' OR excluded.status = 'ERROR' THEN 'ERROR' ELSE excluded.status END,
			services = CASE WHEN length(excluded.services) > length(traces.services) THEN excluded.services ELSE traces.services END,
			updated_at = excluded.updated_at
	`
	_, err := s.db.NamedExecContext(ctx, q, t)
	if err != nil {
		return fmt.Errorf("upsert trace summary %s: %w", t.TraceID, err)
	}
	return nil
}

// QueryTraces returns trace summaries matching the given query filters.
func (s *Store) QueryTraces(ctx context.Context, q TraceQuery) ([]TraceSummary, error) {
	where, params := buildTraceWhere(q)

	limit := q.Limit
	if limit <= 0 {
		limit = 50
	}
	params["limit"] = limit
	params["offset"] = q.Offset

	query := `SELECT * FROM traces` + where + ` ORDER BY start_time DESC LIMIT :limit OFFSET :offset`

	query, args, err := sqlx.Named(query, params)
	if err != nil {
		return nil, fmt.Errorf("build named query: %w", err)
	}
	query = s.db.Rebind(query)

	var traces []TraceSummary
	if err := s.db.SelectContext(ctx, &traces, query, args...); err != nil {
		return nil, fmt.Errorf("query traces: %w", err)
	}
	return traces, nil
}

// GetTrace returns a trace summary together with all its spans.
func (s *Store) GetTrace(ctx context.Context, traceID string) (*TraceDetail, error) {
	var summary TraceSummary
	if err := s.db.GetContext(ctx, &summary, `SELECT * FROM traces WHERE trace_id = ?`, traceID); err != nil {
		return nil, fmt.Errorf("get trace %s: %w", traceID, err)
	}

	spans, err := s.GetSpansByTrace(ctx, traceID)
	if err != nil {
		return nil, err
	}

	return &TraceDetail{
		Summary: summary,
		Spans:   spans,
	}, nil
}

// GetSpansByTrace returns all spans for a given trace, ordered by start time.
func (s *Store) GetSpansByTrace(ctx context.Context, traceID string) ([]Span, error) {
	var spans []Span
	err := s.db.SelectContext(ctx, &spans,
		`SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC`, traceID)
	if err != nil {
		return nil, fmt.Errorf("get spans for trace %s: %w", traceID, err)
	}
	return spans, nil
}

// GetServiceMap builds a service dependency graph from spans within a time range.
func (s *Store) GetServiceMap(ctx context.Context, clusterID string, from, to int64) (*ServiceMap, error) {
	// Get per-service aggregates
	type svcAgg struct {
		Name        string  `db:"service_name"`
		SpanCount   int     `db:"span_count"`
		ErrorCount  int     `db:"error_count"`
		AvgDuration float64 `db:"avg_duration"`
	}
	nodeQuery := `
		SELECT service_name, COALESCE(COUNT(*), 0) AS span_count,
			COALESCE(SUM(CASE WHEN status_code = 'ERROR' THEN 1 ELSE 0 END), 0) AS error_count,
			COALESCE(AVG(duration_ns), 0) AS avg_duration
		FROM spans
		WHERE cluster_id = ? AND start_time >= ? AND start_time <= ? AND service_name != ''
		GROUP BY service_name`

	var nodes []svcAgg
	if err := s.db.SelectContext(ctx, &nodes, nodeQuery, clusterID, from, to); err != nil {
		return nil, fmt.Errorf("get service nodes: %w", err)
	}

	serviceNodes := make([]ServiceNode, len(nodes))
	for i, n := range nodes {
		serviceNodes[i] = ServiceNode{
			Name:        n.Name,
			SpanCount:   n.SpanCount,
			ErrorCount:  n.ErrorCount,
			AvgDuration: int64(n.AvgDuration),
		}
	}

	// Get edges: parent span's service -> child span's service
	type edgeAgg struct {
		Source string `db:"source_service"`
		Target string `db:"target_service"`
		Count  int    `db:"call_count"`
	}
	edgeQuery := `
		SELECT p.service_name AS source_service, c.service_name AS target_service, COALESCE(COUNT(*), 0) AS call_count
		FROM spans c
		INNER JOIN spans p ON c.parent_span_id = p.span_id AND c.trace_id = p.trace_id
		WHERE c.cluster_id = ? AND c.start_time >= ? AND c.start_time <= ?
			AND c.service_name != '' AND p.service_name != ''
			AND c.service_name != p.service_name
		GROUP BY p.service_name, c.service_name`

	var edges []edgeAgg
	if err := s.db.SelectContext(ctx, &edges, edgeQuery, clusterID, from, to); err != nil {
		return nil, fmt.Errorf("get service edges: %w", err)
	}

	serviceEdges := make([]ServiceEdge, len(edges))
	for i, e := range edges {
		serviceEdges[i] = ServiceEdge(e)
	}

	return &ServiceMap{
		Nodes: serviceNodes,
		Edges: serviceEdges,
	}, nil
}

// UpdateSpanLinkedEvents updates the linked_event_ids JSON column for a span.
func (s *Store) UpdateSpanLinkedEvents(ctx context.Context, spanID, linkedEventIDsJSON string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE spans SET linked_event_ids = ? WHERE span_id = ?`,
		linkedEventIDsJSON, spanID)
	if err != nil {
		return fmt.Errorf("update span linked events %s: %w", spanID, err)
	}
	return nil
}

// QuerySpansByResource returns trace summaries for spans matching the given
// K8s resource. For Pods it matches k8s_pod_name, for Deployments k8s_deployment,
// and for Services service_name. Results are grouped by trace_id via the traces table.
func (s *Store) QuerySpansByResource(ctx context.Context, clusterID, resourceKind, resourceName, namespace string, from, to int64, limit int) ([]TraceSummary, error) {
	if limit <= 0 {
		limit = 20
	}

	// Build filter based on resource kind
	var fieldFilter string
	switch strings.ToLower(resourceKind) {
	case "pod":
		fieldFilter = "s.k8s_pod_name = ?"
	case "deployment":
		fieldFilter = "s.k8s_deployment = ?"
	case "service":
		fieldFilter = "s.service_name = ?"
	case "daemonset", "statefulset", "replicaset":
		// For workload controllers, match deployment field (owner)
		fieldFilter = "s.k8s_deployment = ?"
	default:
		// Fallback: try pod name match
		fieldFilter = "s.k8s_pod_name = ?"
	}

	query := `
		SELECT DISTINCT t.* FROM traces t
		INNER JOIN spans s ON s.trace_id = t.trace_id
		WHERE s.cluster_id = ? AND ` + fieldFilter

	args := []interface{}{clusterID, resourceName}

	if namespace != "" {
		query += ` AND s.k8s_namespace = ?`
		args = append(args, namespace)
	}
	if from > 0 {
		query += ` AND s.start_time >= ?`
		args = append(args, from)
	}
	if to > 0 {
		query += ` AND s.start_time <= ?`
		args = append(args, to)
	}

	query += ` ORDER BY t.start_time DESC LIMIT ?`
	args = append(args, limit)

	var traces []TraceSummary
	if err := s.db.SelectContext(ctx, &traces, query, args...); err != nil {
		return nil, fmt.Errorf("query spans by resource: %w", err)
	}
	return traces, nil
}

// QuerySpansByLinkedEvent returns trace summaries for spans that have the given
// event ID in their linked_event_ids JSON array.
func (s *Store) QuerySpansByLinkedEvent(ctx context.Context, clusterID, eventID string, limit int) ([]TraceSummary, error) {
	if limit <= 0 {
		limit = 10
	}

	// SQLite JSON: linked_event_ids is a JSON array stored as TEXT.
	// Use LIKE for simple substring match (event IDs are UUIDs, no false positives).
	query := `
		SELECT DISTINCT t.* FROM traces t
		INNER JOIN spans s ON s.trace_id = t.trace_id
		WHERE s.cluster_id = ? AND s.linked_event_ids LIKE ?
		ORDER BY t.start_time DESC LIMIT ?`

	pattern := "%" + eventID + "%"
	var traces []TraceSummary
	if err := s.db.SelectContext(ctx, &traces, query, clusterID, pattern, limit); err != nil {
		return nil, fmt.Errorf("query spans by linked event: %w", err)
	}
	return traces, nil
}

// PruneSpans deletes spans and traces older than retentionDays.
// Returns the number of spans deleted.
func (s *Store) PruneSpans(ctx context.Context, retentionDays int) (int64, error) {
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).UnixNano()

	res, err := s.db.ExecContext(ctx,
		`DELETE FROM spans WHERE start_time < ?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("prune old spans: %w", err)
	}

	// Also prune trace summaries
	_, _ = s.db.ExecContext(ctx,
		`DELETE FROM traces WHERE start_time < ?`, cutoff)

	return res.RowsAffected()
}

// buildTraceWhere constructs a dynamic WHERE clause from a TraceQuery.
func buildTraceWhere(q TraceQuery) (string, map[string]interface{}) {
	var clauses []string
	params := make(map[string]interface{})

	if q.ClusterID != "" {
		clauses = append(clauses, "cluster_id = :cluster_id")
		params["cluster_id"] = q.ClusterID
	}
	if q.Service != "" {
		clauses = append(clauses, "root_service = :service")
		params["service"] = q.Service
	}
	if q.Operation != "" {
		clauses = append(clauses, "root_operation = :operation")
		params["operation"] = q.Operation
	}
	if q.Status != "" {
		clauses = append(clauses, "status = :status")
		params["status"] = q.Status
	}
	if q.MinDuration > 0 {
		clauses = append(clauses, "duration_ns >= :min_duration")
		params["min_duration"] = q.MinDuration
	}
	if q.MaxDuration > 0 {
		clauses = append(clauses, "duration_ns <= :max_duration")
		params["max_duration"] = q.MaxDuration
	}
	if q.From > 0 {
		clauses = append(clauses, "start_time >= :from_time")
		params["from_time"] = q.From
	}
	if q.To > 0 {
		clauses = append(clauses, "start_time <= :to_time")
		params["to_time"] = q.To
	}

	if len(clauses) == 0 {
		return "", params
	}
	return " WHERE " + strings.Join(clauses, " AND "), params
}
