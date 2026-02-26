package k8sclient

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

type Bundle struct {
	RawConfig        clientcmdapi.Config
	EffectiveContext string
	Clientset        kubernetes.Interface
	Dynamic          dynamic.Interface
	REST             rest.Interface
}

type rawConfigCacheEntry struct {
	cfg     clientcmdapi.Config
	expires time.Time
}

type bundleCacheEntry struct {
	bundle  *Bundle
	expires time.Time
}

var (
	rawConfigCacheTTL = 2 * time.Second
	bundleCacheTTL    = 2 * time.Second
	nowFn             = time.Now

	rawConfigCacheMu sync.RWMutex
	rawConfigCache   = map[string]rawConfigCacheEntry{}

	bundleCacheMu sync.RWMutex
	bundleCache   = map[string]bundleCacheEntry{}
)

func NewBundle(kubeconfigPath, contextName string) (*Bundle, error) {
	key := cacheKey(kubeconfigPath, contextName)
	if b := getBundleFromCache(key); b != nil {
		return b, nil
	}

	loader := clientcmd.NewDefaultClientConfigLoadingRules()
	if strings.TrimSpace(kubeconfigPath) != "" {
		loader.ExplicitPath = strings.TrimSpace(kubeconfigPath)
	}
	overrides := &clientcmd.ConfigOverrides{}
	if strings.TrimSpace(contextName) != "" {
		overrides.CurrentContext = strings.TrimSpace(contextName)
	}

	cfg := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loader, overrides)
	rawCfg, err := cfg.RawConfig()
	if err != nil {
		return nil, wrapConfigErr(err)
	}
	restCfg, err := cfg.ClientConfig()
	if err != nil {
		return nil, wrapConfigErr(err)
	}
	restCfg.Timeout = 10 * time.Second

	var (
		clientset kubernetes.Interface
		dyn       dynamic.Interface
		csErr     error
		dynErr    error
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		clientset, csErr = kubernetes.NewForConfig(restCfg)
	}()
	go func() {
		defer wg.Done()
		dyn, dynErr = dynamic.NewForConfig(restCfg)
	}()
	wg.Wait()
	if csErr != nil {
		return nil, fmt.Errorf("failed to initialize kubernetes clientset: %w", csErr)
	}
	if dynErr != nil {
		return nil, fmt.Errorf("failed to initialize dynamic client: %w", dynErr)
	}

	effective := strings.TrimSpace(overrides.CurrentContext)
	if effective == "" {
		effective = strings.TrimSpace(rawCfg.CurrentContext)
	}
	bundle := &Bundle{
		RawConfig:        rawCfg,
		EffectiveContext: effective,
		Clientset:        clientset,
		Dynamic:          dyn,
		REST:             clientset.CoreV1().RESTClient(),
	}
	storeBundleInCache(key, bundle)
	return bundle, nil
}

func ListContexts(kubeconfigPath string) ([]string, error) {
	raw, err := loadRawConfig(kubeconfigPath)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(raw.Contexts))
	for name := range raw.Contexts {
		name = strings.TrimSpace(name)
		if name != "" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out, nil
}

func CurrentContext(kubeconfigPath string) (string, error) {
	raw, err := loadRawConfig(kubeconfigPath)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(raw.CurrentContext), nil
}

// CurrentContextAndNamespace returns the effective context and namespace (from kubeconfig).
// If contextOverride is non-empty it is used as context; otherwise raw.CurrentContext is used.
// Namespace comes from the context's Namespace field, or "default" if unset.
func CurrentContextAndNamespace(kubeconfigPath, contextOverride string) (contextName, namespace string, err error) {
	raw, err := loadRawConfig(kubeconfigPath)
	if err != nil {
		return "", "", err
	}
	ctxName := strings.TrimSpace(contextOverride)
	if ctxName == "" {
		ctxName = strings.TrimSpace(raw.CurrentContext)
	}
	ns := "default"
	if c, ok := raw.Contexts[ctxName]; ok && c != nil && strings.TrimSpace(c.Namespace) != "" {
		ns = strings.TrimSpace(c.Namespace)
	}
	return ctxName, ns, nil
}

func DetectAuthMethods(raw clientcmdapi.Config, contextName string) []string {
	ctxName := strings.TrimSpace(contextName)
	if ctxName == "" {
		ctxName = strings.TrimSpace(raw.CurrentContext)
	}
	ctxCfg, ok := raw.Contexts[ctxName]
	if !ok || ctxCfg == nil {
		return []string{"unknown"}
	}
	authInfoName := strings.TrimSpace(ctxCfg.AuthInfo)
	authCfg, ok := raw.AuthInfos[authInfoName]
	if !ok || authCfg == nil {
		return []string{"unknown"}
	}

	methods := make([]string, 0, 4)
	if strings.TrimSpace(authCfg.Token) != "" || strings.TrimSpace(authCfg.TokenFile) != "" {
		methods = append(methods, "token")
	}
	if len(authCfg.ClientCertificateData) > 0 || strings.TrimSpace(authCfg.ClientCertificate) != "" {
		methods = append(methods, "client-cert")
	}
	if authCfg.Exec != nil {
		methods = append(methods, "exec")
	}
	if authCfg.AuthProvider != nil && strings.TrimSpace(authCfg.AuthProvider.Name) != "" {
		methods = append(methods, "auth-provider:"+strings.TrimSpace(authCfg.AuthProvider.Name))
	}
	if strings.TrimSpace(authCfg.Username) != "" || strings.TrimSpace(authCfg.Password) != "" {
		methods = append(methods, "basic-auth")
	}
	if authCfg.Impersonate != "" {
		methods = append(methods, "impersonation")
	}
	if len(methods) == 0 {
		methods = append(methods, "unknown")
	}
	return methods
}

func TestConnection(ctx context.Context, bundle *Bundle) error {
	if bundle == nil || bundle.Clientset == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}
	_, err := bundle.Clientset.Discovery().ServerVersion()
	if err != nil {
		return wrapConnErr(err)
	}
	return nil
}

func loadRawConfig(kubeconfigPath string) (clientcmdapi.Config, error) {
	key := cacheKey(kubeconfigPath, "")
	if cfg, ok := getRawConfigFromCache(key); ok {
		return cfg, nil
	}

	loader := clientcmd.NewDefaultClientConfigLoadingRules()
	if strings.TrimSpace(kubeconfigPath) != "" {
		loader.ExplicitPath = strings.TrimSpace(kubeconfigPath)
	}
	rawCfg, err := loader.Load()
	if err != nil {
		return clientcmdapi.Config{}, wrapConfigErr(err)
	}
	if rawCfg == nil {
		return clientcmdapi.Config{}, fmt.Errorf("kubeconfig is empty")
	}
	storeRawConfigInCache(key, *rawCfg)
	return *rawCfg, nil
}

func getRawConfigFromCache(key string) (clientcmdapi.Config, bool) {
	rawConfigCacheMu.RLock()
	entry, ok := rawConfigCache[key]
	rawConfigCacheMu.RUnlock()
	if !ok || nowFn().After(entry.expires) {
		return clientcmdapi.Config{}, false
	}
	return entry.cfg, true
}

func storeRawConfigInCache(key string, cfg clientcmdapi.Config) {
	rawConfigCacheMu.Lock()
	rawConfigCache[key] = rawConfigCacheEntry{cfg: cfg, expires: nowFn().Add(rawConfigCacheTTL)}
	rawConfigCacheMu.Unlock()
}

func getBundleFromCache(key string) *Bundle {
	bundleCacheMu.RLock()
	entry, ok := bundleCache[key]
	bundleCacheMu.RUnlock()
	if !ok || nowFn().After(entry.expires) {
		return nil
	}
	return entry.bundle
}

func storeBundleInCache(key string, bundle *Bundle) {
	bundleCacheMu.Lock()
	bundleCache[key] = bundleCacheEntry{bundle: bundle, expires: nowFn().Add(bundleCacheTTL)}
	bundleCacheMu.Unlock()
}

func cacheKey(kubeconfigPath, contextName string) string {
	return strings.TrimSpace(kubeconfigPath) + "|" + strings.TrimSpace(contextName)
}

func wrapConfigErr(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "no configuration has been provided"):
		return fmt.Errorf("kubeconfig not found or empty; set --kubeconfig or KUBECONFIG")
	case strings.Contains(msg, "no context exists with the name"):
		return fmt.Errorf("requested context not found in kubeconfig: %w", err)
	case strings.Contains(msg, "unable to read"):
		return fmt.Errorf("failed to read kubeconfig file: %w", err)
	default:
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}
}

func wrapConnErr(err error) error {
	if err == nil {
		return nil
	}
	var uerr *url.Error
	if errors.As(err, &uerr) {
		if ne, ok := uerr.Err.(net.Error); ok && ne.Timeout() {
			return fmt.Errorf("cluster connection timed out; check network/VPN and API server reachability")
		}
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "unauthorized"), strings.Contains(msg, "forbidden"):
		return fmt.Errorf("authentication failed; refresh credentials for the selected context")
	case strings.Contains(msg, "x509"), strings.Contains(msg, "certificate"):
		return fmt.Errorf("TLS validation failed; verify cluster certificate/CA in kubeconfig")
	case strings.Contains(msg, "no such host"), strings.Contains(msg, "dial tcp"):
		return fmt.Errorf("cannot reach Kubernetes API endpoint; verify server URL and network access")
	default:
		return fmt.Errorf("failed to connect to Kubernetes API: %w", err)
	}
}
