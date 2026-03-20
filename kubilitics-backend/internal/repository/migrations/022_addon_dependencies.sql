CREATE TABLE IF NOT EXISTS addon_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE RESTRICT,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('required','optional')),
    version_constraint TEXT,
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_addon_deps_addon ON addon_dependencies(addon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_deps_pair ON addon_dependencies(addon_id, depends_on_id);
