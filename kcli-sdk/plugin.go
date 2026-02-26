// Package sdk is the official Software Development Kit for building kcli plugins.
//
// A minimal plugin using this SDK:
//
//	package main
//
//	import (
//	    "context"
//	    "fmt"
//
//	    sdk "github.com/kubilitics/kcli-sdk"
//	)
//
//	func main() {
//	    sdk.PluginMain(sdk.PluginFunc(run))
//	}
//
//	func run(ctx context.Context, p sdk.Plugin) error {
//	    fmt.Fprintf(p.Stdout(), "Hello from %s v%s!\n", p.Name(), p.Version())
//	    clients, err := p.KubeClients()
//	    _ = clients // use Kubernetes API here
//	    return err
//	}
//
// # Plugin lifecycle
//
// PluginMain reads the runtime environment injected by kcli (via KCLI_*
// environment variables), constructs a Plugin value and calls the provided
// handler.  On return it exits with code 0 (success) or 1 (error).
//
// # Versioning
//
// The SDK follows semantic versioning.  Plugins should declare a minimum SDK
// version in their manifest:
//
//	minSDKVersion: "0.1.0"
//
// kcli verifies this constraint before executing SDK-based plugins.
package sdk

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
)

// SDKVersion is the current version of this SDK module.
// It is embedded in the plugin binary at link time and reported to kcli
// via the KCLI_SDK_VERSION environment variable on startup.
const SDKVersion = "0.1.0"

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

// Plugin is the runtime context injected into every plugin handler.
// It provides access to the plugin's metadata, the active Kubernetes
// configuration, and I/O streams.
//
// Plugin values are constructed by PluginMain and must not be created
// directly by plugin code.
type Plugin interface {
	// Name returns the plugin name (the value declared in plugin.yaml).
	Name() string

	// Version returns the plugin version (from plugin.yaml).
	Version() string

	// Args returns the arguments passed after the plugin name on the kcli
	// command line.  e.g. `kcli argocd app sync` → Args() == ["app","sync"].
	Args() []string

	// KubeContext returns the active Kubernetes context name.
	// Equivalent to $(kubectl config current-context).
	KubeContext() string

	// Namespace returns the active Kubernetes namespace (from --namespace or
	// the context default).
	Namespace() string

	// Kubeconfig returns the path to the active kubeconfig file.
	Kubeconfig() string

	// Stdout returns the writer plugins should use for standard output.
	// Always use p.Stdout() rather than os.Stdout so that output can be
	// captured in tests via NewTestPlugin().
	Stdout() io.Writer

	// Stderr returns the writer plugins should use for error output.
	Stderr() io.Writer

	// Env returns the value of an environment variable, with the KCLI_
	// prefix stripped if present.
	Env(key string) string
}

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

// Handler is the function signature for plugin logic.
type Handler func(ctx context.Context, p Plugin) error

// PluginFunc adapts a Handler function to the Handler type (no-op, provided
// for clarity when using function literals).
func PluginFunc(fn Handler) Handler { return fn }

// ---------------------------------------------------------------------------
// PluginMain
// ---------------------------------------------------------------------------

// PluginMain is the canonical entry point for SDK-based kcli plugins.
// It reads the runtime environment, constructs a Plugin, calls handler, and
// exits with the appropriate code.
//
// Typical usage (the only line in main()):
//
//	func main() { sdk.PluginMain(sdk.PluginFunc(run)) }
func PluginMain(handler Handler) {
	p := newRuntimePlugin()
	// Announce SDK version so kcli can verify minSDKVersion constraints.
	_ = os.Setenv("KCLI_SDK_VERSION", SDKVersion)

	if err := handler(context.Background(), p); err != nil {
		fmt.Fprintf(p.Stderr(), "error: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

// ---------------------------------------------------------------------------
// runtimePlugin — reads the KCLI_* environment variables injected by kcli
// ---------------------------------------------------------------------------

type runtimePlugin struct {
	name       string
	version    string
	args       []string
	kubeCtx    string
	namespace  string
	kubeconfig string
	stdout     io.Writer
	stderr     io.Writer
}

func (r *runtimePlugin) Name() string        { return r.name }
func (r *runtimePlugin) Version() string     { return r.version }
func (r *runtimePlugin) Args() []string      { return r.args }
func (r *runtimePlugin) KubeContext() string { return r.kubeCtx }
func (r *runtimePlugin) Namespace() string   { return r.namespace }
func (r *runtimePlugin) Kubeconfig() string  { return r.kubeconfig }
func (r *runtimePlugin) Stdout() io.Writer   { return r.stdout }
func (r *runtimePlugin) Stderr() io.Writer   { return r.stderr }
func (r *runtimePlugin) Env(key string) string {
	key = strings.TrimPrefix(key, "KCLI_")
	if v := os.Getenv("KCLI_" + key); v != "" {
		return v
	}
	return os.Getenv(key)
}

func newRuntimePlugin() *runtimePlugin {
	// kcli injects KCLI_PLUGIN_NAME, KCLI_PLUGIN_VERSION, KCLI_PLUGIN_ARGS,
	// KCLI_CONTEXT, KCLI_NAMESPACE, KUBECONFIG before exec'ing the plugin.
	args := []string{}
	if raw := os.Getenv("KCLI_PLUGIN_ARGS"); raw != "" {
		args = strings.Split(raw, "\x00")
	}
	kc := os.Getenv("KUBECONFIG")
	if kc == "" {
		if home, err := os.UserHomeDir(); err == nil {
			kc = home + "/.kube/config"
		}
	}
	return &runtimePlugin{
		name:       envOr("KCLI_PLUGIN_NAME", "unknown"),
		version:    envOr("KCLI_PLUGIN_VERSION", "0.0.0"),
		args:       args,
		kubeCtx:    envOr("KCLI_CONTEXT", ""),
		namespace:  envOr("KCLI_NAMESPACE", "default"),
		kubeconfig: kc,
		stdout:     os.Stdout,
		stderr:     os.Stderr,
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// ---------------------------------------------------------------------------
// KubeClients (lightweight stub — plugins that need the full client-go API
// should import k8s.io/client-go directly; this helper covers the common case)
// ---------------------------------------------------------------------------

// KubeClients returns a thin struct containing the kubeconfig path and
// active context.  SDK-based plugins use this to bootstrap their own
// client-go clients without re-reading the environment.
func KubeClients(p Plugin) KubeClientConfig {
	return KubeClientConfig{
		Kubeconfig: p.Kubeconfig(),
		Context:    p.KubeContext(),
		Namespace:  p.Namespace(),
	}
}

// KubeClientConfig holds the resolved Kubernetes client bootstrap parameters.
// Pass these to client-go's clientcmd.BuildConfigFromFlags or equivalent.
type KubeClientConfig struct {
	// Kubeconfig is the path to the kubeconfig file.
	Kubeconfig string
	// Context is the Kubernetes context name.
	Context string
	// Namespace is the target namespace.
	Namespace string
}
