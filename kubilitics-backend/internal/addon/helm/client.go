package helm

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/cli-runtime/pkg/genericclioptions"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
)

// helmClientImpl implements HelmClient using the Helm SDK. Action configuration
// is created per operation to ensure namespace isolation.
type helmClientImpl struct {
	restClientGetter genericclioptions.RESTClientGetter
	logger           *slog.Logger
	// repo state: in-memory repo file and env settings for getters/cache (T3.03)
	repoFile      *repo.File
	envSettings   *cli.EnvSettings
	repoCachePath string
	repoMu        sync.Mutex
	// OCI client for oci:// refs (T3.11); nil if OCI not available
	ociClient *OCIClient
}

// kubeConfigGetter implements genericclioptions.RESTClientGetter from
// a clientcmd.ClientConfig (built from kubeconfig bytes).
type kubeConfigGetter struct {
	clientConfig clientcmd.ClientConfig
}

func (g *kubeConfigGetter) ToRESTConfig() (*rest.Config, error) {
	return g.clientConfig.ClientConfig()
}

func (g *kubeConfigGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
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

func (g *kubeConfigGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

func (g *kubeConfigGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return g.clientConfig
}

// NewHelmClient creates a HelmClient that uses the given kubeconfig bytes
// and logs via the provided logger. Namespace is not stored; each operation
// receives its target namespace and a fresh action.Configuration is created
// per call for namespace isolation. A per-client temp directory is used for
// repo cache and chart pulls (T3.03).
func NewHelmClient(kubeconfig []byte, _ string, logger *slog.Logger) (HelmClient, error) {
	if logger == nil {
		logger = slog.Default()
	}
	rawConfig, err := clientcmd.Load(kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}
	clientConfig := clientcmd.NewDefaultClientConfig(*rawConfig, &clientcmd.ConfigOverrides{})
	getter := &kubeConfigGetter{clientConfig: clientConfig}
	repoCachePath, err := os.MkdirTemp("", "helm-repo-")
	if err != nil {
		return nil, fmt.Errorf("create repo cache dir: %w", err)
	}
	envSettings := cli.New()
	envSettings.RepositoryCache = filepath.Join(repoCachePath, "repository")
	envSettings.RepositoryConfig = filepath.Join(repoCachePath, "repositories.yaml")
	if err := os.MkdirAll(envSettings.RepositoryCache, 0755); err != nil {
		os.RemoveAll(repoCachePath)
		return nil, fmt.Errorf("create repository cache: %w", err)
	}
	ociClient, _ := NewOCIClient(logger) // optional; nil if OCI unavailable
	return &helmClientImpl{
		restClientGetter: getter,
		logger:           logger,
		repoFile:         repo.NewFile(),
		envSettings:      envSettings,
		repoCachePath:    repoCachePath,
		ociClient:        ociClient,
	}, nil
}

// newActionConfig creates a new action.Configuration for the given namespace
// using the secret storage driver. Must be called per operation to ensure
// namespace isolation.
func (c *helmClientImpl) newActionConfig(namespace string) (*action.Configuration, error) {
	cfg := new(action.Configuration)
	debugLog := func(format string, v ...interface{}) {
		c.logger.Debug(fmt.Sprintf(format, v...))
	}
	if err := cfg.Init(c.restClientGetter, namespace, "secret", debugLog); err != nil {
		return nil, fmt.Errorf("helm action config init: %w", err)
	}
	return cfg, nil
}

// Test is implemented in test.go.
