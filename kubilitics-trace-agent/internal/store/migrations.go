package store

import "github.com/jmoiron/sqlx"

// schema is the full DDL executed on every startup (idempotent via IF NOT EXISTS).
const schema = `
CREATE TABLE IF NOT EXISTS spans (
    span_id          TEXT    PRIMARY KEY,
    trace_id         TEXT    NOT NULL,
    parent_span_id   TEXT    DEFAULT '',
    service_name     TEXT    DEFAULT '',
    operation_name   TEXT    DEFAULT '',
    span_kind        TEXT    DEFAULT '',
    start_time       INTEGER NOT NULL,
    end_time         INTEGER NOT NULL,
    duration_ns      INTEGER NOT NULL,
    status_code      TEXT    DEFAULT 'UNSET',
    status_message   TEXT    DEFAULT '',
    http_method      TEXT    DEFAULT '',
    http_url         TEXT    DEFAULT '',
    http_status_code INTEGER,
    http_route       TEXT    DEFAULT '',
    db_system        TEXT    DEFAULT '',
    db_statement     TEXT    DEFAULT '',
    k8s_pod_name     TEXT    DEFAULT '',
    k8s_namespace    TEXT    DEFAULT '',
    k8s_node_name    TEXT    DEFAULT '',
    k8s_container    TEXT    DEFAULT '',
    k8s_deployment   TEXT    DEFAULT '',
    attributes       TEXT    DEFAULT '{}',
    events           TEXT    DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_spans_trace   ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
CREATE INDEX IF NOT EXISTS idx_spans_start   ON spans(start_time);

CREATE TABLE IF NOT EXISTS traces (
    trace_id       TEXT    PRIMARY KEY,
    root_service   TEXT    DEFAULT '',
    root_operation TEXT    DEFAULT '',
    start_time     INTEGER NOT NULL,
    duration_ns    INTEGER NOT NULL DEFAULT 0,
    span_count     INTEGER NOT NULL DEFAULT 0,
    error_count    INTEGER NOT NULL DEFAULT 0,
    service_count  INTEGER NOT NULL DEFAULT 0,
    status         TEXT    DEFAULT 'OK',
    services       TEXT    DEFAULT '[]',
    updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traces_start   ON traces(start_time);
CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(root_service);
CREATE INDEX IF NOT EXISTS idx_traces_updated ON traces(updated_at);
`

// Migrate applies the schema DDL to db. It is idempotent and safe to call on
// every startup.
func Migrate(db *sqlx.DB) error {
	_, err := db.Exec(schema)
	return err
}
