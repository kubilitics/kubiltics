package config

import (
	"os"
	"testing"
)

// Phase 6 flipped the default on. The feature is now on unless the user
// explicitly opts out via FEATURE_PRESENCE_V2=false (or a falsy variant).

func TestFeaturePresenceV2_DefaultOn(t *testing.T) {
	os.Unsetenv("FEATURE_PRESENCE_V2")
	if !FeaturePresenceV2() {
		t.Fatal("default must be on after Phase 6 flip")
	}
}

func TestFeaturePresenceV2_EnvOn(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "true")
	if !FeaturePresenceV2() {
		t.Fatal("FEATURE_PRESENCE_V2=true should enable")
	}
}

func TestFeaturePresenceV2_EnvFalseDisables(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "false")
	if FeaturePresenceV2() {
		t.Fatal("FEATURE_PRESENCE_V2=false should disable (explicit opt-out for rollback)")
	}
}

func TestFeaturePresenceV2_EnvZeroDisables(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "0")
	if FeaturePresenceV2() {
		t.Fatal("FEATURE_PRESENCE_V2=0 should disable")
	}
}

func TestFeaturePresenceV2_EnvNoDisables(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "no")
	if FeaturePresenceV2() {
		t.Fatal("FEATURE_PRESENCE_V2=no should disable")
	}
}

// Junk values are treated as "unset" and therefore fall back to the
// (now-true) default. This matches the convention applied at flip time:
// only literal falsy tokens force-off; anything else respects the default.
func TestFeaturePresenceV2_JunkFallsBackToDefault(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "sure")
	if !FeaturePresenceV2() {
		t.Fatal("non-recognized value should fall back to default (on)")
	}
}

func TestFeaturePresenceV2_EmptyFallsBackToDefault(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "")
	if !FeaturePresenceV2() {
		t.Fatal("empty value should fall back to default (on)")
	}
}
