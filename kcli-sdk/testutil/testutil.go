// Package testutil provides helpers for unit-testing kcli plugins.
//
// The primary type is TestPlugin, which implements sdk.Plugin with
// configurable fields and captures output for assertion.
//
// Typical test:
//
//	func TestMyPlugin(t *testing.T) {
//	    p := testutil.NewTestPlugin("myplugin", "1.0.0", []string{"status"})
//	    if err := run(context.Background(), p); err != nil {
//	        t.Fatalf("unexpected error: %v", err)
//	    }
//	    if !strings.Contains(p.OutString(), "OK") {
//	        t.Fatalf("expected 'OK' in output: %s", p.OutString())
//	    }
//	}
package testutil

import (
	"bytes"
	"io"
	"strings"
)

// TestPlugin is a test double for sdk.Plugin.
// It captures stdout and stderr so tests can assert on output.
type TestPlugin struct {
	name       string
	version    string
	args       []string
	kubeCtx    string
	namespace  string
	kubeconfig string
	env        map[string]string
	stdout     *bytes.Buffer
	stderr     *bytes.Buffer
}

// NewTestPlugin creates a TestPlugin with the given name, version, and args.
// Additional configuration can be done via the Set* methods.
func NewTestPlugin(name, version string, args []string) *TestPlugin {
	return &TestPlugin{
		name:       name,
		version:    version,
		args:       args,
		kubeCtx:    "test-context",
		namespace:  "default",
		kubeconfig: "/dev/null",
		env:        map[string]string{},
		stdout:     &bytes.Buffer{},
		stderr:     &bytes.Buffer{},
	}
}

// SetKubeContext sets the Kubernetes context name.
func (t *TestPlugin) SetKubeContext(ctx string) *TestPlugin {
	t.kubeCtx = ctx
	return t
}

// SetNamespace sets the active Kubernetes namespace.
func (t *TestPlugin) SetNamespace(ns string) *TestPlugin {
	t.namespace = ns
	return t
}

// SetKubeconfig sets the kubeconfig path.
func (t *TestPlugin) SetKubeconfig(path string) *TestPlugin {
	t.kubeconfig = path
	return t
}

// SetEnv sets an environment variable visible via Plugin.Env().
func (t *TestPlugin) SetEnv(key, value string) *TestPlugin {
	t.env[strings.TrimPrefix(key, "KCLI_")] = value
	return t
}

// ── sdk.Plugin interface ──────────────────────────────────────────────────────

func (t *TestPlugin) Name() string        { return t.name }
func (t *TestPlugin) Version() string     { return t.version }
func (t *TestPlugin) Args() []string      { return t.args }
func (t *TestPlugin) KubeContext() string { return t.kubeCtx }
func (t *TestPlugin) Namespace() string   { return t.namespace }
func (t *TestPlugin) Kubeconfig() string  { return t.kubeconfig }
func (t *TestPlugin) Stdout() io.Writer   { return t.stdout }
func (t *TestPlugin) Stderr() io.Writer   { return t.stderr }
func (t *TestPlugin) Env(key string) string {
	key = strings.TrimPrefix(key, "KCLI_")
	return t.env[key]
}

// ── Test assertions ───────────────────────────────────────────────────────────

// OutString returns everything written to Stdout() as a string.
func (t *TestPlugin) OutString() string { return t.stdout.String() }

// ErrString returns everything written to Stderr() as a string.
func (t *TestPlugin) ErrString() string { return t.stderr.String() }

// Reset clears both stdout and stderr buffers.
func (t *TestPlugin) Reset() {
	t.stdout.Reset()
	t.stderr.Reset()
}
