CREATE TABLE IF NOT EXISTS cluster_addon_installs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id),
    release_name TEXT NOT NULL,
    namespace TEXT NOT NULL,
    helm_revision INTEGER NOT NULL DEFAULT 1,
    installed_version TEXT NOT NULL,
    values_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('INSTALLING','INSTALLED','DEGRADED','UPGRADING','ROLLING_BACK','FAILED','DRIFTED','SUSPENDED','DEPRECATED','UNINSTALLING')),
    installed_by TEXT,
    installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_installs_cluster ON cluster_addon_installs(cluster_id);
CREATE INDEX IF NOT EXISTS idx_installs_addon ON cluster_addon_installs(addon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_installs_cluster_release ON cluster_addon_installs(cluster_id, release_name, namespace);
