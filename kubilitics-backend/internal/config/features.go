package config

import (
	"os"
	"strings"
)

// FeaturePresenceV2 returns whether the Cluster Presence Layer (onboarding-v2)
// is enabled at runtime. Defaults off during rollout; flipped on in Phase 6
// of the migration.
func FeaturePresenceV2() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FEATURE_PRESENCE_V2")))
	return v == "true" || v == "1" || v == "yes"
}
