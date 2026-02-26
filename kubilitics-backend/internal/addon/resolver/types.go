package resolver

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

type Resolver interface {
	Resolve(ctx context.Context, addonID string, clusterID string) (*models.InstallPlan, error)
}

type ResolutionError struct {
	Code               string
	Message            string
	AddonID            string
	ConflictingAddonID string
}

func (e *ResolutionError) Error() string {
	if e == nil {
		return ""
	}
	if e.AddonID != "" && e.ConflictingAddonID != "" {
		return fmt.Sprintf("%s: %s (%s conflicts with %s)", e.Code, e.Message, e.AddonID, e.ConflictingAddonID)
	}
	if e.AddonID != "" {
		return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.AddonID)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

const (
	ErrCycle           = "CYCLE_DETECTED"
	ErrConflict        = "CONFLICT_DETECTED"
	ErrNotFound        = "ADDON_NOT_FOUND"
	ErrVersionConflict = "VERSION_CONFLICT"
)

type GraphNode struct {
	AddonID            string
	Version            string
	IsInstalled        bool
	InstalledVersion   string
	InstalledReleaseID string
	Depth              int
	IsRequired         bool
}

type GraphEdge struct {
	FromID            string
	ToID              string
	Type              models.DependencyType
	VersionConstraint string
}
