package lifecycle

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// Controller runs background monitors per cluster and drives state transitions.
// One controller instance manages all registered clusters.
type Controller interface {
	Start(ctx context.Context) error
	Stop()
	RegisterCluster(clusterID string) error
	DeregisterCluster(clusterID string) error
}

// HealthEvent is emitted when an add-on's health status changes (e.g. INSTALLED → DEGRADED).
type HealthEvent struct {
	AddonInstallID string
	ClusterID      string
	OldStatus      models.AddOnStatus
	NewStatus      models.AddOnStatus
	ReadyPods      int
	TotalPods      int
	Error          string
	OccurredAt     time.Time
}

// DriftSeverity classifies how significant a drift is.
const (
	DriftCosmetic    = "COSMETIC"    // label/annotation only
	DriftStructural  = "STRUCTURAL"  // spec/data mismatch
	DriftDestructive = "DESTRUCTIVE" // resource missing in cluster
)

// DriftedResource describes a single resource that has drifted from the desired state.
type DriftedResource struct {
	Kind          string
	Namespace     string
	Name          string
	Field         string
	ExpectedValue string
	ActualValue   string
}

// DriftEvent is emitted when drift is detected between Helm desired state and cluster state.
type DriftEvent struct {
	AddonInstallID   string
	ClusterID        string
	DriftSeverity    string
	DriftedResources []DriftedResource
	DetectedAt       time.Time
}

// UpgradeAvailableEvent is emitted when a newer chart version is available and policy allows notification.
type UpgradeAvailableEvent struct {
	AddonInstallID   string
	ClusterID        string
	CurrentVersion   string
	AvailableVersion string
	DetectedAt       time.Time
}

// LifecycleEventHandler receives lifecycle events from the controller.
// Implementations may persist audit events, trigger rollbacks, or notify the UI.
type LifecycleEventHandler interface {
	OnHealthChange(event HealthEvent)
	OnDrift(event DriftEvent)
	OnUpgradeAvailable(event UpgradeAvailableEvent)
}
