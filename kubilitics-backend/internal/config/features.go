package config

import (
	"os"
	"strings"
)

// FeaturePresenceV2 returns whether the Cluster Presence Layer (onboarding-v2)
// is enabled at runtime.
//
// Phase 6 (2026-04-24) flipped the default on. The feature is now on unless
// the user explicitly opts out — an env var escape hatch is retained so
// operators can roll back without rebuilding.
//
// Truthy values (case-insensitive): "true", "1", "yes".
// Falsy values (case-insensitive, force off): "false", "0", "no".
// Anything else (including empty / unset) falls back to the default of true.
func FeaturePresenceV2() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("FEATURE_PRESENCE_V2")))
	switch v {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		return true // default-on as of Phase 6
	}
}
