package resolver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

type DependencyResolver struct {
	repo   repository.AddOnRepository
	logger *slog.Logger
}

func NewDependencyResolver(repo repository.AddOnRepository, logger *slog.Logger) *DependencyResolver {
	if logger == nil {
		logger = slog.Default()
	}
	return &DependencyResolver{
		repo:   repo,
		logger: logger,
	}
}

func (r *DependencyResolver) Resolve(ctx context.Context, addonID, clusterID string) (*models.InstallPlan, error) {
	addonID = strings.TrimSpace(addonID)
	clusterID = strings.TrimSpace(clusterID)
	if addonID == "" {
		return nil, &ResolutionError{
			Code:    ErrNotFound,
			Message: "addon id is required",
		}
	}
	target, err := r.repo.GetAddOn(ctx, addonID)
	if err != nil {
		return nil, mapNotFoundError(addonID, err)
	}

	installs, err := r.repo.ListClusterInstalls(ctx, clusterID)
	if err != nil {
		return nil, fmt.Errorf("list cluster installs %s: %w", clusterID, err)
	}

	installedMap := make(map[string]*models.AddOnInstallWithHealth, len(installs))
	for i := range installs {
		install := installs[i]
		installedMap[install.AddonID] = &install
	}

	graph := NewDependencyGraph()
	catalog := make(map[string]*models.AddOnDetail)
	if err := r.buildGraphRecursive(ctx, graph, catalog, installedMap, target, 0, true); err != nil {
		return nil, err
	}

	if hasCycle, cyclePath := DetectCycle(graph); hasCycle {
		return nil, &ResolutionError{
			Code:    ErrCycle,
			Message: "circular dependency: " + strings.Join(cyclePath, " -> "),
			AddonID: addonID,
		}
	}

	directConflicts, err := DetectDirectConflicts(graph, catalog)
	if err != nil {
		return nil, err
	}
	if len(directConflicts) > 0 {
		first := directConflicts[0]
		return nil, &first
	}

	crdConflicts, err := DetectCRDConflicts(graph.AllNodes(), installs, catalog)
	if err != nil {
		return nil, err
	}
	if len(crdConflicts) > 0 {
		first := crdConflicts[0]
		return nil, &first
	}

	sortedIDs, err := graph.TopologicalSort()
	if err != nil {
		return nil, err
	}

	plan := BuildInstallPlan(graph, sortedIDs, installedMap, catalog)
	plan.RequestedAddonID = addonID
	plan.ClusterID = clusterID
	plan.GeneratedAt = time.Now().UTC()

	r.logger.Info("dependency resolution complete", "cluster_id", clusterID, "requested_addon", addonID, "steps", len(plan.Steps))
	return plan, nil
}

func (r *DependencyResolver) buildGraphRecursive(
	ctx context.Context,
	graph *DependencyGraph,
	catalog map[string]*models.AddOnDetail,
	installed map[string]*models.AddOnInstallWithHealth,
	addon *models.AddOnDetail,
	depth int,
	isRequired bool,
) error {
	if addon == nil {
		return errors.New("nil addon detail")
	}
	node := &GraphNode{
		AddonID:    addon.ID,
		Version:    addon.Version,
		Depth:      depth,
		IsRequired: isRequired,
	}
	if existing, ok := installed[addon.ID]; ok {
		node.IsInstalled = true
		node.InstalledVersion = existing.InstalledVersion
		node.InstalledReleaseID = existing.ID
	}
	graph.AddNode(node)
	catalog[addon.ID] = addon

	for i := range addon.Dependencies {
		depID := addon.Dependencies[i].DependsOnID
		if strings.TrimSpace(depID) == "" {
			continue
		}
		depDetail, ok := catalog[depID]
		if !ok {
			var err error
			depDetail, err = r.repo.GetAddOn(ctx, depID)
			if err != nil {
				return mapNotFoundError(depID, err)
			}
			catalog[depID] = depDetail
		}

		graph.AddEdge(GraphEdge{
			FromID:            addon.ID,
			ToID:              depID,
			Type:              models.DependencyType(addon.Dependencies[i].DependencyType),
			VersionConstraint: addon.Dependencies[i].VersionConstraint,
		})

		if addon.Dependencies[i].VersionConstraint != "" {
			if err := validateEdgeVersion(graph, addon.ID, depID); err != nil {
				return err
			}
		}

		if _, exists := graph.GetNode(depID); exists {
			continue
		}
		depRequired := models.DependencyType(addon.Dependencies[i].DependencyType) == models.DependencyRequired
		if err := r.buildGraphRecursive(ctx, graph, catalog, installed, depDetail, depth+1, depRequired); err != nil {
			return err
		}
	}
	return nil
}

func mapNotFoundError(addonID string, err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "not found") || strings.Contains(msg, "no rows") {
		return &ResolutionError{
			Code:    ErrNotFound,
			Message: "add-on not found",
			AddonID: addonID,
		}
	}
	return fmt.Errorf("get addon %s: %w", addonID, err)
}
