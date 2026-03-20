-- Migration: 037_addon_versions
-- T8.13b: Add version history table for addons.

CREATE TABLE IF NOT EXISTS addon_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    release_date TEXT NOT NULL,
    changelog_url TEXT,
    breaking_changes TEXT,  -- JSON array
    highlights TEXT,        -- JSON array
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(addon_id, version)
);
