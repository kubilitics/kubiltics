-- BE-AUTHZ-001: Role-Based Authorization with per-cluster permissions.

-- Cluster permissions table: allows users to have different roles per cluster
CREATE TABLE IF NOT EXISTS cluster_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    UNIQUE(user_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_perms_user ON cluster_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_cluster_perms_cluster ON cluster_permissions(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_perms_role ON cluster_permissions(role);
