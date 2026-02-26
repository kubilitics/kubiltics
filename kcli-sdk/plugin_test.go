package sdk_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	sdk "github.com/kubilitics/kcli-sdk"
	"github.com/kubilitics/kcli-sdk/testutil"
)

// ---------------------------------------------------------------------------
// TestPlugin (via testutil)
// ---------------------------------------------------------------------------

func TestTestPlugin_ImplementsPlugin(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", []string{"status"})
	// Compile-time check: *TestPlugin must implement sdk.Plugin.
	var _ sdk.Plugin = p
	if p.Name() != "myplugin" {
		t.Fatalf("expected name 'myplugin', got %q", p.Name())
	}
	if p.Version() != "1.0.0" {
		t.Fatalf("expected version '1.0.0', got %q", p.Version())
	}
	if len(p.Args()) != 1 || p.Args()[0] != "status" {
		t.Fatalf("expected args [status], got %v", p.Args())
	}
}

func TestTestPlugin_CapturesStdout(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", nil)
	fmt.Fprintln(p.Stdout(), "hello from plugin")
	if !strings.Contains(p.OutString(), "hello from plugin") {
		t.Fatalf("expected captured stdout, got: %q", p.OutString())
	}
}

func TestTestPlugin_CapturesStderr(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", nil)
	fmt.Fprintln(p.Stderr(), "warning: something")
	if !strings.Contains(p.ErrString(), "warning: something") {
		t.Fatalf("expected captured stderr, got: %q", p.ErrString())
	}
}

func TestTestPlugin_SetEnv_AndRetrieve(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", nil).SetEnv("MY_KEY", "my-value")
	if got := p.Env("MY_KEY"); got != "my-value" {
		t.Fatalf("expected env MY_KEY='my-value', got %q", got)
	}
	// Also accessible without KCLI_ prefix stripping.
	if got := p.Env("KCLI_MY_KEY"); got != "my-value" {
		t.Fatalf("expected env KCLI_MY_KEY='my-value', got %q", got)
	}
}

func TestTestPlugin_Reset_ClearsBuffers(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", nil)
	fmt.Fprintln(p.Stdout(), "data")
	p.Reset()
	if p.OutString() != "" {
		t.Fatalf("expected empty stdout after Reset, got: %q", p.OutString())
	}
}

func TestTestPlugin_Kubeconfig_Default(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", nil)
	// Default is /dev/null (test-safe).
	if p.Kubeconfig() == "" {
		t.Fatal("expected non-empty kubeconfig")
	}
}

// ---------------------------------------------------------------------------
// KubeClients helper
// ---------------------------------------------------------------------------

func TestKubeClients_ReturnsFields(t *testing.T) {
	p := testutil.NewTestPlugin("myplugin", "1.0.0", nil).
		SetKubeContext("prod-cluster").
		SetNamespace("payments").
		SetKubeconfig("/home/user/.kube/config")
	cfg := sdk.KubeClients(p)
	if cfg.Context != "prod-cluster" {
		t.Fatalf("expected context 'prod-cluster', got %q", cfg.Context)
	}
	if cfg.Namespace != "payments" {
		t.Fatalf("expected namespace 'payments', got %q", cfg.Namespace)
	}
	if cfg.Kubeconfig != "/home/user/.kube/config" {
		t.Fatalf("expected kubeconfig path, got %q", cfg.Kubeconfig)
	}
}

// ---------------------------------------------------------------------------
// PluginFunc
// ---------------------------------------------------------------------------

func TestPluginFunc_IsIdentity(t *testing.T) {
	called := false
	fn := func(ctx context.Context, p sdk.Plugin) error {
		called = true
		return nil
	}
	wrapped := sdk.PluginFunc(fn)
	p := testutil.NewTestPlugin("test", "1.0.0", nil)
	if err := wrapped(context.Background(), p); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !called {
		t.Fatal("expected handler to be called")
	}
}

// ---------------------------------------------------------------------------
// SDKVersion
// ---------------------------------------------------------------------------

func TestSDKVersion_IsSemver(t *testing.T) {
	parts := strings.Split(sdk.SDKVersion, ".")
	if len(parts) != 3 {
		t.Fatalf("expected semver X.Y.Z, got %q", sdk.SDKVersion)
	}
}
