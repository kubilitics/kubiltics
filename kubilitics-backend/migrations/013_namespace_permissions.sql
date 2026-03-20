-- Namespace-level permissions for fine-grained RBAC
-- Allows granting permissions at namespace level (more granular than cluster-level)

CREATE TABLE IF NOT EXISTS namespace_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    namespace TEXT NOT NULL, -- '*' means all namespaces in cluster
    role TEXT NOT NULL, -- viewer | operator | admin
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    UNIQUE(user_id, cluster_id, namespace)
);

CREATE INDEX IF NOT EXISTS idx_namespace_permissions_user_id ON namespace_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_namespace_permissions_cluster_id ON namespace_permissions(cluster_id);
CREATE INDEX IF NOT EXISTS idx_namespace_permissions_namespace ON namespace_permissions(namespace);
CREATE INDEX IF NOT EXISTS idx_namespace_permissions_user_cluster ON namespace_permissions(user_id, cluster_id);
