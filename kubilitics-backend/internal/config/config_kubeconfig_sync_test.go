package config

import (
	"strings"
	"testing"
)

func TestLoad_DefaultsForKubeconfigSync(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("TAURI_ENABLED", "")
	t.Setenv("KUBILITICS_DEPLOYMENT_MODE", "")
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_ENABLED", "")
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_POLL_INTERVAL_SEC", "")
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_HEALTH_INTERVAL_SEC", "")
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_MAX_ABSOLUTE_REMOVALS", "")
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_MAX_REMOVAL_RATIO", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if !cfg.KubeconfigSyncEnabled {
		t.Errorf("KubeconfigSyncEnabled default: got false, want true")
	}
	if cfg.KubeconfigSyncPollIntervalSec != 60 {
		t.Errorf("PollIntervalSec: got %d, want 60", cfg.KubeconfigSyncPollIntervalSec)
	}
	if cfg.KubeconfigSyncHealthIntervalSec != 10 {
		t.Errorf("HealthIntervalSec: got %d, want 10", cfg.KubeconfigSyncHealthIntervalSec)
	}
	if cfg.KubeconfigSyncMaxAbsoluteRemovals != 10 {
		t.Errorf("MaxAbsoluteRemovals: got %d, want 10", cfg.KubeconfigSyncMaxAbsoluteRemovals)
	}
	if cfg.KubeconfigSyncMaxRemovalRatio != 0.5 {
		t.Errorf("MaxRemovalRatio: got %v, want 0.5", cfg.KubeconfigSyncMaxRemovalRatio)
	}
}

func TestLoad_DeploymentMode_DetectInCluster(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("TAURI_ENABLED", "")
	t.Setenv("KUBILITICS_DEPLOYMENT_MODE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.DeploymentMode != ModeInCluster {
		t.Errorf("DeploymentMode: got %q, want %q", cfg.DeploymentMode, ModeInCluster)
	}
}

func TestLoad_DeploymentMode_DetectDesktop(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("TAURI_ENABLED", "1")
	t.Setenv("KUBILITICS_DEPLOYMENT_MODE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.DeploymentMode != ModeDesktop {
		t.Errorf("DeploymentMode: got %q, want %q", cfg.DeploymentMode, ModeDesktop)
	}
}

func TestLoad_DeploymentMode_DefaultBrowser(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	t.Setenv("TAURI_ENABLED", "")
	t.Setenv("KUBILITICS_DEPLOYMENT_MODE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.DeploymentMode != ModeBrowser {
		t.Errorf("DeploymentMode: got %q, want %q", cfg.DeploymentMode, ModeBrowser)
	}
}

func TestLoad_DeploymentMode_ExplicitOverride(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
	t.Setenv("KUBILITICS_DEPLOYMENT_MODE", "desktop")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.DeploymentMode != ModeDesktop {
		t.Errorf("DeploymentMode: got %q, want %q (explicit override should win)", cfg.DeploymentMode, ModeDesktop)
	}
}

func TestLoad_KubeconfigSyncEnabled_EnvOverride(t *testing.T) {
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_ENABLED", "false")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.KubeconfigSyncEnabled {
		t.Errorf("KubeconfigSyncEnabled: got true, want false after env override")
	}
}

func TestLoad_InvalidThresholds_ClampedToDefaults(t *testing.T) {
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_MAX_REMOVAL_RATIO", "1.5")   // out of range
	t.Setenv("KUBILITICS_KUBECONFIG_SYNC_MAX_ABSOLUTE_REMOVALS", "0") // out of range

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.KubeconfigSyncMaxRemovalRatio != 0.5 {
		t.Errorf("MaxRemovalRatio clamp: got %v, want 0.5", cfg.KubeconfigSyncMaxRemovalRatio)
	}
	if cfg.KubeconfigSyncMaxAbsoluteRemovals != 10 {
		t.Errorf("MaxAbsoluteRemovals clamp: got %d, want 10", cfg.KubeconfigSyncMaxAbsoluteRemovals)
	}
}

func TestLoad_InvalidDeploymentMode_Rejected(t *testing.T) {
	t.Setenv("KUBILITICS_DEPLOYMENT_MODE", "garbage")

	_, err := Load()
	if err == nil {
		t.Fatalf("Load: got nil error, want rejection of invalid deployment_mode")
	}
	// The error message should mention the invalid value and the valid options.
	// We check for the word "invalid" and "deployment_mode" to be resilient to
	// wording changes.
	msg := err.Error()
	if !strings.Contains(msg, "invalid") || !strings.Contains(msg, "deployment_mode") {
		t.Errorf("error message: got %q, want something mentioning invalid deployment_mode", msg)
	}
}
