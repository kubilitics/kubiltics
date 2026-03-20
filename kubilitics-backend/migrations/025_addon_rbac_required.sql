CREATE TABLE IF NOT EXISTS addon_rbac_required (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    api_groups TEXT NOT NULL,
    resources TEXT NOT NULL,
    verbs TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('cluster','namespace'))
);

CREATE INDEX IF NOT EXISTS idx_addon_rbac_addon ON addon_rbac_required(addon_id);
