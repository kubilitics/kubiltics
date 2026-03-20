-- Simplify project_clusters: remove cloud-specific environment and region columns.
-- Project-cluster is now a simple association (project_id, cluster_id).

-- SQLite: recreate table without environment/region
CREATE TABLE IF NOT EXISTS project_clusters_new (
    project_id TEXT NOT NULL,
    cluster_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, cluster_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

-- Migrate existing data (drop env/region)
INSERT OR IGNORE INTO project_clusters_new (project_id, cluster_id, created_at)
SELECT project_id, cluster_id, created_at FROM project_clusters;

DROP TABLE IF EXISTS project_clusters;

ALTER TABLE project_clusters_new RENAME TO project_clusters;

CREATE INDEX IF NOT EXISTS idx_project_clusters_project ON project_clusters(project_id);
CREATE INDEX IF NOT EXISTS idx_project_clusters_cluster ON project_clusters(cluster_id);
