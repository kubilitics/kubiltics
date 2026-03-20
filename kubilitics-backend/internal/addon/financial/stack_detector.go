package financial

import (
	"context"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"k8s.io/client-go/kubernetes"
)

// DetectFinancialStack detects Prometheus, kube-state-metrics, and OpenCost from Helm releases.
func DetectFinancialStack(ctx context.Context, k8sClient kubernetes.Interface, helmClient helm.HelmClient) (*FinancialStack, error) {
	_ = k8sClient
	releases, err := helmClient.ListReleases(ctx, "")
	if err != nil {
		return nil, err
	}
	out := &FinancialStack{}
	hasKubePrometheusStack := false
	for _, r := range releases {
		if r == nil {
			continue
		}
		chartLower := strings.ToLower(r.ChartName)
		// Prometheus: chart contains "prometheus" or "kube-prometheus"
		if strings.Contains(chartLower, "prometheus") || strings.Contains(chartLower, "kube-prometheus") {
			out.PrometheusInstalled = true
			out.PrometheusReleaseName = r.Name
			out.PrometheusNamespace = r.Namespace
			out.PrometheusEndpoint = "http://" + r.Name + "." + r.Namespace + ".svc.cluster.local:9090"
			if strings.Contains(chartLower, "kube-prometheus-stack") {
				hasKubePrometheusStack = true
			}
		}
		if strings.Contains(chartLower, "kube-state-metrics") {
			out.KubeStateMetricsInstalled = true
		}
		if strings.Contains(chartLower, "opencost") {
			out.OpenCostInstalled = true
			out.OpenCostReleaseName = r.Name
			out.OpenCostNamespace = r.Namespace
			out.OpenCostEndpoint = "http://" + r.Name + "." + r.Namespace + ".svc.cluster.local:9003"
		}
	}
	if hasKubePrometheusStack {
		out.KubeStateMetricsInstalled = true
	}
	return out, nil
}
