-- Causal chains: persisted root-cause inference output from the Events
-- Intelligence causality engine.  The table is also created at runtime via
-- Store.EnsureTables (defensive belt-and-suspenders), but a proper migration
-- entry is required so that a fresh install via the migration runner gets the
-- table without ever needing to exercise the events pipeline first.

CREATE TABLE IF NOT EXISTS causal_chains (
    id          TEXT PRIMARY KEY,
    cluster_id  TEXT NOT NULL,
    insight_id  TEXT,
    chain_json  TEXT NOT NULL,
    confidence  REAL NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  DATETIME NOT NULL,
    updated_at  DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_causal_chains_cluster ON causal_chains(cluster_id, status);
CREATE INDEX IF NOT EXISTS idx_causal_chains_insight ON causal_chains(insight_id);
