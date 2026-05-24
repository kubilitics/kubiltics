package certification

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

// Gate is a lightweight, thread-safe certification gate that the MCP server
// consults before executing any tool.  It holds a snapshot of certification
// grades loaded from a JSON report on disk and refreshes it periodically.
//
// Usage in MCP server:
//
//	gate := certification.NewGate("/path/to/tool-certifications.json")
//	gate.Start(ctx)
//	...
//	if err := gate.Check("restart_pod"); err != nil {
//	    return nil, err
//	}
type Gate struct {
	reportPath  string
	refreshEvery time.Duration

	mu      sync.RWMutex
	grades  map[string]Grade // tool name → grade
	blocked map[string]string // tool name → reason (destructive + uncertified)
}

// NewGate creates a certification gate that reads from the given report path.
// If the report file does not exist, the gate starts in permissive mode
// (all tools allowed) and retries loading after each refresh interval.
func NewGate(reportPath string) *Gate {
	g := &Gate{
		reportPath:   reportPath,
		refreshEvery: 5 * time.Minute,
		grades:       make(map[string]Grade),
		blocked:      make(map[string]string),
	}
	if err := g.load(); err != nil {
		log.Printf("[certification-gate] WARN: could not load report (%v) — running in permissive mode", err)
	}
	return g
}

// NewGateWithRefresh creates a gate with a custom refresh interval (useful for tests).
func NewGateWithRefresh(reportPath string, refreshEvery time.Duration) *Gate {
	g := &Gate{
		reportPath:   reportPath,
		refreshEvery: refreshEvery,
		grades:       make(map[string]Grade),
		blocked:      make(map[string]string),
	}
	if err := g.load(); err != nil {
		log.Printf("[certification-gate] WARN: %v — permissive mode", err)
	}
	return g
}

// Start begins the background refresh loop.  Call with a cancellable context;
// the loop exits when ctx is cancelled.
func (g *Gate) Start(ctx context.Context) {
	go func() {
		t := time.NewTicker(g.refreshEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := g.load(); err != nil {
					log.Printf("[certification-gate] WARN: refresh failed: %v", err)
				}
			}
		}
	}()
}

// load reads the certification report from disk and updates internal state.
func (g *Gate) load() error {
	if _, err := os.Stat(g.reportPath); os.IsNotExist(err) {
		return fmt.Errorf("report not found at %s", g.reportPath)
	}
	report, err := LoadJSON(g.reportPath)
	if err != nil {
		return err
	}

	grades := CertifiedSet(report)
	blocked := BlockedTools(report)

	g.mu.Lock()
	g.grades = grades
	g.blocked = blocked
	g.mu.Unlock()

	log.Printf("[certification-gate] loaded %d tools: %d certified, %d provisional, %d uncertified, %d blocked",
		report.TotalTools, report.Certified, report.Provisional, report.Uncertified, len(blocked))
	return nil
}

// Check returns an error if the tool is blocked by the certification gate.
// Permissive: if no report has been loaded, all tools pass.
// Destructive tools with GradeUncertified are blocked.
// Non-destructive tools are never blocked (only warned).
func (g *Gate) Check(toolName string) error {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if reason, blocked := g.blocked[toolName]; blocked {
		return fmt.Errorf("certification gate blocked: %s — %s", toolName, reason)
	}
	return nil
}

// Grade returns the certification grade for a tool.
// Returns GradeProvisional if the tool is not in the loaded report
// (permissive default — tool may be new or report not yet generated).
func (g *Gate) Grade(toolName string) Grade {
	g.mu.RLock()
	defer g.mu.RUnlock()
	if g, ok := g.grades[toolName]; ok {
		return g
	}
	return GradeProvisional
}

// Warn returns a non-empty string if the tool is Provisional, empty string if Certified.
// Callers can annotate tool results with this warning.
func (g *Gate) Warn(toolName string) string {
	grade := g.Grade(toolName)
	if grade == GradeProvisional {
		return fmt.Sprintf("tool %q is Provisional — live validation or coverage data incomplete", toolName)
	}
	return ""
}

// Summary returns a snapshot of grade counts for health checks.
func (g *Gate) Summary() map[string]int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	counts := map[string]int{"certified": 0, "provisional": 0, "uncertified": 0, "blocked": len(g.blocked)}
	for _, grade := range g.grades {
		counts[string(grade)]++
	}
	return counts
}
