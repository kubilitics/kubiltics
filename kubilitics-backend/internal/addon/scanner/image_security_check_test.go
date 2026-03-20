package scanner

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHasLatestTag(t *testing.T) {
	assert.True(t, hasLatestTag("nginx"))
	assert.True(t, hasLatestTag("nginx:latest"))
	assert.True(t, hasLatestTag("registry.example.com/my-app:latest"))
	assert.True(t, hasLatestTag("registry.example.com/my-app"))

	assert.False(t, hasLatestTag("nginx:1.23.0"))
	assert.False(t, hasLatestTag("nginx@sha256:1234567890abcdef"))
	assert.False(t, hasLatestTag("registry.example.com/my-app:v2"))
}

func TestIsFromTrustedRegistry(t *testing.T) {
	assert.True(t, isFromTrustedRegistry("nginx"))          // Docker Hub implicit
	assert.True(t, isFromTrustedRegistry("myuser/myimage")) // Docker Hub implicit
	assert.True(t, isFromTrustedRegistry("registry.k8s.io/kube-apiserver:v1.27.0"))
	assert.True(t, isFromTrustedRegistry("k8s.gcr.io/coredns:1.8.4"))
	assert.True(t, isFromTrustedRegistry("ghcr.io/kubilitics/kubilitics:latest"))
	assert.False(t, isFromTrustedRegistry("us-west-1.amazonaws.com/myrepo/myimage:v1"))
	assert.True(t, isFromTrustedRegistry("public.ecr.aws/eks-distro/kubernetes/kube-apiserver:v1.27.1"))

	assert.False(t, isFromTrustedRegistry("untrusted.example.com/my-app:v1"))
	assert.False(t, isFromTrustedRegistry("private-registry.local:5000/my-app:1.0"))
}

func TestIsFromTrustedHelmRepo(t *testing.T) {
	assert.True(t, isFromTrustedHelmRepo("https://charts.helm.sh/stable"))
	assert.True(t, isFromTrustedHelmRepo("https://prometheus-community.github.io/helm-charts"))
	assert.True(t, isFromTrustedHelmRepo("https://charts.bitnami.com/bitnami"))

	assert.False(t, isFromTrustedHelmRepo("https://untrusted-charts.example.com"))
	assert.False(t, isFromTrustedHelmRepo("http://malicious.repo.local"))
}
