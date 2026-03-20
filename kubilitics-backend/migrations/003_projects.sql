-- Projects: multi-cluster, multi-tenancy organization
-- Supports scenario: Project abc with 4 clusters (prod/non-prod × region1/region2) and namespaces per team

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

-- Project-cluster associations with environment and region
CREATE TABLE IF NOT EXISTS project_clusters (
    project_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'non-prod',  -- prod, non-prod
    region TEXT NOT NULL DEFAULT '',              -- region1, region2, us-east-1, etc.
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, cluster_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_clusters_project ON project_clusters(project_id);
CREATE INDEX IF NOT EXISTS idx_project_clusters_cluster ON project_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_project_clusters_env_region ON project_clusters(environment, region);

-- Project-namespace associations (multi-tenancy: namespaces per team per cluster)
CREATE TABLE IF NOT EXISTS project_namespaces (
    project_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    namespace_name TEXT NOT NULL,
    team TEXT NOT NULL DEFAULT '',  -- abc team, cde team, etc.
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, cluster_id, namespace_name),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_namespaces_project ON project_namespaces(project_id);
CREATE INDEX IF NOT EXISTS idx_project_namespaces_cluster ON project_namespaces(cluster_id);
CREATE INDEX IF NOT EXISTS idx_project_namespaces_team ON project_namespaces(team);
