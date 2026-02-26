package cli

import (
	"testing"
)

func TestGitOpsSource(t *testing.T) {
	tests := []struct {
		annotations map[string]string
		labels      map[string]string
		want        string
	}{
		{map[string]string{"meta.helm.sh/release-name": "myapp"}, nil, "Helm"},
		{map[string]string{"kustomize.toolkit.fluxcd.io/checksum": "abc"}, nil, "Flux Kustomization"},
		{map[string]string{"helm.toolkit.fluxcd.io/checksum": "xyz"}, nil, "Flux HelmRelease"},
		{nil, map[string]string{"argocd.argoproj.io/instance": "payments"}, "ArgoCD"},
		{nil, nil, ""},
	}
	for _, tt := range tests {
		got := gitOpsSource(tt.annotations, tt.labels)
		if got != tt.want {
			t.Errorf("gitOpsSource(%v, %v) = %q, want %q", tt.annotations, tt.labels, got, tt.want)
		}
	}
}

func TestIsGitOpsManager(t *testing.T) {
	tests := []struct {
		manager string
		want    bool
	}{
		{"helm", true},
		{"argocd-application-controller", true},
		{"flux", true},
		{"kubectl", false},
		{"kube-controller-manager", false},
	}
	for _, tt := range tests {
		got := isGitOpsManager(tt.manager)
		if got != tt.want {
			t.Errorf("isGitOpsManager(%q) = %v, want %v", tt.manager, got, tt.want)
		}
	}
}

func TestIsManualManager(t *testing.T) {
	tests := []struct {
		manager string
		want    bool
	}{
		{"kubectl", true},
		{"kubectl-client-side-apply", true},
		{"helm", false},
	}
	for _, tt := range tests {
		got := isManualManager(tt.manager)
		if got != tt.want {
			t.Errorf("isManualManager(%q) = %v, want %v", tt.manager, got, tt.want)
		}
	}
}
