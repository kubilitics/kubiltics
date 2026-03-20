package scanner

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type Scanner interface {
	RunPreflight(ctx context.Context, clusterID string, plan models.InstallPlan) (*models.PreflightReport, error)
}

type CheckRunner interface {
	Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error)
}

type CheckInput struct {
	ClusterID        string
	K8sClient        kubernetes.Interface
	DiscoveryClient  discovery.DiscoveryInterface
	DynamicClient    dynamic.Interface
	RestConfig       *rest.Config
	AddonDetail      *models.AddOnDetail
	TargetNamespace  string
	RequestedVersion string
	ExistingInstalls []models.AddOnInstallWithHealth
}
