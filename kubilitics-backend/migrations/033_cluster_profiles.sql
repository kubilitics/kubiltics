-- Migration 033: cluster_profiles table.
-- Stores named bootstrap profiles (curated sets of addons).
-- Built-in profiles are seeded on startup via SeedBuiltinProfiles.
-- profile addons are stored as a JSON array in the addons column.

CREATE TABLE IF NOT EXISTS cluster_profiles (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    addons      TEXT NOT NULL DEFAULT '[]',
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
