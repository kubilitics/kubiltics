package scanner

import (
	"context"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// trustedRegistries is the set of registry host prefixes considered safe for production.
// Images from outside this list raise a WARN (not a hard FAIL) because users may run
// air-gapped or private registries.
var trustedRegistries = []string{
	"registry.k8s.io",          // Official Kubernetes images
	"k8s.gcr.io",               // Legacy Kubernetes (deprecated, still valid)
	"gcr.io",                   // Google Container Registry
	"us.gcr.io",
	"eu.gcr.io",
	"asia.gcr.io",
	"ghcr.io",                  // GitHub Container Registry
	"quay.io",                  // Red Hat / CoreOS
	"docker.io",                // Docker Hub
	"index.docker.io",
	"registry.hub.docker.com",
	"mcr.microsoft.com",        // Microsoft Container Registry
	"public.ecr.aws",           // AWS ECR Public
	"nvcr.io",                  // NVIDIA GPU Operator
}

// trustedHelmRepos is the set of known-good Helm chart repository domains.
// Charts originating from outside this list trigger a WARN.
var trustedHelmRepos = []string{
	"charts.helm.sh",
	"kubernetes.github.io",
	"helm.cilium.io",
	"charts.jetstack.io",            // cert-manager
	"grafana.github.io",
	"prometheus-community.github.io",
	"falcosecurity.github.io",
	"argoproj.github.io",
	"charts.bitnami.com",
	"helm.nginx.com",
	"charts.crossplane.io",
	"open-telemetry.github.io",
	"helm.releases.hashicorp.com",
	"charts.kubilitics.io",
}

// ImageSecurityChecker implements CheckRunner for container image security policies.
//
// At preflight time the addon is not yet installed, so Trivy CVE scanning is not
// possible without a full chart render pipeline. Instead we perform three layers
// of real, actionable checks:
//
//  1. Version tag policy   — reject `latest`, prefer immutable semver tags.
//  2. Helm chart source    — warn when the chart originates from an unrecognised repo.
//  3. Running pod images   — for addon upgrades the namespace already has running pods;
//     we enumerate their images and apply registry and tag policy checks.
type ImageSecurityChecker struct{}

func (c *ImageSecurityChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	var checks []models.PreflightCheck

	// ── Layer 1: version tag policy ──────────────────────────────────────────
	if input.RequestedVersion == "latest" || input.RequestedVersion == "" {
		checks = append(checks, models.PreflightCheck{
			Type:       models.CheckImageSecurity,
			Status:     models.PreflightWARN,
			Title:      "Mutable Version Tag Requested",
			Detail:     "The requested version is 'latest' or empty. Using mutable tags leads to non-deterministic rollouts and makes auditing difficult.",
			Resolution: "Pin the add-on to a specific semantic version (e.g. v1.13.3).",
		})
	}

	// ── Layer 2: Helm chart source trust ─────────────────────────────────────
	if repoURL := input.AddonDetail.HelmRepoURL; repoURL != "" && !isFromTrustedHelmRepo(repoURL) {
		checks = append(checks, models.PreflightCheck{
			Type:       models.CheckImageSecurity,
			Status:     models.PreflightWARN,
			Title:      "Unrecognised Helm Chart Source",
			Detail:     fmt.Sprintf("The chart originates from '%s', which is not in the platform's trusted chart repository list.", repoURL),
			Resolution: "Verify the chart publisher and review its contents before installing.",
		})
	}

	// ── Layer 3: inspect running pod images (upgrade / reinstall path) ───────
	podImageChecks := c.checkRunningPodImages(ctx, input)
	checks = append(checks, podImageChecks...)

	// If all layers passed, emit a single GO check.
	if len(checks) == 0 {
		checks = append(checks, models.PreflightCheck{
			Type:   models.CheckImageSecurity,
			Status: models.PreflightGO,
			Title:  fmt.Sprintf("Image security checks passed for %s", input.AddonDetail.Name),
			Detail: "Version tag, chart source, and running container images passed all security policy checks.",
		})
	}

	return checks, nil
}

// checkRunningPodImages lists all pods in the target namespace and applies
// image tag and registry policy checks on their container images.
// For a brand-new install the namespace is empty and this returns nil — the
// check degrades gracefully to layer-1 / layer-2 only.
func (c *ImageSecurityChecker) checkRunningPodImages(ctx context.Context, input CheckInput) []models.PreflightCheck {
	if input.K8sClient == nil || input.TargetNamespace == "" {
		return nil
	}

	pods, err := input.K8sClient.CoreV1().Pods(input.TargetNamespace).List(ctx, metav1.ListOptions{})
	if err != nil || len(pods.Items) == 0 {
		// Namespace doesn't exist yet or is empty — first-time install, nothing to check.
		return nil
	}

	seen := make(map[string]bool)
	var violations []models.PreflightCheck

	for i := range pods.Items {
		// Combine init containers and regular containers.
		var allContainers []corev1.Container
		allContainers = append(allContainers, pods.Items[i].Spec.InitContainers...)
		allContainers = append(allContainers, pods.Items[i].Spec.Containers...)

		for _, container := range allContainers {
			img := container.Image
			if seen[img] {
				continue
			}
			seen[img] = true

			if hasLatestTag(img) {
				violations = append(violations, models.PreflightCheck{
					Type:       models.CheckImageSecurity,
					Status:     models.PreflightWARN,
					Title:      "Mutable ':latest' Tag in Running Image",
					Detail:     fmt.Sprintf("Container image '%s' uses a ':latest' or untagged reference. This prevents reproducible rollouts.", img),
					Resolution: "Update the Helm values to pin the image to an immutable digest or semantic version tag.",
				})
			}

			if !isFromTrustedRegistry(img) {
				violations = append(violations, models.PreflightCheck{
					Type:       models.CheckImageSecurity,
					Status:     models.PreflightWARN,
					Title:      "Image from Unrecognised Registry",
					Detail:     fmt.Sprintf("Container image '%s' does not originate from a platform-trusted registry.", img),
					Resolution: "Confirm the image publisher and consider mirroring to an internal registry.",
				})
			}
		}
	}

	return violations
}

// hasLatestTag returns true when the image reference has no explicit tag or uses ":latest".
func hasLatestTag(image string) bool {
	// Digest-pinned images are immutable regardless of tag.
	if strings.Contains(image, "@sha256:") {
		return false
	}
	// Strip registry host and path, leaving name:tag.
	ref := image
	if idx := strings.LastIndex(image, "/"); idx >= 0 {
		ref = image[idx+1:]
	}
	// No colon → no tag → implicit latest semantics.
	if !strings.Contains(ref, ":") {
		return true
	}
	tag := strings.SplitN(ref, ":", 2)[1]
	return tag == "latest" || tag == ""
}

// isFromTrustedRegistry returns true when the image originates from a trusted registry host.
func isFromTrustedRegistry(image string) bool {
	// Bare names (e.g. "nginx") resolve to docker.io — considered trusted.
	if !strings.Contains(image, "/") {
		return true
	}
	// The registry host is the first path component when it contains a "." or ":".
	parts := strings.SplitN(image, "/", 2)
	host := parts[0]
	if !strings.Contains(host, ".") && !strings.Contains(host, ":") {
		// Docker Hub short form (user/image) — no explicit registry host.
		return true
	}
	for _, trusted := range trustedRegistries {
		if host == trusted || strings.HasSuffix(host, "."+trusted) {
			return true
		}
	}
	return false
}

// isFromTrustedHelmRepo returns true when the given Helm repo URL contains a trusted host.
func isFromTrustedHelmRepo(repoURL string) bool {
	lower := strings.ToLower(repoURL)
	for _, trusted := range trustedHelmRepos {
		if strings.Contains(lower, trusted) {
			return true
		}
	}
	return false
}
