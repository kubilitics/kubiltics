CREATE TABLE IF NOT EXISTS addon_upgrade_policies (
    addon_install_id TEXT PRIMARY KEY REFERENCES cluster_addon_installs(id) ON DELETE CASCADE,
    policy TEXT NOT NULL CHECK (policy IN ('CONSERVATIVE','PATCH_ONLY','MINOR','MANUAL')) DEFAULT 'CONSERVATIVE',
    pinned_version TEXT,
    last_check_at DATETIME,
    next_available_version TEXT,
    auto_upgrade_enabled INTEGER NOT NULL DEFAULT 0
);
