package registry

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

type Registry struct {
	repo     repository.AddOnRepository
	ahClient *ArtifactHubClient
	cache    *RegistryCache
	logger   *slog.Logger
}

func NewRegistry(repo repository.AddOnRepository, logger *slog.Logger) *Registry {
	if logger == nil {
		logger = slog.Default()
	}
	return &Registry{
		repo:     repo,
		ahClient: NewArtifactHubClient(),
		cache:    NewRegistryCache(coreCacheTTL),
		logger:   logger,
	}
}

// catalogHashKey is the key used in addon_catalog_meta to store the catalog content hash.
const catalogHashKey = "core_catalog_hash"

// SeedOnStartup seeds the core addon catalog into the database on server startup.
// It uses a content hash to skip the expensive DELETE+INSERT cycle when the embedded catalog
// JSON files have not changed since the last startup. This prevents a brief window where
// catalog rows are absent and concurrent requests receive 404 responses.
func (r *Registry) SeedOnStartup(ctx context.Context) error {
	// Compute hash of the current embedded catalog content.
	currentHash, err := LoadCoreCatalogHash()
	if err != nil {
		return fmt.Errorf("compute core catalog hash: %w", err)
	}

	// Compare against the hash stored from the previous seed.
	storedHash, err := r.repo.GetCatalogMeta(ctx, catalogHashKey)
	if err != nil {
		return fmt.Errorf("read stored catalog hash: %w", err)
	}
	if storedHash == currentHash {
		r.logger.Info("core addon catalog unchanged — skipping seed", "hash", currentHash[:12])
		return nil
	}

	files, err := LoadCoreCatalog()
	if err != nil {
		return fmt.Errorf("load core catalog: %w", err)
	}

	entries := make([]models.AddOnEntry, 0, len(files))
	var deps []models.AddOnDependency
	var conflicts []models.AddOnConflict
	var crds []models.AddOnCRDOwnership
	var rbac []models.AddOnRBACRule
	var costs []models.AddOnCostModel
	var versions []models.VersionChangelog

	for i := range files {
		if err := ValidateCatalogFile(files[i]); err != nil {
			return fmt.Errorf("validate core catalog entry %s: %w", files[i].AddOn.ID, err)
		}
		entries = append(entries, files[i].AddOn)
		deps = append(deps, files[i].Dependencies...)
		conflicts = append(conflicts, files[i].Conflicts...)
		crds = append(crds, files[i].CRDsOwned...)
		rbac = append(rbac, files[i].RBACRequired...)
		costs = append(costs, files[i].CostModels...)
		versions = append(versions, files[i].Versions...)
	}

	if err := r.repo.SeedCatalog(ctx, entries, deps, conflicts, crds, rbac, costs, versions); err != nil {
		return fmt.Errorf("seed core catalog repository: %w", err)
	}

	// Persist the new hash so subsequent restarts skip the seed.
	if err := r.repo.SetCatalogMeta(ctx, catalogHashKey, currentHash); err != nil {
		// Non-fatal: next restart will re-seed, which is correct behaviour.
		r.logger.Warn("failed to persist catalog hash (will re-seed on next restart)", "error", err)
	}

	r.logger.Info("core addon catalog seeded",
		"entries", len(entries),
		"dependencies", len(deps),
		"conflicts", len(conflicts),
		"crds", len(crds),
		"rbac_rules", len(rbac),
		"cost_models", len(costs),
		"versions", len(versions),
		"hash", currentHash[:12],
	)
	return nil
}

func (r *Registry) GetAddOn(ctx context.Context, id string) (*models.AddOnDetail, error) {
	cacheKey := "addon:" + id
	if v, ok := r.cache.Get(cacheKey); ok {
		if addon, castOK := v.(*models.AddOnDetail); castOK && addon != nil {
			return addon, nil
		}
	}

	addon, err := r.repo.GetAddOn(ctx, id)
	if err != nil {
		// Fallback: resolve core addons from embedded catalog so detail page works
		// even when DB seed was skipped or row is missing (e.g. fresh DB, migration order).
		detail := r.getAddOnFromCoreCatalog(id)
		if detail != nil {
			r.cache.Set(cacheKey, detail, coreCacheTTL)
			return detail, nil
		}
		// Fallback: community addons — fetch from Artifact Hub when not yet in DB.
		if strings.HasPrefix(id, "community/") {
			ahPackageID := strings.TrimPrefix(id, "community/")
			chart, ahErr := r.ahClient.GetPackageByID(ctx, ahPackageID)
			if ahErr == nil && chart != nil {
				entry := r.ahClient.mapToAddOnEntry(*chart)
				detail := &models.AddOnDetail{
					AddOnEntry:    entry,
					Dependencies:  nil,
					Conflicts:     nil,
					CRDsOwned:     nil,
					RBACRequired:  nil,
					CostModels:    nil,
					Versions:      nil,
				}
				r.cache.Set(cacheKey, detail, communityCacheTTL)
				return detail, nil
			}
		}
		return nil, fmt.Errorf("get addon from repository %s: %w", id, err)
	}
	r.cache.Set(cacheKey, addon, coreCacheTTL)
	return addon, nil
}

// getAddOnFromCoreCatalog returns AddOnDetail for id from embedded core JSON, or nil if not found.
func (r *Registry) getAddOnFromCoreCatalog(id string) *models.AddOnDetail {
	files, err := LoadCoreCatalog()
	if err != nil {
		return nil
	}
	for i := range files {
		if files[i].AddOn.ID != id {
			continue
		}
		return &models.AddOnDetail{
			AddOnEntry:    files[i].AddOn,
			Dependencies:  files[i].Dependencies,
			Conflicts:     files[i].Conflicts,
			CRDsOwned:     files[i].CRDsOwned,
			RBACRequired:  files[i].RBACRequired,
			CostModels:    files[i].CostModels,
			Versions:      files[i].Versions,
		}
	}
	return nil
}
func (r *Registry) ListCoreAddOns(ctx context.Context, filter CatalogFilter) ([]models.AddOnEntry, error) {
	entries, err := r.repo.ListAddOns(ctx, string(models.TierCORE), filter.Tags, filter.Search)
	if err != nil {
		return nil, fmt.Errorf("list core addons: %w", err)
	}
	entries = FilterByTags(entries, filter.Tags)
	entries = FilterByK8sVersion(entries, filter.K8sVersion)
	entries = RankAndFilter(entries, filter.Search)
	return entries, nil
}

func (r *Registry) ListPrivateAddOns(ctx context.Context, filter CatalogFilter) ([]models.AddOnEntry, error) {
	entries, err := r.repo.ListAddOns(ctx, string(models.TierPrivate), filter.Tags, filter.Search)
	if err != nil {
		return nil, fmt.Errorf("list private addons: %w", err)
	}
	entries = FilterByTags(entries, filter.Tags)
	entries = FilterByK8sVersion(entries, filter.K8sVersion)
	entries = RankAndFilter(entries, filter.Search)
	return entries, nil
}

func (r *Registry) ListCommunityAddOns(ctx context.Context, filter CatalogFilter) ([]models.AddOnEntry, error) {
	entries, err := r.repo.ListAddOns(ctx, string(models.TierCommunity), filter.Tags, filter.Search)
	if err != nil {
		return nil, fmt.Errorf("list community addons: %w", err)
	}
	entries = FilterByTags(entries, filter.Tags)
	entries = FilterByK8sVersion(entries, filter.K8sVersion)
	entries = RankAndFilter(entries, filter.Search)
	return entries, nil
}

func (r *Registry) SearchCommunity(ctx context.Context, filter CatalogFilter) ([]models.AddOnEntry, error) {
	if strings.EqualFold(filter.Tier, string(models.TierCORE)) {
		return []models.AddOnEntry{}, nil
	}

	limit := filter.PageSize
	if limit <= 0 {
		limit = 20
	}
	offset := 0
	if filter.PageToken != "" {
		_, _ = fmt.Sscanf(filter.PageToken, "%d", &offset)
		if offset < 0 {
			offset = 0
		}
	}

	cacheKey := fmt.Sprintf("community:%s:%d:%d", strings.TrimSpace(filter.Search), limit, offset)
	if v, ok := r.cache.Get(cacheKey); ok {
		if entries, castOK := v.([]models.AddOnEntry); castOK {
			return entries, nil
		}
	}

	resp, err := r.ahClient.Search(ctx, filter.Search, "0", limit, offset)
	if err != nil {
		return nil, fmt.Errorf("search community addons: %w", err)
	}
	result := make([]models.AddOnEntry, 0, len(resp.Packages))
	for i := range resp.Packages {
		entry := r.ahClient.mapToAddOnEntry(resp.Packages[i])
		result = append(result, entry)
	}

	result = FilterByTags(result, filter.Tags)
	result = FilterByK8sVersion(result, filter.K8sVersion)
	result = RankAndFilter(result, filter.Search)
	r.cache.Set(cacheKey, result, communityCacheTTL)
	return result, nil
}

func (r *Registry) ListAll(ctx context.Context, filter CatalogFilter) ([]models.AddOnEntry, error) {
	coreEntries, err := r.ListCoreAddOns(ctx, filter)
	if err != nil {
		return nil, err
	}

	tier := strings.ToUpper(strings.TrimSpace(filter.Tier))
	switch tier {
	case string(models.TierCORE):
		return coreEntries, nil
	case string(models.TierCommunity):
		// Headlamp pattern: always use live Artifact Hub for community tab.
		liveFilter := filter
		if liveFilter.PageSize <= 0 {
			liveFilter.PageSize = 500
		}
		return r.SearchCommunity(ctx, liveFilter)
	case string(models.TierPrivate):
		return r.ListPrivateAddOns(ctx, filter)
	}

	// Headlamp pattern: always use live Artifact Hub for community catalog so users see
	// the full catalog immediately without waiting for DB sync. Request a large page.
	liveFilter := filter
	if liveFilter.PageSize <= 0 {
		liveFilter.PageSize = 500
	}
	communityEntries, err := r.SearchCommunity(ctx, liveFilter)
	if err != nil {
		r.logger.Warn("community addon live search failed", "error", err)
		communityEntries = nil
	}
	merged := make([]models.AddOnEntry, 0, len(coreEntries)+len(communityEntries))
	merged = append(merged, coreEntries...)
	merged = append(merged, communityEntries...)
	return merged, nil
}

// ListCatalogPaginated returns a single page of Helm packages from Artifact Hub with total count.
// No core/tier filtering — all packages from AH. limit/offset are passed through to AH API.
func (r *Registry) ListCatalogPaginated(ctx context.Context, search string, limit, offset int) ([]models.AddOnEntry, int, error) {
	if limit <= 0 {
		limit = 24
	}
	if offset < 0 {
		offset = 0
	}
	resp, err := r.ahClient.Search(ctx, search, "0", limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("artifact hub search: %w", err)
	}
	entries := make([]models.AddOnEntry, 0, len(resp.Packages))
	for i := range resp.Packages {
		entries = append(entries, r.ahClient.mapToAddOnEntry(resp.Packages[i]))
	}
	total := resp.PaginationTotalCount
	if total < len(entries) {
		total = len(entries)
	}
	return entries, total, nil
}

// StartArtifactHubSync runs SyncArtifactHub in a background goroutine so the
// catalog is populated with Artifact Hub packages (tier=COMMUNITY) without blocking startup.
func (r *Registry) StartArtifactHubSync(ctx context.Context) {
	go func() {
		if err := SyncArtifactHub(ctx, r.repo, r.ahClient, r.logger); err != nil {
			r.logger.Warn("artifact hub sync failed", "error", err)
		}
	}()
}
