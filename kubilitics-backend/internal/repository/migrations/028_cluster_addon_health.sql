CREATE TABLE IF NOT EXISTS cluster_addon_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_install_id TEXT NOT NULL REFERENCES cluster_addon_installs(id) ON DELETE CASCADE,
    last_checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    health_status TEXT NOT NULL CHECK (health_status IN ('HEALTHY','DEGRADED','UNKNOWN')),
    ready_pods INTEGER NOT NULL DEFAULT 0,
    total_pods INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_install ON cluster_addon_health(addon_install_id);
