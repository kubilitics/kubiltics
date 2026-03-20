-- Groups/Teams management
-- Supports group-based permissions and OIDC group sync

CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);

CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- member, admin
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);

CREATE TABLE IF NOT EXISTS group_cluster_permissions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    role TEXT NOT NULL, -- viewer, operator, admin
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    UNIQUE(group_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_group_cluster_permissions_group_id ON group_cluster_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_cluster_permissions_cluster_id ON group_cluster_permissions(cluster_id);

CREATE TABLE IF NOT EXISTS group_namespace_permissions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    role TEXT NOT NULL, -- viewer, operator, admin
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    UNIQUE(group_id, cluster_id, namespace)
);

CREATE INDEX IF NOT EXISTS idx_group_namespace_permissions_group_id ON group_namespace_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_namespace_permissions_cluster_namespace ON group_namespace_permissions(cluster_id, namespace);

-- OIDC group sync tracking
CREATE TABLE IF NOT EXISTS oidc_group_mappings (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    oidc_group_name TEXT NOT NULL, -- OIDC group name from IdP
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    UNIQUE(group_id, oidc_group_name)
);

CREATE INDEX IF NOT EXISTS idx_oidc_group_mappings_group_id ON oidc_group_mappings(group_id);
CREATE INDEX IF NOT EXISTS idx_oidc_group_mappings_oidc_group_name ON oidc_group_mappings(oidc_group_name);
