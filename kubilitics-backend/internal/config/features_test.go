package config

import (
	"os"
	"testing"
)

func TestFeaturePresenceV2_DefaultOff(t *testing.T) {
	os.Unsetenv("FEATURE_PRESENCE_V2")
	if FeaturePresenceV2() {
		t.Fatal("default must be off")
	}
}

func TestFeaturePresenceV2_EnvOn(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "true")
	if !FeaturePresenceV2() {
		t.Fatal("FEATURE_PRESENCE_V2=true should enable")
	}
}

func TestFeaturePresenceV2_RejectsJunk(t *testing.T) {
	t.Setenv("FEATURE_PRESENCE_V2", "sure")
	if FeaturePresenceV2() {
		t.Fatal("only literal true/1/yes should enable")
	}
}
