//go:build !race

package ai

// underRaceDetector is false when compiled without -race.
const underRaceDetector = false
