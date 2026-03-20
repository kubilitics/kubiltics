-- Migration: 038_maintenance_windows
-- T9.03: Scheduled maintenance windows for auto-upgrades.

CREATE TABLE IF NOT EXISTS addon_maintenance_windows (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- day_of_week: -1 = every day, 0 = Sunday, 1 = Monday, ..., 6 = Saturday (matches Go time.Weekday).
    day_of_week INTEGER NOT NULL DEFAULT -1,
    start_hour INTEGER NOT NULL DEFAULT 2 CHECK (start_hour >= 0 AND start_hour <= 23),
    start_minute INTEGER NOT NULL DEFAULT 0 CHECK (start_minute >= 0 AND start_minute <= 59),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK (duration_minutes > 0),
    -- apply_to: 'all' or a JSON array of addon_ids, e.g. '["cert-manager","prometheus"]'
    apply_to TEXT NOT NULL DEFAULT 'all',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- next_eligible_at: earliest time the auto-upgrade may run (set when upgrade is deferred due to window).
ALTER TABLE addon_upgrade_policies ADD COLUMN next_eligible_at DATETIME;
