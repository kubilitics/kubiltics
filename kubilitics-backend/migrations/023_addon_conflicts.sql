CREATE TABLE IF NOT EXISTS addon_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    conflicts_with_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    reason TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_conflicts_pair ON addon_conflicts(addon_id, conflicts_with_id);
