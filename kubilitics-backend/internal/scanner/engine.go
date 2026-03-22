package scanner

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// Engine orchestrates multiple scanners in parallel.
type Engine struct {
	scanners []Scanner
	logger   *slog.Logger
}

// NewEngine creates a scanning engine with all registered adapters.
func NewEngine(scanners []Scanner, logger *slog.Logger) *Engine {
	if logger == nil {
		logger = slog.Default()
	}
	return &Engine{
		scanners: scanners,
		logger:   logger,
	}
}

// ToolStatus reports availability of a scanner tool.
type ToolStatus struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
}

// AvailableTools returns the status of all registered scanners.
func (e *Engine) AvailableTools() []ToolStatus {
	tools := make([]ToolStatus, len(e.scanners))
	for i, s := range e.scanners {
		tools[i] = ToolStatus{Name: s.Name(), Available: s.Available()}
	}
	return tools
}

// Run executes all (or specified) scanners in parallel and returns combined results.
func (e *Engine) Run(ctx context.Context, cfg ScanConfig) ([]ScanResult, []Finding, error) {
	selected := e.selectScanners(cfg.Scanners)
	if len(selected) == 0 {
		return nil, nil, fmt.Errorf("no scanners available")
	}

	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}

	var (
		mu      sync.Mutex
		results = make([]ScanResult, 0, len(selected))
		wg      sync.WaitGroup
	)

	for _, s := range selected {
		wg.Add(1)
		go func(sc Scanner) {
			defer wg.Done()

			if !sc.Available() {
				mu.Lock()
				results = append(results, ScanResult{
					Tool:       sc.Name(),
					Skipped:    true,
					SkipReason: fmt.Sprintf("%s binary not found in PATH", sc.Name()),
				})
				mu.Unlock()
				e.logger.Warn("scanner not available, skipping", "tool", sc.Name())
				return
			}

			scanCtx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()

			start := time.Now()
			result, err := sc.Scan(scanCtx, cfg.Target)
			elapsed := time.Since(start)

			if err != nil {
				mu.Lock()
				results = append(results, ScanResult{
					Tool:     sc.Name(),
					Duration: elapsed,
					Error:    err.Error(),
				})
				mu.Unlock()
				e.logger.Error("scanner failed", "tool", sc.Name(), "error", err, "duration", elapsed)
				return
			}

			result.Duration = elapsed
			for i := range result.Findings {
				result.Findings[i].ComputeID()
			}

			mu.Lock()
			results = append(results, *result)
			mu.Unlock()

			e.logger.Info("scanner completed", "tool", sc.Name(), "findings", len(result.Findings), "duration", elapsed)
		}(s)
	}

	wg.Wait()

	// Merge and filter findings
	var allFindings []Finding
	for _, r := range results {
		allFindings = append(allFindings, r.Findings...)
	}

	allFindings = Deduplicate(allFindings)

	if cfg.SeverityThreshold != "" {
		threshold := SeverityRank(cfg.SeverityThreshold)
		filtered := make([]Finding, 0, len(allFindings))
		for _, f := range allFindings {
			if SeverityRank(f.Severity) <= threshold {
				filtered = append(filtered, f)
			}
		}
		allFindings = filtered
	}

	return results, allFindings, nil
}

func (e *Engine) selectScanners(names []string) []Scanner {
	if len(names) == 0 {
		return e.scanners
	}
	nameSet := make(map[string]bool, len(names))
	for _, n := range names {
		nameSet[n] = true
	}
	var selected []Scanner
	for _, s := range e.scanners {
		if nameSet[s.Name()] {
			selected = append(selected, s)
		}
	}
	return selected
}
