CREATE TABLE IF NOT EXISTS addon_crds_owned (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    crd_group TEXT NOT NULL,
    crd_resource TEXT NOT NULL,
    crd_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_addon_crds_addon ON addon_crds_owned(addon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_crds_resource ON addon_crds_owned(crd_group, crd_resource);
