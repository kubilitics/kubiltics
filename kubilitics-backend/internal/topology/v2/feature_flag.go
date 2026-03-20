package v2

import (
	"os"
	"strconv"
	"sync"
)

// FeatureFlags manages topology v2 feature flags.
type FeatureFlags struct {
	mu      sync.RWMutex
	enabled bool
}

var (
	globalFlags     *FeatureFlags
	globalFlagsOnce sync.Once
)

// GetFeatureFlags returns the global feature flags instance.
func GetFeatureFlags() *FeatureFlags {
	globalFlagsOnce.Do(func() {
		globalFlags = &FeatureFlags{}
		globalFlags.loadFromEnv()
	})
	return globalFlags
}

func (f *FeatureFlags) loadFromEnv() {
	f.mu.Lock()
	defer f.mu.Unlock()

	val := os.Getenv("TOPOLOGY_V2_ENABLED")
	if val == "" {
		f.enabled = false
		return
	}

	b, err := strconv.ParseBool(val)
	if err != nil {
		f.enabled = false
		return
	}
	f.enabled = b
}

// IsEnabled returns whether topology v2 is enabled.
func (f *FeatureFlags) IsEnabled() bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.enabled
}

// SetEnabled sets the topology v2 enabled flag.
func (f *FeatureFlags) SetEnabled(enabled bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.enabled = enabled
}

// ToJSON returns the feature flags as a map for API response.
func (f *FeatureFlags) ToJSON() map[string]interface{} {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return map[string]interface{}{
		"topology_v2_enabled": f.enabled,
	}
}
