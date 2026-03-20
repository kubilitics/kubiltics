package service

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// ProjectService manages projects for multi-cluster, multi-tenancy organization.
type ProjectService interface {
	ListProjects(ctx context.Context) ([]*models.ProjectListItem, error)
	GetProject(ctx context.Context, id string) (*models.ProjectWithDetails, error)
	CreateProject(ctx context.Context, p *models.Project) (*models.Project, error)
	UpdateProject(ctx context.Context, p *models.Project) error
	DeleteProject(ctx context.Context, id string) error
	AddClusterToProject(ctx context.Context, projectID, clusterID string) error
	RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error
	AddNamespaceToProject(ctx context.Context, projectID, clusterID, namespaceName, team string) error
	RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error
}

type projectService struct {
	projectRepo repository.ProjectRepository
	clusterRepo repository.ClusterRepository
}

// NewProjectService creates a new project service.
func NewProjectService(projectRepo repository.ProjectRepository, clusterRepo repository.ClusterRepository) ProjectService {
	return &projectService{
		projectRepo: projectRepo,
		clusterRepo: clusterRepo,
	}
}

func (s *projectService) ListProjects(ctx context.Context) ([]*models.ProjectListItem, error) {
	return s.projectRepo.ListProjects(ctx)
}

func (s *projectService) GetProject(ctx context.Context, id string) (*models.ProjectWithDetails, error) {
	p, err := s.projectRepo.GetProject(ctx, id)
	if err != nil {
		return nil, err
	}
	pcList, err := s.projectRepo.ListProjectClusters(ctx, id)
	if err != nil {
		return nil, err
	}
	pnList, err := s.projectRepo.ListProjectNamespaces(ctx, id)
	if err != nil {
		return nil, err
	}
	clusters, _ := s.clusterRepo.List(ctx)
	clusterMap := make(map[string]*models.Cluster)
	for _, c := range clusters {
		clusterMap[c.ID] = c
	}
	clustersWithInfo := make([]models.ProjectClusterWithInfo, 0, len(pcList))
	for _, pc := range pcList {
		info := models.ProjectClusterWithInfo{ProjectCluster: *pc}
		if c := clusterMap[pc.ClusterID]; c != nil {
			info.ClusterName = c.Name
			info.ClusterStatus = c.Status
			info.ClusterProvider = c.Provider
		}
		clustersWithInfo = append(clustersWithInfo, info)
	}
	namespacesWithInfo := make([]models.ProjectNamespaceWithInfo, 0, len(pnList))
	for _, pn := range pnList {
		info := models.ProjectNamespaceWithInfo{ProjectNamespace: *pn}
		if c := clusterMap[pn.ClusterID]; c != nil {
			info.ClusterName = c.Name
		}
		namespacesWithInfo = append(namespacesWithInfo, info)
	}
	return &models.ProjectWithDetails{
		Project:    *p,
		Clusters:   clustersWithInfo,
		Namespaces: namespacesWithInfo,
	}, nil
}

func (s *projectService) CreateProject(ctx context.Context, p *models.Project) (*models.Project, error) {
	if err := s.projectRepo.CreateProject(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *projectService) UpdateProject(ctx context.Context, p *models.Project) error {
	return s.projectRepo.UpdateProject(ctx, p)
}

func (s *projectService) DeleteProject(ctx context.Context, id string) error {
	return s.projectRepo.DeleteProject(ctx, id)
}

func (s *projectService) AddClusterToProject(ctx context.Context, projectID, clusterID string) error {
	_, err := s.clusterRepo.Get(ctx, clusterID)
	if err != nil {
		return fmt.Errorf("cluster not found: %s", clusterID)
	}
	return s.projectRepo.AddClusterToProject(ctx, &models.ProjectCluster{
		ProjectID: projectID,
		ClusterID: clusterID,
	})
}

func (s *projectService) RemoveClusterFromProject(ctx context.Context, projectID, clusterID string) error {
	return s.projectRepo.RemoveClusterFromProject(ctx, projectID, clusterID)
}

func (s *projectService) AddNamespaceToProject(ctx context.Context, projectID, clusterID, namespaceName, team string) error {
	return s.projectRepo.AddNamespaceToProject(ctx, &models.ProjectNamespace{
		ProjectID:     projectID,
		ClusterID:     clusterID,
		NamespaceName: namespaceName,
		Team:          team,
	})
}

func (s *projectService) RemoveNamespaceFromProject(ctx context.Context, projectID, clusterID, namespaceName string) error {
	return s.projectRepo.RemoveNamespaceFromProject(ctx, projectID, clusterID, namespaceName)
}
