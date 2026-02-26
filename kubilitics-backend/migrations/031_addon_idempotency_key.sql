-- Migration 031: Add idempotency_key to cluster_addon_installs.
-- Prevents duplicate Helm installs when a client retries POST /execute due to a network timeout.
-- The key is caller-supplied (X-Idempotency-Key header) and is scoped to (cluster_id, idempotency_key).
-- A NULL idempotency_key is allowed (callers that don't send the header get no dedup protection).

ALTER TABLE cluster_addon_installs ADD COLUMN idempotency_key TEXT;

-- Partial unique index: only enforce uniqueness when the key is non-NULL.
-- SQLite supports partial indexes via WHERE clauses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_installs_idempotency_key
    ON cluster_addon_installs (cluster_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
