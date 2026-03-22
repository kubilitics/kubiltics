-- Kubilitics Backend - Full PostgreSQL Schema
-- This unified migration file creates all tables for PostgreSQL databases
-- Generated from 41 SQLite migration files consolidated into a single PostgreSQL-compatible schema

-- ============================================================================
-- CORE INFRASTRUCTURE TABLES (Migrations 001-004)
-- ============================================================================

-- Clusters table
CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    context TEXT NOT NULL,
    kubeconfig_path TEXT,
    server_url TEXT NOT NULL,
    version TEXT,
    provider TEXT DEFAULT 'on-prem',
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_connected TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clusters_status ON clusters(status);
CREATE INDEX IF NOT EXISTS idx_clusters_name ON clusters(name);
CREATE INDEX IF NOT EXISTS idx_clusters_provider ON clusters(provider);

-- Topology snapshots table
CREATE TABLE IF NOT EXISTS topology_snapshots (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    namespace TEXT,
    data TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    layout_seed TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    action TEXT NOT NULL,
    yaml TEXT NOT NULL,
    diff TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    type TEXT NOT NULL,
    reason TEXT NOT NULL,
    message TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    namespace TEXT,
    first_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    last_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_preferences_key ON user_preferences(key);

-- Exports table
CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    topology_snapshot_id TEXT NOT NULL,
    format TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    FOREIGN KEY (topology_snapshot_id) REFERENCES topology_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exports_cluster ON exports(cluster_id);
CREATE INDEX IF NOT EXISTS idx_exports_snapshot ON exports(topology_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_exports_created ON exports(created_at DESC);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

-- Project-cluster associations
CREATE TABLE IF NOT EXISTS project_clusters (
    project_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, cluster_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_clusters_project ON project_clusters(project_id);
CREATE INDEX IF NOT EXISTS idx_project_clusters_cluster ON project_clusters(cluster_id);

-- Project-namespace associations
CREATE TABLE IF NOT EXISTS project_namespaces (
    project_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    namespace_name TEXT NOT NULL,
    team TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, cluster_id, namespace_name),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_namespaces_project ON project_namespaces(project_id);
CREATE INDEX IF NOT EXISTS idx_project_namespaces_cluster ON project_namespaces(cluster_id);
CREATE INDEX IF NOT EXISTS idx_project_namespaces_team ON project_namespaces(team);

-- ============================================================================
-- AUTHENTICATION & AUTHORIZATION TABLES (Migrations 005-013)
-- ============================================================================

-- Users table for dashboard authentication
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'operator', 'admin')),
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    last_failed_login TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    password_expires_at TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    locked_until TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_locked ON users(locked_until);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);

-- Auth events table for audit trail
CREATE TABLE IF NOT EXISTS auth_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failure', 'logout', 'password_change', 'account_locked', 'account_unlocked')),
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_events_type ON auth_events(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_events_timestamp ON auth_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_auth_events_ip ON auth_events(ip_address);

-- Cluster permissions table: allows users to have different roles per cluster
CREATE TABLE IF NOT EXISTS cluster_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    UNIQUE(user_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_perms_user ON cluster_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_cluster_perms_cluster ON cluster_permissions(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_perms_role ON cluster_permissions(role);

-- API Keys Support
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    last_used TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    username TEXT NOT NULL,
    cluster_id TEXT,
    action TEXT NOT NULL,
    resource_kind TEXT,
    resource_namespace TEXT,
    resource_name TEXT,
    status_code INTEGER,
    request_ip TEXT NOT NULL,
    details TEXT,
    session_id TEXT,
    device_info TEXT,
    geolocation TEXT,
    risk_score INTEGER DEFAULT 0,
    correlation_id TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_cluster ON audit_log(cluster_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username);
CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_correlation_id ON audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_risk_score ON audit_log(risk_score);

-- Token revocation and blacklist
CREATE TABLE IF NOT EXISTS token_blacklist (
    id TEXT PRIMARY KEY,
    token_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_token_id ON token_blacklist(token_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_user_id ON token_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires_at ON token_blacklist(expires_at);

-- Refresh token families for rotation and reuse detection
CREATE TABLE IF NOT EXISTS refresh_token_families (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_families_family_id ON refresh_token_families(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_user_id ON refresh_token_families(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_families_token_id ON refresh_token_families(token_id);

-- Active session tracking
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_id ON sessions(token_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity);

-- Namespace-level permissions for fine-grained RBAC
CREATE TABLE IF NOT EXISTS namespace_permissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    UNIQUE(user_id, cluster_id, namespace)
);

CREATE INDEX IF NOT EXISTS idx_namespace_permissions_user_id ON namespace_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_namespace_permissions_cluster_id ON namespace_permissions(cluster_id);
CREATE INDEX IF NOT EXISTS idx_namespace_permissions_namespace ON namespace_permissions(namespace);
CREATE INDEX IF NOT EXISTS idx_namespace_permissions_user_cluster ON namespace_permissions(user_id, cluster_id);

-- Password history
CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_history_user_id ON password_history(user_id);
CREATE INDEX IF NOT EXISTS idx_password_history_created_at ON password_history(created_at);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- SAML session tracking for SSO
CREATE TABLE IF NOT EXISTS saml_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    saml_session_index TEXT NOT NULL,
    idp_entity_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_user_id ON saml_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_session_index ON saml_sessions(saml_session_index);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_expires_at ON saml_sessions(expires_at);

-- MFA TOTP secrets and backup codes
CREATE TABLE IF NOT EXISTS mfa_totp_secrets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP WITH TIME ZONE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mfa_totp_secrets_user_id ON mfa_totp_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_totp_secrets_enabled ON mfa_totp_secrets(enabled);

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user_id ON mfa_backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_used ON mfa_backup_codes(used);

-- Groups/Teams management
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_groups_name ON groups(name);

CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    role TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    role TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    oidc_group_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    UNIQUE(group_id, oidc_group_name)
);

CREATE INDEX IF NOT EXISTS idx_oidc_group_mappings_group_id ON oidc_group_mappings(group_id);
CREATE INDEX IF NOT EXISTS idx_oidc_group_mappings_oidc_group_name ON oidc_group_mappings(oidc_group_name);

-- Security event detection and monitoring
CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_id TEXT,
    username TEXT,
    ip_address TEXT NOT NULL,
    user_agent TEXT,
    cluster_id TEXT,
    resource_type TEXT,
    resource_name TEXT,
    action TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_risk_score ON security_events(risk_score);

-- IP-based rate limiting and tracking
CREATE TABLE IF NOT EXISTS ip_security_tracking (
    ip_address TEXT PRIMARY KEY,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    last_failed_login TIMESTAMP WITH TIME ZONE,
    account_enumeration_count INTEGER NOT NULL DEFAULT 0,
    last_enumeration_attempt TIMESTAMP WITH TIME ZONE,
    blocked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ip_security_tracking_blocked ON ip_security_tracking(blocked_until);

-- ============================================================================
-- ADD-ON MANAGEMENT TABLES (Migrations 021-041)
-- ============================================================================

-- Add-on catalog
CREATE TABLE IF NOT EXISTS addon_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    tier TEXT NOT NULL CHECK (tier IN ('CORE','COMMUNITY','PRIVATE')),
    version TEXT NOT NULL,
    k8s_compat_min TEXT NOT NULL,
    k8s_compat_max TEXT,
    helm_repo_url TEXT NOT NULL,
    helm_chart TEXT NOT NULL,
    helm_chart_version TEXT NOT NULL,
    icon_url TEXT,
    tags TEXT,
    home_url TEXT,
    source_url TEXT,
    maintainer TEXT,
    is_deprecated INTEGER NOT NULL DEFAULT 0,
    chart_digest TEXT,
    stars INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_addon_catalog_tier ON addon_catalog(tier);
CREATE INDEX IF NOT EXISTS idx_addon_catalog_name ON addon_catalog(name);

-- Add-on dependencies
CREATE TABLE IF NOT EXISTS addon_dependencies (
    id SERIAL PRIMARY KEY,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE RESTRICT,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('required','optional')),
    version_constraint TEXT,
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_addon_deps_addon ON addon_dependencies(addon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_deps_pair ON addon_dependencies(addon_id, depends_on_id);

-- Add-on conflicts
CREATE TABLE IF NOT EXISTS addon_conflicts (
    id SERIAL PRIMARY KEY,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    conflicts_with_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    reason TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_conflicts_pair ON addon_conflicts(addon_id, conflicts_with_id);

-- Add-on CRDs owned
CREATE TABLE IF NOT EXISTS addon_crds_owned (
    id SERIAL PRIMARY KEY,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    crd_group TEXT NOT NULL,
    crd_resource TEXT NOT NULL,
    crd_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_addon_crds_addon ON addon_crds_owned(addon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_crds_resource ON addon_crds_owned(crd_group, crd_resource);

-- Add-on RBAC required
CREATE TABLE IF NOT EXISTS addon_rbac_required (
    id SERIAL PRIMARY KEY,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    api_groups TEXT NOT NULL,
    resources TEXT NOT NULL,
    verbs TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('cluster','namespace'))
);

CREATE INDEX IF NOT EXISTS idx_addon_rbac_addon ON addon_rbac_required(addon_id);

-- Add-on cost model
CREATE TABLE IF NOT EXISTS addon_cost_model (
    id SERIAL PRIMARY KEY,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    cluster_tier TEXT NOT NULL CHECK (cluster_tier IN ('dev','staging','production')),
    cpu_millicores INTEGER NOT NULL,
    memory_mb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL DEFAULT 0,
    monthly_cost_usd_estimate REAL NOT NULL,
    replica_count INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_cost_tier ON addon_cost_model(addon_id, cluster_tier);

-- Cluster add-on installs
CREATE TABLE IF NOT EXISTS cluster_addon_installs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id),
    release_name TEXT NOT NULL,
    namespace TEXT NOT NULL,
    helm_revision INTEGER NOT NULL DEFAULT 1,
    installed_version TEXT NOT NULL,
    values_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL CHECK (status IN ('INSTALLING','INSTALLED','DEGRADED','UPGRADING','ROLLING_BACK','FAILED','DRIFTED','SUSPENDED','DEPRECATED','UNINSTALLING')),
    installed_by TEXT,
    idempotency_key TEXT,
    installed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_installs_cluster ON cluster_addon_installs(cluster_id);
CREATE INDEX IF NOT EXISTS idx_installs_addon ON cluster_addon_installs(addon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_installs_cluster_release ON cluster_addon_installs(cluster_id, release_name, namespace);
CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_installs_idempotency_key ON cluster_addon_installs (cluster_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Cluster add-on health
CREATE TABLE IF NOT EXISTS cluster_addon_health (
    id SERIAL PRIMARY KEY,
    addon_install_id TEXT NOT NULL REFERENCES cluster_addon_installs(id) ON DELETE CASCADE,
    last_checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    health_status TEXT NOT NULL CHECK (health_status IN ('HEALTHY','DEGRADED','UNKNOWN')),
    ready_pods INTEGER NOT NULL DEFAULT 0,
    total_pods INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_install ON cluster_addon_health(addon_install_id);

-- Add-on audit events
CREATE TABLE IF NOT EXISTS addon_audit_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    addon_install_id TEXT REFERENCES cluster_addon_installs(id) ON DELETE SET NULL,
    addon_id TEXT NOT NULL,
    release_name TEXT NOT NULL,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('INSTALL','UPGRADE','ROLLBACK','UNINSTALL','POLICY_CHANGE','DRIFT_DETECTED','HEALTH_CHANGE')),
    old_version TEXT,
    new_version TEXT,
    values_hash TEXT,
    result TEXT NOT NULL CHECK (result IN ('SUCCESS','FAILURE','IN_PROGRESS')),
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_cluster ON addon_audit_events(cluster_id);
CREATE INDEX IF NOT EXISTS idx_audit_install ON addon_audit_events(addon_install_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON addon_audit_events(created_at);

-- Add-on upgrade policies
CREATE TABLE IF NOT EXISTS addon_upgrade_policies (
    addon_install_id TEXT PRIMARY KEY REFERENCES cluster_addon_installs(id) ON DELETE CASCADE,
    policy TEXT NOT NULL CHECK (policy IN ('CONSERVATIVE','PATCH_ONLY','MINOR','MANUAL')) DEFAULT 'CONSERVATIVE',
    pinned_version TEXT,
    last_check_at TIMESTAMP WITH TIME ZONE,
    next_available_version TEXT,
    next_eligible_at TIMESTAMP WITH TIME ZONE,
    auto_upgrade_enabled INTEGER NOT NULL DEFAULT 0
);

-- Add-on catalog metadata
CREATE TABLE IF NOT EXISTS addon_catalog_meta (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cluster profiles (bootstrap profiles)
CREATE TABLE IF NOT EXISTS cluster_profiles (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    addons TEXT NOT NULL DEFAULT '[]',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add-on rollouts (multi-cluster)
CREATE TABLE IF NOT EXISTS addon_rollouts (
    id TEXT NOT NULL PRIMARY KEY,
    addon_id TEXT NOT NULL,
    target_version TEXT NOT NULL,
    strategy TEXT NOT NULL DEFAULT 'all-at-once',
    canary_percent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_addon_rollouts_addon_id ON addon_rollouts(addon_id);
CREATE INDEX IF NOT EXISTS idx_addon_rollouts_status ON addon_rollouts(status);

CREATE TABLE IF NOT EXISTS addon_rollout_cluster_status (
    rollout_id TEXT NOT NULL REFERENCES addon_rollouts(id) ON DELETE CASCADE,
    cluster_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (rollout_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_rollout_cluster_rollout ON addon_rollout_cluster_status(rollout_id);

-- Notification channels (webhooks, Slack, etc.)
CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'webhook',
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["install","upgrade","uninstall","failed"]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_type ON notification_channels(type);

-- Add-on versions (version history)
CREATE TABLE IF NOT EXISTS addon_versions (
    id SERIAL PRIMARY KEY,
    addon_id TEXT NOT NULL REFERENCES addon_catalog(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    release_date TEXT NOT NULL,
    changelog_url TEXT,
    breaking_changes TEXT,
    highlights TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(addon_id, version)
);

-- Maintenance windows for auto-upgrades
CREATE TABLE IF NOT EXISTS addon_maintenance_windows (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    day_of_week INTEGER NOT NULL DEFAULT -1,
    start_hour INTEGER NOT NULL DEFAULT 2 CHECK (start_hour >= 0 AND start_hour <= 23),
    start_minute INTEGER NOT NULL DEFAULT 0 CHECK (start_minute >= 0 AND start_minute <= 59),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK (duration_minutes > 0),
    apply_to TEXT NOT NULL DEFAULT 'all',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Private catalog sources (private Helm repos, OCI registries)
CREATE TABLE IF NOT EXISTS private_catalog_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'helm' CHECK (type IN ('helm', 'oci')),
    auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'basic', 'token')),
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
