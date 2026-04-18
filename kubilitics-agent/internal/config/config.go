package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	HubURL            string
	BootstrapToken    string
	CABundlePath      string
	InsecureSkipTLS   bool
	CredsNamespace    string
	CredsSecretName   string
	HeartbeatInterval time.Duration
	AgentVersion      string
}

func FromEnv() (Config, error) {
	c := Config{
		HubURL:            os.Getenv("KUBILITICS_HUB_URL"),
		BootstrapToken:    os.Getenv("KUBILITICS_HUB_TOKEN"),
		CABundlePath:      os.Getenv("KUBILITICS_HUB_CA_BUNDLE"),
		InsecureSkipTLS:   strings.EqualFold(os.Getenv("KUBILITICS_HUB_INSECURE"), "true"),
		CredsNamespace:    envDefault("POD_NAMESPACE", "kubilitics-system"),
		CredsSecretName:   envDefault("KUBILITICS_CREDS_SECRET", "kubilitics-agent-creds"),
		HeartbeatInterval: 30 * time.Second,
		AgentVersion:      envDefault("KUBILITICS_AGENT_VERSION", "0.0.0-dev"),
	}
	if c.HubURL == "" {
		return c, errors.New("KUBILITICS_HUB_URL required")
	}
	if !c.InsecureSkipTLS && strings.HasPrefix(c.HubURL, "http://") {
		return c, errors.New("plain HTTP refused; set KUBILITICS_HUB_URL to https or KUBILITICS_HUB_INSECURE=true (dev only)")
	}
	return c, nil
}

func envDefault(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
