//go:build tools

package tools

import (
	_ "github.com/Masterminds/semver/v3"
	_ "helm.sh/helm/v3/pkg/action"
	_ "sigs.k8s.io/controller-runtime/pkg/client"
)
