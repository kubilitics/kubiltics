-- Migration 032: addon_catalog_meta key-value store.
-- Stores internal metadata about the addon catalog, including the content hash used for
-- idempotent seeding. SeedOnStartup skips the DELETE+INSERT cycle when the hash has not changed,
-- preventing a brief 404 window for concurrent requests during server restarts.

CREATE TABLE IF NOT EXISTS addon_catalog_meta (
    key        TEXT NOT NULL PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
