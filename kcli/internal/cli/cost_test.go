package cli

import (
	"os"
	"testing"

	kcfg "github.com/kubilitics/kcli/internal/config"
)

func TestDetectOpenCostEndpoint(t *testing.T) {
	// Config takes precedence
	a1 := &app{cfg: &kcfg.Config{Integrations: kcfg.IntegrationsConfig{OpenCostEndpoint: "http://opencost:9090"}}}
	if got := a1.detectOpenCostEndpoint(); got != "http://opencost:9090" {
		t.Errorf("expected http://opencost:9090 from config, got %q", got)
	}

	// OPENCOST_ENDPOINT env when no config
	os.Setenv("OPENCOST_ENDPOINT", "http://opencost-svc:9003")
	defer os.Unsetenv("OPENCOST_ENDPOINT")
	a2 := &app{cfg: nil}
	if got := a2.detectOpenCostEndpoint(); got != "http://opencost-svc:9003" {
		t.Errorf("expected http://opencost-svc:9003 from env, got %q", got)
	}
	// Config overrides env
	a3 := &app{cfg: &kcfg.Config{Integrations: kcfg.IntegrationsConfig{OpenCostEndpoint: "http://config:9090"}}}
	if got := a3.detectOpenCostEndpoint(); got != "http://config:9090" {
		t.Errorf("expected config to override env, got %q", got)
	}
}
