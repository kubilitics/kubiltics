package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
)

// TestExistingInstallCheck_NoConflict: empty Helm releases (RestConfig nil → WARN from
// listHelmReleases) but no DB install records matching the addon → the function still
// returns a WARN from the Helm list failure path.
func TestExistingInstallCheck_NoHelmAccess_Warns(t *testing.T) {
	checker := &ExistingInstallChecker{}
	input := CheckInput{
		RestConfig:       nil, // nil RestConfig causes listHelmReleases to return error
		TargetNamespace:  "default",
		ExistingInstalls: nil,
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "cert-manager", HelmChart: "cert-manager"},
		},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("ExistingInstallChecker.Run error: %v", err)
	}
	if len(checks) == 0 {
		t.Fatal("expected at least one check")
	}
	// When Helm release list fails, the checker returns WARN (not BLOCK).
	if checks[0].Status != models.PreflightWARN {
		t.Errorf("expected PreflightWARN when Helm access unavailable, got %v", checks[0].Status)
	}
	if checks[0].Type != models.CheckExistingInstall {
		t.Errorf("expected CheckExistingInstall type, got %v", checks[0].Type)
	}
}

// TestExistingInstallCheck_WithExistingDBRecord: an existing DB install for the same addon
// in the same namespace is present → PreflightWARN "existing installation detected".
func TestExistingInstallCheck_WithExistingDBRecord(t *testing.T) {
	checker := &ExistingInstallChecker{}
	input := CheckInput{
		RestConfig:      nil, // nil triggers Helm error path (Helm WARN is overridden by DB record WARN)
		TargetNamespace: "default",
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "cert-manager", HelmChart: "cert-manager"},
		},
		ExistingInstalls: []models.AddOnInstallWithHealth{{
			AddOnInstall: models.AddOnInstall{
				ID:               "install-1",
				AddonID:          "cert-manager",
				ReleaseName:      "cert-manager",
				Namespace:        "default",
				Status:           string(models.StatusInstalled),
				InstalledVersion: "v1.16.3",
			},
		}},
		RequestedVersion: "v1.17.0",
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("ExistingInstallChecker.Run error: %v", err)
	}
	if len(checks) == 0 {
		t.Fatal("expected at least one check")
	}
	// Should be a WARN for existing installation.
	if checks[0].Status != models.PreflightWARN {
		t.Errorf("expected PreflightWARN for existing DB record, got %v", checks[0].Status)
	}
}

// TestExistingInstallCheck_DifferentNamespace: existing install is in a different namespace
// than the target → no conflict detected (nil RestConfig still produces a Helm WARN but not
// a conflict for the DB record).
func TestExistingInstallCheck_DifferentNamespace(t *testing.T) {
	checker := &ExistingInstallChecker{}
	input := CheckInput{
		RestConfig:      nil,
		TargetNamespace: "production",
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "cert-manager", HelmChart: "cert-manager"},
		},
		ExistingInstalls: []models.AddOnInstallWithHealth{{
			AddOnInstall: models.AddOnInstall{
				ID:        "install-1",
				AddonID:   "cert-manager",
				Namespace: "staging", // different from target "production"
				Status:    string(models.StatusInstalled),
			},
		}},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("ExistingInstallChecker.Run error: %v", err)
	}
	// The Helm WARN is still present due to nil RestConfig, but the DB record
	// does NOT match (different namespace), so the only WARN is from Helm access failure.
	if len(checks) == 0 {
		t.Fatal("expected at least one check")
	}
	// Title should mention "Unable to inspect" (Helm access failure), not "Existing installation".
	// Title should mention "Unable to inspect" (Helm access failure), not "Existing installation".
	if checks[0].Title == "Existing installation detected" {
		t.Errorf("different-namespace install should NOT trigger 'Existing installation detected'")
	}
}

func TestNormalizeChartName(t *testing.T) {
	if normalizeChartName("Nginx") != "nginx" {
		t.Errorf("normalizeChartName failed")
	}
	if normalizeChartName("  Redis  ") != "redis" {
		t.Errorf("normalizeChartName failed")
	}
	if normalizeChartName("PROMETHEUS-STACK") != "prometheus-stack" {
		t.Errorf("normalizeChartName failed")
	}
}

func TestReleaseChartName(t *testing.T) {
	rel := &release.Release{
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Name: "my-cool-chart",
			},
		},
	}
	if releaseChartName(rel) != "my-cool-chart" {
		t.Errorf("releaseChartName failed")
	}

	if releaseChartName(nil) != "" {
		t.Errorf("releaseChartName failed")
	}
	if releaseChartName(&release.Release{}) != "" {
		t.Errorf("releaseChartName failed")
	}
	if releaseChartName(&release.Release{Chart: &chart.Chart{}}) != "" {
		t.Errorf("releaseChartName failed")
	}
}

func TestReleaseChartVersion(t *testing.T) {
	rel := &release.Release{
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Version: "1.2.3",
			},
		},
	}
	if releaseChartVersion(rel) != "1.2.3" {
		t.Errorf("releaseChartVersion failed")
	}

	if releaseChartVersion(nil) != "" {
		t.Errorf("releaseChartVersion failed")
	}
	if releaseChartVersion(&release.Release{}) != "" {
		t.Errorf("releaseChartVersion failed")
	}
	if releaseChartVersion(&release.Release{Chart: &chart.Chart{}}) != "" {
		t.Errorf("releaseChartVersion failed")
	}
}

func TestNormalizeNamespace(t *testing.T) {
	if normalizeNamespace("") != "default" {
		t.Errorf("normalizeNamespace failed")
	}
	if normalizeNamespace("  ") != "default" {
		t.Errorf("normalizeNamespace failed")
	}
	if normalizeNamespace(" kube-system ") != "kube-system" {
		t.Errorf("normalizeNamespace failed")
	}
}
