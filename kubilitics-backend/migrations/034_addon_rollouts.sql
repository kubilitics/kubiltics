-- T8.06: Multi-Cluster Addon Rollout tables.
-- addon_rollouts: one row per fleet-wide rollout operation.
-- addon_rollout_cluster_status: one row per (rollout, cluster) pair tracking per-cluster progress.

CREATE TABLE IF NOT EXISTS addon_rollouts (
    id             TEXT    NOT NULL PRIMARY KEY,
    addon_id       TEXT    NOT NULL,
    target_version TEXT    NOT NULL,
    strategy       TEXT    NOT NULL DEFAULT 'all-at-once',  -- 'all-at-once' | 'canary'
    canary_percent INTEGER NOT NULL DEFAULT 0,               -- 0-100; only used when strategy='canary'
    status         TEXT    NOT NULL DEFAULT 'pending',       -- pending | running | completed | failed | aborted
    created_by     TEXT    NOT NULL DEFAULT '',
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS addon_rollout_cluster_status (
    rollout_id    TEXT NOT NULL REFERENCES addon_rollouts(id) ON DELETE CASCADE,
    cluster_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending | running | success | failed | skipped
    error_message TEXT NOT NULL DEFAULT '',
    started_at    DATETIME,
    completed_at  DATETIME,
    PRIMARY KEY (rollout_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_addon_rollouts_addon_id  ON addon_rollouts(addon_id);
CREATE INDEX IF NOT EXISTS idx_addon_rollouts_status    ON addon_rollouts(status);
CREATE INDEX IF NOT EXISTS idx_rollout_cluster_rollout  ON addon_rollout_cluster_status(rollout_id);
