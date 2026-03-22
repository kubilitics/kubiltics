package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ProjectRepository implementation for PostgreSQL

func (r *PostgresRepository) CreateProject(ctx context.Context, p *models.Project) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	query := `INSERT INTO projects (id, name, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := r.db.ExecContext(ctx, query, p.ID, p.Name, p.Description, time.Now(), time.Now())
	return err
}

func (r *PostgresRepository) GetProject(ctx context.Context, id string) (*models.Project, error) {
	var p models.Project
	err := r.db.GetContext(ctx, &p, `SELECT * FROM projects WHERE id = $1`, id)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	return &p, err
}

func (r *PostgresRepository) ListProjects(ctx context.Context) ([]*models.ProjectListItem, error) {
	query := `SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
		(SELECT COUNT(*) FROM project_clusters WHERE project_id = p.id) AS cluster_count,
		(SELECT COUNT(*) FROM project_namespaces WHERE project_id = p.id) AS namespace_count
	FROM projects p ORDER BY p.name ASC`
	var list []*models.ProjectListItem
	err := r.db.SelectContext(ctx, &list, query)
	return list, err
}

func (r *PostgresRepository) UpdateProject(ctx context.Context, p *models.Project) error {
	query := `UPDATE projects SET name = $1, description = $2, updated_at = $3 WHERE id = $4`
	_, err := r.db.ExecContext(ctx, query, p.Name, p.Description, time.Now(), p.ID)
	return err
}

func (r *PostgresRepository) DeleteProject(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM projects WHERE id = $1`, id)
	return err
}

func (r *PostgresRepository) AddClusterToProject(ctx context.Context, pc *models.ProjectCluster) error {
	query := `INSERT INTO project_clusters (project_id, cluster_id, created_at) VALUES ($1, $2, $3)`
	_, err := r.db.ExecContext(ctx, query, pc.ProjectID, pc.ClusterID, time.Now())
	return err
}

func (r *PostgresRepository) RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM project_clusters WHERE project_id = $1 AND cluster_id = $2`, projectID, clusterID)
	return err
}

func (r *PostgresRepository) ListProjectClusters(ctx context.Context, projectID string) ([]*models.ProjectCluster, error) {
	var list []*models.ProjectCluster
	err := r.db.SelectContext(ctx, &list, `SELECT project_id, cluster_id FROM project_clusters WHERE project_id = $1 ORDER BY cluster_id`, projectID)
	return list, err
}

func (r *PostgresRepository) AddNamespaceToProject(ctx context.Context, pn *models.ProjectNamespace) error {
	query := `INSERT INTO project_namespaces (project_id, cluster_id, namespace_name, team, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := r.db.ExecContext(ctx, query, pn.ProjectID, pn.ClusterID, pn.NamespaceName, pn.Team, time.Now())
	return err
}

func (r *PostgresRepository) RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error {
	query := `DELETE FROM project_namespaces WHERE project_id = $1 AND cluster_id = $2 AND namespace_name = $3`
	_, err := r.db.ExecContext(ctx, query, projectID, clusterID, namespaceName)
	return err
}

func (r *PostgresRepository) ListProjectNamespaces(ctx context.Context, projectID string) ([]*models.ProjectNamespace, error) {
	var list []*models.ProjectNamespace
	err := r.db.SelectContext(ctx, &list, `SELECT project_id, cluster_id, namespace_name, team FROM project_namespaces WHERE project_id = $1 ORDER BY cluster_id, team, namespace_name`, projectID)
	return list, err
}
