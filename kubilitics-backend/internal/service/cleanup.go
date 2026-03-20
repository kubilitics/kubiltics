package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// CleanupService handles background cleanup tasks
type CleanupService struct {
	repo   *repository.SQLiteRepository
	cfg    *config.Config
	log    *slog.Logger
	stopCh chan struct{}
}

// NewCleanupService creates a new cleanup service
func NewCleanupService(repo *repository.SQLiteRepository, cfg *config.Config, log *slog.Logger) *CleanupService {
	return &CleanupService{
		repo:   repo,
		cfg:    cfg,
		log:    log,
		stopCh: make(chan struct{}),
	}
}

// Start starts the cleanup service background goroutine
func (s *CleanupService) Start(ctx context.Context) {
	interval := time.Duration(s.cfg.TokenCleanupIntervalSec) * time.Second
	if interval <= 0 {
		interval = 1 * time.Hour // Default to 1 hour
	}

	s.log.Info("Starting cleanup service", "interval", interval)

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Run immediately on start
		s.runCleanup(ctx)

		for {
			select {
			case <-ticker.C:
				s.runCleanup(ctx)
			case <-s.stopCh:
				s.log.Info("Cleanup service stopped")
				return
			case <-ctx.Done():
				s.log.Info("Cleanup service context cancelled")
				return
			}
		}
	}()
}

// Stop stops the cleanup service
func (s *CleanupService) Stop() {
	close(s.stopCh)
}

// runCleanup runs the token cleanup job
func (s *CleanupService) runCleanup(ctx context.Context) {
	start := time.Now()
	s.log.Debug("Running token cleanup job")

	// Calculate cutoff time: tokens older than max token TTL + 24 hour grace period
	// Access tokens expire in 15 minutes, refresh tokens in 7 days
	// We'll clean tokens older than 8 days (7 days + 1 day grace)
	cutoffTime := time.Now().Add(-8 * 24 * time.Hour)

	deleted, err := s.repo.DeleteExpiredTokens(ctx, cutoffTime)
	if err != nil {
		s.log.Error("Token cleanup job failed", "error", err)
		return
	}

	duration := time.Since(start)
	if deleted > 0 {
		metrics.TokenCleanupDeletedTotal.Add(float64(deleted))
		s.log.Info("Token cleanup completed", "deleted", deleted, "duration_ms", duration.Milliseconds())
	} else {
		s.log.Debug("Token cleanup completed", "deleted", deleted, "duration_ms", duration.Milliseconds())
	}
}
