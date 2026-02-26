package scanner

import (
	"context"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

type ExistingInstallChecker struct{}

func (c *ExistingInstallChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	releases, err := listHelmReleases(ctx, input.RestConfig)
	if err != nil {
		return []models.PreflightCheck{{
			Type:       models.CheckExistingInstall,
			Status:     models.PreflightWARN,
			Title:      "Unable to inspect existing Helm releases",
			Detail:     "Helm release inspection failed; existing install conflicts may not be fully detected.",
			Resolution: "Verify cluster access and Helm release secret/configmap permissions, then rerun preflight.",
		}}, nil
	}

	targetNS := normalizeNamespace(input.TargetNamespace)
	targetChart := normalizeChartName(input.AddonDetail.HelmChart)
	warnings := make([]string, 0, 2)

	for i := range releases {
		if normalizeNamespace(releases[i].Namespace) != targetNS {
			continue
		}
		chartName := normalizeChartName(releaseChartName(releases[i]))
		if chartName == targetChart && targetChart != "" {
			warnings = append(warnings, fmt.Sprintf("Helm release %q already exists in namespace %q at version %q; operation will perform upgrade semantics.", releases[i].Name, releases[i].Namespace, releaseChartVersion(releases[i])))
		}
	}

	for i := range input.ExistingInstalls {
		if input.ExistingInstalls[i].AddonID != input.AddonDetail.ID {
			continue
		}
		status := strings.ToUpper(strings.TrimSpace(input.ExistingInstalls[i].Status))
		if status != string(models.StatusInstalled) && status != string(models.StatusUpgrading) {
			continue
		}
		if normalizeNamespace(input.ExistingInstalls[i].Namespace) != targetNS {
			continue
		}
		warnings = append(warnings, fmt.Sprintf("Kubilitics catalog record exists for release %q in namespace %q at version %q; requested version is %q.", input.ExistingInstalls[i].ReleaseName, input.ExistingInstalls[i].Namespace, input.ExistingInstalls[i].InstalledVersion, input.RequestedVersion))
	}

	if len(warnings) == 0 {
		return []models.PreflightCheck{{
			Type:   models.CheckExistingInstall,
			Status: models.PreflightGO,
			Title:  "No conflicting existing installation detected",
			Detail: "No matching Helm release or existing Kubilitics install record found for this add-on in target namespace.",
		}}, nil
	}

	return []models.PreflightCheck{{
		Type:       models.CheckExistingInstall,
		Status:     models.PreflightWARN,
		Title:      "Existing installation detected",
		Detail:     strings.Join(warnings, " "),
		Resolution: "Proceed only if in-place upgrade/reconciliation is intended.",
	}}, nil
}

func listHelmReleases(ctx context.Context, cfg *rest.Config) ([]*release.Release, error) {
	if cfg == nil {
		return nil, fmt.Errorf("rest config is required")
	}
	getter, err := newRESTClientGetterFromConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("build helm rest client getter: %w", err)
	}

	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(getter, "default", "secret", func(string, ...interface{}) {}); err != nil {
		return nil, fmt.Errorf("initialize helm action config: %w", err)
	}
	listAction := action.NewList(actionConfig)
	listAction.AllNamespaces = true
	listAction.All = true
	releases, err := listAction.Run()
	if err != nil {
		return nil, fmt.Errorf("list helm releases: %w", err)
	}
	return releases, nil
}

type restConfigGetter struct {
	clientConfig clientcmd.ClientConfig
}

func newRESTClientGetterFromConfig(cfg *rest.Config) (genericclioptions.RESTClientGetter, error) {
	rawCfg, err := restConfigToRawConfig(cfg)
	if err != nil {
		return nil, err
	}
	clientCfg := clientcmd.NewDefaultClientConfig(*rawCfg, &clientcmd.ConfigOverrides{})
	return &restConfigGetter{clientConfig: clientCfg}, nil
}

func (g *restConfigGetter) ToRESTConfig() (*rest.Config, error) {
	return g.clientConfig.ClientConfig()
}

func (g *restConfigGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	restCfg, err := g.ToRESTConfig()
	if err != nil {
		return nil, err
	}
	dc, err := discovery.NewDiscoveryClientForConfig(restCfg)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

func (g *restConfigGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

func (g *restConfigGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return g.clientConfig
}

func restConfigToRawConfig(cfg *rest.Config) (*clientcmdapi.Config, error) {
	if cfg == nil {
		return nil, fmt.Errorf("rest config is required")
	}
	const (
		clusterName = "kubilitics-cluster"
		userName    = "kubilitics-user"
		contextName = "kubilitics-context"
	)

	raw := clientcmdapi.NewConfig()
	raw.Clusters[clusterName] = &clientcmdapi.Cluster{
		Server:                   cfg.Host,
		CertificateAuthorityData: cfg.CAData,
		InsecureSkipTLSVerify:    cfg.Insecure,
		TLSServerName:            cfg.ServerName,
	}
	raw.AuthInfos[userName] = &clientcmdapi.AuthInfo{
		Token:                 cfg.BearerToken,
		TokenFile:             cfg.BearerTokenFile,
		ClientCertificateData: cfg.CertData,
		ClientKeyData:         cfg.KeyData,
		Username:              cfg.Username,
		Password:              cfg.Password,
		Exec:                  cfg.ExecProvider,
	}
	raw.Contexts[contextName] = &clientcmdapi.Context{
		Cluster:  clusterName,
		AuthInfo: userName,
	}
	raw.CurrentContext = contextName
	return raw, nil
}

func normalizeNamespace(ns string) string {
	ns = strings.TrimSpace(ns)
	if ns == "" {
		return "default"
	}
	return ns
}

func normalizeChartName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func releaseChartName(r *release.Release) string {
	if r == nil || r.Chart == nil || r.Chart.Metadata == nil {
		return ""
	}
	return r.Chart.Metadata.Name
}

func releaseChartVersion(r *release.Release) string {
	if r == nil || r.Chart == nil || r.Chart.Metadata == nil {
		return ""
	}
	return r.Chart.Metadata.Version
}
