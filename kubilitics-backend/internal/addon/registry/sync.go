package registry

import (
	"context"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

const (
	syncPageSize    = 100
	syncRateLimit   = 1 * time.Second
	syncMaxPages    = 250 // cap at 25k packages per run to avoid unbounded runs
)

// SyncArtifactHub paginates the Artifact Hub packages search API and upserts
// all Helm charts (kind=0) into the addon_catalog with tier=COMMUNITY.
// Rate-limits requests to avoid 429. Intended to run in a background goroutine
// (e.g. on startup and/or on a timer).
func SyncArtifactHub(ctx context.Context, repo repository.AddOnRepository, ahClient *ArtifactHubClient, logger *slog.Logger) error {
	if logger == nil {
		logger = slog.Default()
	}
	offset := 0
	totalSynced := 0
	for page := 0; page < syncMaxPages; page++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		resp, err := ahClient.Search(ctx, "", "0", syncPageSize, offset)
		if err != nil {
			return err
		}
		if len(resp.Packages) == 0 {
			break
		}
		entries := make([]models.AddOnEntry, 0, len(resp.Packages))
		for i := range resp.Packages {
			entry := ahClient.mapToAddOnEntry(resp.Packages[i])
			entry.CreatedAt = time.Now().UTC()
			entry.UpdatedAt = time.Now().UTC()
			entries = append(entries, entry)
		}
		if err := repo.UpsertAddonEntries(ctx, entries); err != nil {
			return err
		}
		totalSynced += len(entries)
		logger.Info("artifact hub sync page", "page", page+1, "count", len(entries), "total_synced", totalSynced)
		if len(resp.Packages) < syncPageSize {
			break
		}
		offset += syncPageSize
		select {
		case <-time.After(syncRateLimit):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	logger.Info("artifact hub sync completed", "total_synced", totalSynced)
	return nil
}
