package helm

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

type HelmClient interface {
	Install(ctx context.Context, req InstallRequest) (*InstallResult, error)
	Upgrade(ctx context.Context, req UpgradeRequest) (*UpgradeResult, error)
	Rollback(ctx context.Context, req RollbackRequest) error
	Uninstall(ctx context.Context, req UninstallRequest) error
	Status(ctx context.Context, releaseName, namespace string) (*ReleaseStatus, error)
	History(ctx context.Context, releaseName, namespace string) ([]models.HelmReleaseRevision, error)
	DryRun(ctx context.Context, req InstallRequest) (*DryRunResult, error)
	Test(ctx context.Context, releaseName, namespace string, timeout time.Duration) (*TestResult, error)
	ListReleases(ctx context.Context, namespace string) ([]*models.HelmReleaseInfo, error)
}

type InstallRequest struct {
	ReleaseName     string
	Namespace       string
	ChartRef        string
	Version         string
	Values          map[string]interface{}
	CreateNamespace bool
	Wait            bool
	Timeout         time.Duration
	Atomic          bool
}

type UpgradeRequest struct {
	ReleaseName string
	Namespace   string
	ChartRef    string
	Version     string
	Values      map[string]interface{}
	Wait        bool
	Timeout     time.Duration
	Atomic      bool
	ReuseValues bool
}

type RollbackRequest struct {
	ReleaseName string
	Namespace   string
	ToRevision  int
	Wait        bool
	Timeout     time.Duration
}

type UninstallRequest struct {
	ReleaseName string
	Namespace   string
	KeepHistory bool
	DeleteCRDs  bool
}

type InstallResult struct {
	ReleaseName string
	Namespace   string
	Status      string
	Revision    int
	Manifest    string
	Notes       string
	DeployedAt  time.Time
}

type UpgradeResult struct {
	ReleaseName      string
	Namespace        string
	Status           string
	Revision         int
	PreviousRevision int
	Manifest         string
	Notes            string
	DeployedAt       time.Time
}

type DryRunResult struct {
	Manifest     string
	Notes        string
	ResourceCount int
	ResourceDiff []ResourceChange
}

type ResourceChange struct {
	Action    string
	Kind      string
	Namespace string
	Name      string
}

type ReleaseStatus struct {
	ReleaseName  string
	Namespace    string
	Status       string
	ChartVersion string
	AppVersion   string
	Revision     int
	DeployedAt   time.Time
	Description  string
	// Manifest is the rendered template of the release (for drift detection).
	Manifest string
}

type TestResult struct {
	Passed bool
	Tests  []TestSuite
}

type TestSuite struct {
	Name   string
	Status string
	Info   string
}

