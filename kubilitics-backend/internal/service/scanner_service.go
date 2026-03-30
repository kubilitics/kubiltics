package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/scanner"
	"github.com/kubilitics/kubilitics-backend/internal/scanner/adapters"
)

// ScannerService orchestrates security scanning.
type ScannerService interface {
	StartScan(ctx context.Context, targetType, targetPath string, scannerNames []string) (*models.ScanRun, error)
	GetScanRun(ctx context.Context, id string) (*models.ScanRun, error)
	ListScanRuns(ctx context.Context, limit, offset int) ([]*models.ScanRun, int, error)
	ListFindings(ctx context.Context, runID, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error)
	ListAllFindings(ctx context.Context, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error)
	GetStats(ctx context.Context) (*models.ScanStats, error)
	GetReport(ctx context.Context, runID, format string) ([]byte, string, error)
	AvailableTools() []scanner.ToolStatus
}

const maxConcurrentScans = 3

type scannerServiceImpl struct {
	engine *scanner.Engine
	repo   repository.ScannerRepository
	logger *slog.Logger
	sem    chan struct{} // semaphore limiting concurrent scans
}

// NewScannerService creates a new scanner service with all adapters.
func NewScannerService(repo repository.ScannerRepository, logger *slog.Logger) ScannerService {
	if logger == nil {
		logger = slog.Default()
	}

	scanners := []scanner.Scanner{
		adapters.NewTrivyAdapter(),
		adapters.NewSemgrepAdapter(),
		adapters.NewGitleaksAdapter(),
		adapters.NewKubescapeAdapter(),
	}

	engine := scanner.NewEngine(scanners, logger)

	return &scannerServiceImpl{
		engine: engine,
		repo:   repo,
		logger: logger,
		sem:    make(chan struct{}, maxConcurrentScans),
	}
}

func (s *scannerServiceImpl) StartScan(ctx context.Context, targetType, targetPath string, scannerNames []string) (*models.ScanRun, error) {
	// Check if we can accept more scans
	select {
	case s.sem <- struct{}{}:
		// Acquired slot — will release in executeScan
	default:
		return nil, fmt.Errorf("maximum concurrent scans (%d) reached, please wait", maxConcurrentScans)
	}

	scannersJSON, _ := json.Marshal(scannerNames)
	if len(scannerNames) == 0 {
		scannersJSON = []byte("[]")
	}

	now := time.Now().UTC()
	run := &models.ScanRun{
		ID:         uuid.New().String(),
		Status:     models.ScanRunPending,
		TargetType: targetType,
		TargetPath: targetPath,
		Scanners:   string(scannersJSON),
		CreatedAt:  now,
	}

	if err := s.repo.CreateScanRun(ctx, run); err != nil {
		<-s.sem // release slot on failure
		return nil, fmt.Errorf("create scan run: %w", err)
	}

	// Execute scan asynchronously
	go s.executeScan(run.ID, scanner.ScanConfig{
		Target: scanner.ScanTarget{
			Type: scanner.TargetType(targetType),
			Path: targetPath,
		},
		Scanners: scannerNames,
		Timeout:  5 * time.Minute,
	})

	return run, nil
}

func (s *scannerServiceImpl) executeScan(runID string, cfg scanner.ScanConfig) {
	defer func() { <-s.sem }() // release concurrency slot when done

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Update status to running
	now := time.Now().UTC()
	run := &models.ScanRun{
		ID:        runID,
		Status:    models.ScanRunRunning,
		StartedAt: &now,
	}
	if err := s.repo.UpdateScanRun(ctx, run); err != nil {
		s.logger.Error("failed to update scan run to running", "run_id", runID, "error", err)
		return
	}

	results, findings, err := s.engine.Run(ctx, cfg)
	completedAt := time.Now().UTC()
	duration := completedAt.Sub(now)

	if err != nil {
		run.Status = models.ScanRunFailed
		run.ErrorMessage = err.Error()
		run.CompletedAt = &completedAt
		run.DurationMs = duration.Milliseconds()
		_ = s.repo.UpdateScanRun(ctx, run)
		s.logger.Error("scan failed", "run_id", runID, "error", err)
		return
	}

	// Count by severity
	var critical, high, medium, low, info int
	for _, f := range findings {
		switch f.Severity {
		case scanner.SeverityCritical:
			critical++
		case scanner.SeverityHigh:
			high++
		case scanner.SeverityMedium:
			medium++
		case scanner.SeverityLow:
			low++
		case scanner.SeverityInfo:
			info++
		}
	}

	run.Status = models.ScanRunCompleted
	run.TotalFindings = len(findings)
	run.CriticalCount = critical
	run.HighCount = high
	run.MediumCount = medium
	run.LowCount = low
	run.InfoCount = info
	run.DurationMs = duration.Milliseconds()
	run.CompletedAt = &completedAt

	if err := s.repo.UpdateScanRun(ctx, run); err != nil {
		s.logger.Error("failed to update completed scan run", "run_id", runID, "error", err)
	}

	// Persist findings
	dbFindings := make([]models.ScanFinding, 0, len(findings))
	for _, f := range findings {
		cweJSON, _ := json.Marshal(f.CWE)
		cveJSON, _ := json.Marshal(f.CVE)
		metaJSON, _ := json.Marshal(f.Metadata)

		dbFindings = append(dbFindings, models.ScanFinding{
			ID:          f.ID,
			RunID:       runID,
			Tool:        f.Tool,
			RuleID:      f.RuleID,
			Severity:    string(f.Severity),
			Title:       f.Title,
			Description: f.Description,
			FilePath:    f.File,
			StartLine:   f.StartLine,
			EndLine:     f.EndLine,
			Remediation: f.Remediation,
			CWE:         string(cweJSON),
			CVE:         string(cveJSON),
			Confidence:  f.Confidence,
			MetadataRaw: string(metaJSON),
			Status:      models.ScanFindingOpen,
			FirstSeenAt: completedAt,
			LastSeenAt:  completedAt,
		})
	}

	if err := s.repo.CreateScanFindings(ctx, dbFindings); err != nil {
		s.logger.Error("failed to persist findings", "run_id", runID, "count", len(dbFindings), "error", err)
	}

	// Log per-tool summary
	for _, r := range results {
		if r.Skipped {
			s.logger.Info("scanner skipped", "tool", r.Tool, "reason", r.SkipReason)
		} else if r.Error != "" {
			s.logger.Warn("scanner error", "tool", r.Tool, "error", r.Error)
		} else {
			s.logger.Info("scanner completed", "tool", r.Tool, "findings", len(r.Findings), "duration", r.Duration)
		}
	}
	s.logger.Info("scan completed", "run_id", runID, "total_findings", len(findings), "duration", duration)
}

func (s *scannerServiceImpl) GetScanRun(ctx context.Context, id string) (*models.ScanRun, error) {
	return s.repo.GetScanRun(ctx, id)
}

func (s *scannerServiceImpl) ListScanRuns(ctx context.Context, limit, offset int) ([]*models.ScanRun, int, error) {
	return s.repo.ListScanRuns(ctx, limit, offset)
}

func (s *scannerServiceImpl) ListFindings(ctx context.Context, runID, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error) {
	return s.repo.ListScanFindings(ctx, runID, severity, tool, status, limit, offset)
}

func (s *scannerServiceImpl) ListAllFindings(ctx context.Context, severity, tool, status string, limit, offset int) ([]models.ScanFinding, int, error) {
	return s.repo.ListAllFindings(ctx, severity, tool, status, limit, offset)
}

func (s *scannerServiceImpl) GetStats(ctx context.Context) (*models.ScanStats, error) {
	stats, err := s.repo.GetScanStats(ctx)
	if err != nil {
		return nil, err
	}
	trend, err := s.repo.GetScanTrend(ctx, 30)
	if err != nil {
		return stats, nil
	}
	stats.Trend = trend
	return stats, nil
}

func (s *scannerServiceImpl) GetReport(ctx context.Context, runID, format string) ([]byte, string, error) {
	run, err := s.repo.GetScanRun(ctx, runID)
	if err != nil {
		return nil, "", fmt.Errorf("get scan run: %w", err)
	}

	findings, _, err := s.repo.ListScanFindings(ctx, runID, "", "", "", 10000, 0)
	if err != nil {
		return nil, "", fmt.Errorf("get findings: %w", err)
	}

	// Convert DB findings to scanner findings for report
	scanFindings := make([]scanner.Finding, 0, len(findings))
	for _, f := range findings {
		sf := scanner.Finding{
			ID:          f.ID,
			Tool:        f.Tool,
			RuleID:      f.RuleID,
			Severity:    scanner.Severity(f.Severity),
			Title:       f.Title,
			Description: f.Description,
			File:        f.FilePath,
			StartLine:   f.StartLine,
			EndLine:     f.EndLine,
			Remediation: f.Remediation,
			Confidence:  f.Confidence,
		}
		_ = json.Unmarshal([]byte(f.CWE), &sf.CWE)
		_ = json.Unmarshal([]byte(f.CVE), &sf.CVE)
		_ = json.Unmarshal([]byte(f.MetadataRaw), &sf.Metadata)
		scanFindings = append(scanFindings, sf)
	}

	report := &scanner.Report{
		RunID:  runID,
		Status: string(run.Status),
		Target: scanner.ScanTarget{
			Type: scanner.TargetType(run.TargetType),
			Path: run.TargetPath,
		},
		Findings:    scanFindings,
		GeneratedAt: time.Now().UTC(),
	}
	report.BuildSummary()

	switch strings.ToLower(format) {
	case "html":
		data, err := report.GenerateHTML()
		return data, "text/html", err
	case "markdown", "md":
		data, err := report.GenerateMarkdown()
		return data, "text/markdown", err
	default:
		data, err := report.GenerateJSON()
		return data, "application/json", err
	}
}

func (s *scannerServiceImpl) AvailableTools() []scanner.ToolStatus {
	return s.engine.AvailableTools()
}
