-- Initial schema for Kubilitics
-- Supports both SQLite and PostgreSQL

-- Clusters table
CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    context TEXT NOT NULL,
    kubeconfig_path TEXT,
    server_url TEXT NOT NULL,
    version TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_connected TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clusters_status ON clusters(status);
CREATE INDEX IF NOT EXISTS idx_clusters_name ON clusters(name);

-- Topology snapshots table
CREATE TABLE IF NOT EXISTS topology_snapshots (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    namespace TEXT,
    data TEXT NOT NULL, -- JSON serialized TopologyGraph
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    layout_seed TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topology_cluster ON topology_snapshots(cluster_id);
CREATE INDEX IF NOT EXISTS idx_topology_timestamp ON topology_snapshots(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_topology_namespace ON topology_snapshots(namespace);

-- Resource history table
CREATE TABLE IF NOT EXISTS resource_history (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    namespace TEXT,
    name TEXT NOT NULL,
    action TEXT NOT NULL, -- created, updated, deleted
    yaml TEXT NOT NULL,
    diff TEXT, -- YAML diff for updates
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_cluster ON resource_history(cluster_id);
CREATE INDEX IF NOT EXISTS idx_history_resource ON resource_history(resource_type, namespace, name);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON resource_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_history_action ON resource_history(action);

-- Events table (cached K8s events)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    type TEXT NOT NULL, -- Normal, Warning, Error
    reason TEXT NOT NULL,
    message TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    namespace TEXT,
    first_timestamp TIMESTAMP NOT NULL,
    last_timestamp TIMESTAMP NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_cluster ON events(cluster_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_resource ON events(resource_kind, resource_name, namespace);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(last_timestamp DESC);

-- User preferences table (for desktop/mobile)
CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_preferences_key ON user_preferences(key);

-- Exports table
CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    topology_snapshot_id TEXT NOT NULL,
    format TEXT NOT NULL, -- png, pdf, svg
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    FOREIGN KEY (topology_snapshot_id) REFERENCES topology_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exports_cluster ON exports(cluster_id);
CREATE INDEX IF NOT EXISTS idx_exports_snapshot ON exports(topology_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_exports_created ON exports(created_at DESC);
