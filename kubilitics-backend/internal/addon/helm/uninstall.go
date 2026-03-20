package helm

import (
	"context"
	"fmt"
	"strings"

	"helm.sh/helm/v3/pkg/action"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Uninstall runs a Helm uninstall. If DeleteCRDs is true, after uninstall
// CRDs with label helm.sh/chart matching the uninstalled release are deleted
// (Helm does not delete CRDs by default).
func (c *helmClientImpl) Uninstall(ctx context.Context, req UninstallRequest) error {
	_ = ctx
	cfg, err := c.newActionConfig(req.Namespace)
	if err != nil {
		return err
	}

	var chartLabel string
	if req.DeleteCRDs {
		hist := action.NewHistory(cfg)
		hist.Max = 1
		releases, err := hist.Run(req.ReleaseName)
		if err == nil && len(releases) > 0 {
			rel := releases[len(releases)-1]
			if rel.Chart != nil && rel.Chart.Metadata != nil {
				chartLabel = rel.Chart.Metadata.Name + "-" + rel.Chart.Metadata.Version
			}
		}
	}

	uninstallAction := action.NewUninstall(cfg)
	uninstallAction.KeepHistory = req.KeepHistory
	resp, err := uninstallAction.Run(req.ReleaseName)
	if err != nil {
		return fmt.Errorf("uninstall: %w", err)
	}

	if req.DeleteCRDs && chartLabel != "" {
		if err := c.deleteCRDsByChartLabel(ctx, chartLabel); err != nil {
			c.logger.Debug("delete CRDs after uninstall", "error", err, "chartLabel", chartLabel)
			// Do not fail the uninstall; CRD cleanup is best-effort
		}
	}
	_ = resp
	return nil
}

// deleteCRDsByChartLabel lists CRDs with label helm.sh/chart=<chartLabel> and deletes them.
func (c *helmClientImpl) deleteCRDsByChartLabel(ctx context.Context, chartLabel string) error {
	restConfig, err := c.restClientGetter.ToRESTConfig()
	if err != nil {
		return err
	}
	clientset, err := apiextensionsclientset.NewForConfig(restConfig)
	if err != nil {
		return err
	}
	selector := "helm.sh/chart=" + chartLabel
	list, err := clientset.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{
		LabelSelector: selector,
	})
	if err != nil {
		return err
	}
	for i := range list.Items {
		name := list.Items[i].Name
		if err := clientset.ApiextensionsV1().CustomResourceDefinitions().Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
			if !strings.Contains(err.Error(), "not found") {
				return fmt.Errorf("delete CRD %s: %w", name, err)
			}
		}
	}
	return nil
}
