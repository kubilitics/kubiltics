//go:build !race

package cli

// raceDetectorEnabled is false when compiled without -race.
const raceDetectorEnabled = false
