-- BE-SEC-002: Audit log for mutating operations (append-only)

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    username TEXT NOT NULL,
    cluster_id TEXT,
    action TEXT NOT NULL,
    resource_kind TEXT,
    resource_namespace TEXT,
    resource_name TEXT,
    status_code INTEGER,
    request_ip TEXT NOT NULL,
    details TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_cluster ON audit_log(cluster_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username);
