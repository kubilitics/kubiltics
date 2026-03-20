package lifecycle

import (
	"testing"

	"github.com/Masterminds/semver/v3"
	"github.com/stretchr/testify/assert"
)

func TestAllowedPatchOnly(t *testing.T) {
	v1_0_0 := semver.MustParse("1.0.0")
	v1_0_1 := semver.MustParse("1.0.1")
	v1_1_0 := semver.MustParse("1.1.0")
	v2_0_0 := semver.MustParse("2.0.0")

	assert.True(t, allowedPatchOnly(v1_0_0, v1_0_1))
	assert.False(t, allowedPatchOnly(v1_0_0, v1_1_0))
	assert.False(t, allowedPatchOnly(v1_0_0, v2_0_0))
}

func TestAllowedMinor(t *testing.T) {
	v1_0_0 := semver.MustParse("1.0.0")
	v1_0_1 := semver.MustParse("1.0.1")
	v1_1_0 := semver.MustParse("1.1.0")
	v1_2_5 := semver.MustParse("1.2.5")
	v2_0_0 := semver.MustParse("2.0.0")

	assert.True(t, allowedMinor(v1_0_0, v1_0_1))
	assert.True(t, allowedMinor(v1_0_0, v1_1_0))
	assert.True(t, allowedMinor(v1_0_0, v1_2_5))
	assert.False(t, allowedMinor(v1_0_0, v2_0_0))
}
