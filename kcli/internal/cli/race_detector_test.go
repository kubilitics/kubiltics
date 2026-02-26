//go:build race

package cli

// raceDetectorEnabled is true when compiled with -race.
// Performance tests use this to skip time-based assertions.
const raceDetectorEnabled = true
