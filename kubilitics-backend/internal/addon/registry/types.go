package registry

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

type CatalogSource interface {
	ListAddOns(ctx context.Context, filter CatalogFilter) ([]models.AddOnEntry, error)
	GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error)
}

type CatalogFilter struct {
	Tier       string
	Tags       []string
	Search     string
	K8sVersion string
	PageSize   int
	PageToken  string
}

type ArtifactHubChart struct {
	PackageID   string `json:"package_id"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	LogoImageID string `json:"logo_image_id"`
	Version     string `json:"version"`
	Stars       int    `json:"stars"`
	Repository  struct {
		URL  string `json:"url"`
		Name string `json:"name"`
	} `json:"repository"`
	CreatedAt  int64 `json:"created_at"`
	Deprecated bool  `json:"deprecated"`
}

type ArtifactHubSearchResponse struct {
	Packages             []ArtifactHubChart `json:"packages"`
	PaginationTotalCount int                `json:"pagination_total_count"`
}

type CoreCatalogFile struct {
	AddOn        models.AddOnEntry          `json:"addon"`
	Dependencies []models.AddOnDependency   `json:"dependencies"`
	Conflicts    []models.AddOnConflict     `json:"conflicts"`
	CRDsOwned    []models.AddOnCRDOwnership `json:"crds_owned"`
	RBACRequired []models.AddOnRBACRule     `json:"rbac_required"`
	CostModels   []models.AddOnCostModel    `json:"cost_models"`
	Versions     []models.VersionChangelog  `json:"versions,omitempty"`
}
