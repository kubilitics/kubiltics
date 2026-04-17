-- Agent registration & trust model (spec 2026-04-18).
CREATE TABLE IF NOT EXISTS organizations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default');

CREATE TABLE IF NOT EXISTS agent_clusters (
    id                 TEXT PRIMARY KEY,
    organization_id    TEXT NOT NULL REFERENCES organizations(id),
    cluster_uid        TEXT NOT NULL,
    name               TEXT NOT NULL,
    k8s_version        TEXT NOT NULL DEFAULT '',
    agent_version      TEXT NOT NULL DEFAULT '',
    node_count         INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'registering',
    credential_epoch   INTEGER NOT NULL DEFAULT 1,
    registered_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at  TIMESTAMP,
    UNIQUE (organization_id, cluster_uid)
);

CREATE TABLE IF NOT EXISTS bootstrap_tokens (
    jti              TEXT PRIMARY KEY,
    organization_id  TEXT NOT NULL REFERENCES organizations(id),
    created_by       TEXT NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at       TIMESTAMP NOT NULL,
    used_at          TIMESTAMP,
    used_by_cluster  TEXT REFERENCES agent_clusters(id),
    revoked_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_credentials (
    id                  TEXT PRIMARY KEY,
    cluster_id          TEXT NOT NULL REFERENCES agent_clusters(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL,
    issued_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          TIMESTAMP NOT NULL,
    last_used_at        TIMESTAMP,
    revoked_at          TIMESTAMP,
    credential_epoch    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_clusters_heartbeat ON agent_clusters(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_agent_creds_cluster_active
    ON agent_credentials(cluster_id) WHERE revoked_at IS NULL;
