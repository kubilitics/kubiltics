//go:build race

package ai

// underRaceDetector is true when compiled with -race. Performance tests use
// this to skip time-based assertions that are meaningless under the race
// detector (which adds ~10–20× latency overhead).
const underRaceDetector = true
