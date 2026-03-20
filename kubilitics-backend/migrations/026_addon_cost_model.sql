CREATE TABLE IF NOT EXISTS addon_cost_model (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    cluster_tier TEXT NOT NULL CHECK (cluster_tier IN ('dev','staging','production')),
    cpu_millicores INTEGER NOT NULL,
    memory_mb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL DEFAULT 0,
    monthly_cost_usd_estimate REAL NOT NULL,
    replica_count INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_cost_tier ON addon_cost_model(addon_id, cluster_tier);
