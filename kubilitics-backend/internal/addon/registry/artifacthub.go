package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	defaultArtifactHubBaseURL = "https://artifacthub.io/api/v1"
	// chartValuesCacheTTL controls how long fetched values.yaml content is kept
	// in memory before a fresh request to Artifact Hub is required.
	chartValuesCacheTTL = 30 * time.Minute

	// Retry settings for transient errors (429 rate-limit, 5xx server errors).
	maxRetries       = 3
	retryBaseDelay   = 1 * time.Second
	retryMaxDelay    = 10 * time.Second
	retryBackoffMult = 2
)

// chartValuesCacheEntry stores a cached values.yaml response from Artifact Hub.
type chartValuesCacheEntry struct {
	values    string
	fetchedAt time.Time
}

type ArtifactHubClient struct {
	baseURL    string
	httpClient *http.Client

	// In-memory cache for GetChartValues results keyed by "repo/chart/version".
	// Eliminates redundant Artifact Hub round-trips when the install wizard is
	// re-opened or retried within the TTL window.
	valuesCache   map[string]chartValuesCacheEntry
	valuesCacheMu sync.RWMutex
}

type ArtifactHubHTTPError struct {
	StatusCode int
	URL        string
	Body       string
}

func (e *ArtifactHubHTTPError) Error() string {
	return fmt.Sprintf("artifacthub request failed: status=%d url=%s body=%s", e.StatusCode, e.URL, e.Body)
}

// IsRateLimited returns true when ArtifactHub returned HTTP 429.
func (e *ArtifactHubHTTPError) IsRateLimited() bool {
	return e.StatusCode == http.StatusTooManyRequests
}

// isRetryable returns true for transient HTTP errors worth retrying.
func (e *ArtifactHubHTTPError) isRetryable() bool {
	return e.StatusCode == http.StatusTooManyRequests ||
		e.StatusCode == http.StatusBadGateway ||
		e.StatusCode == http.StatusServiceUnavailable ||
		e.StatusCode == http.StatusGatewayTimeout
}

func NewArtifactHubClient() *ArtifactHubClient {
	return &ArtifactHubClient{
		baseURL: defaultArtifactHubBaseURL,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		valuesCache: make(map[string]chartValuesCacheEntry),
	}
}

// doWithRetry executes an HTTP request with exponential backoff on transient
// errors (429 rate-limit, 502/503/504). It respects the Retry-After header
// from 429 responses and honours context cancellation.
func (c *ArtifactHubClient) doWithRetry(ctx context.Context, req *http.Request) (*http.Response, error) {
	delay := retryBaseDelay
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			// Clone the request for retry (body is nil for GETs).
			retryReq, err := http.NewRequestWithContext(ctx, req.Method, req.URL.String(), nil)
			if err != nil {
				return nil, fmt.Errorf("build retry request: %w", err)
			}
			req = retryReq
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			// Network error — worth retrying.
			lastErr = err
			if attempt < maxRetries {
				if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
					return nil, lastErr // context cancelled
				}
				delay = min(delay*time.Duration(retryBackoffMult), retryMaxDelay)
				continue
			}
			return nil, lastErr
		}

		// Success or non-retryable error — return immediately.
		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNotFound {
			return resp, nil
		}

		ahErr := decodeArtifactHubError(resp, req.URL.String())
		httpErr, ok := ahErr.(*ArtifactHubHTTPError)
		if !ok || !httpErr.isRetryable() || attempt >= maxRetries {
			return nil, ahErr
		}
		lastErr = ahErr

		// Honour Retry-After header if present (AH sends it on 429).
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if secs, parseErr := strconv.Atoi(ra); parseErr == nil && secs > 0 && secs <= 30 {
				delay = time.Duration(secs) * time.Second
			}
		}

		if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
			return nil, lastErr // context cancelled
		}
		delay = min(delay*time.Duration(retryBackoffMult), retryMaxDelay)
	}

	return nil, lastErr
}

// sleepWithContext blocks for the given duration or until the context is done.
func sleepWithContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (c *ArtifactHubClient) Search(ctx context.Context, query, kind string, limit, offset int) (*ArtifactHubSearchResponse, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	if kind == "" {
		kind = "0"
	}

	endpoint, err := url.Parse(c.baseURL + "/packages/search")
	if err != nil {
		return nil, fmt.Errorf("parse artifacthub search endpoint: %w", err)
	}
	q := endpoint.Query()
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		q.Set("ts_query_web", trimmed)
	}
	// When query is empty, omit ts_query_web so AH returns all packages (browse-all).
	q.Set("kind", kind)
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	endpoint.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build artifacthub search request: %w", err)
	}
	resp, err := c.doWithRetry(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("artifacthub search request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var out ArtifactHubSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode artifacthub search response: %w", err)
	}
	// Artifact Hub sends total count in header (e.g. Pagination-Total-Count: 16200).
	if h := resp.Header.Get("Pagination-Total-Count"); h != "" {
		if n, err := strconv.Atoi(h); err == nil && n >= 0 {
			out.PaginationTotalCount = n
		}
	}
	return &out, nil
}

// GetPackageByID fetches a single Helm package from Artifact Hub by package ID.
// packageID must be in the form "repoName/chartName" (e.g. "argocd/argocd").
// It uses the AH endpoint GET /packages/helm/{repoName}/{chartName}.
func (c *ArtifactHubClient) GetPackageByID(ctx context.Context, packageID string) (*ArtifactHubChart, error) {
	packageID = strings.TrimSpace(packageID)
	if packageID == "" {
		return nil, fmt.Errorf("packageID is required")
	}
	parts := strings.SplitN(packageID, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, fmt.Errorf("packageID must be repoName/chartName, got %q", packageID)
	}
	return c.GetChart(ctx, parts[0], parts[1])
}

func (c *ArtifactHubClient) GetChart(ctx context.Context, repoName, chartName string) (*ArtifactHubChart, error) {
	repoName = strings.TrimSpace(repoName)
	chartName = strings.TrimSpace(chartName)
	if repoName == "" || chartName == "" {
		return nil, fmt.Errorf("repoName and chartName are required")
	}

	endpoint := fmt.Sprintf("%s/packages/helm/%s/%s", c.baseURL, url.PathEscape(repoName), url.PathEscape(chartName))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build artifacthub chart request: %w", err)
	}
	resp, err := c.doWithRetry(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("artifacthub get chart request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	var out ArtifactHubChart
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode artifacthub chart response: %w", err)
	}
	return &out, nil
}

// GetChartValues returns the raw values.yaml content for a Helm chart from Artifact Hub.
// repoName and chartName must match the AH repository slug and chart name (e.g. "jenkinsci", "jenkins").
// version is optional; pass empty string to use the chart's latest published version.
//
// The Artifact Hub API requires two requests:
//  1. GET /packages/helm/{repo}/{chart}  →  resolves package_id (UUID) + latest version
//  2. GET /packages/{packageId}/{version}/values  →  returns raw values.yaml text
func (c *ArtifactHubClient) GetChartValues(ctx context.Context, repoName, chartName, version string) (string, error) {
	repoName = strings.TrimSpace(repoName)
	chartName = strings.TrimSpace(chartName)
	if repoName == "" || chartName == "" {
		return "", fmt.Errorf("repoName and chartName are required")
	}

	// ── Check in-memory cache first ─────────────────────────────────────────
	cacheKey := repoName + "/" + chartName + "/" + version
	c.valuesCacheMu.RLock()
	if entry, ok := c.valuesCache[cacheKey]; ok && time.Since(entry.fetchedAt) < chartValuesCacheTTL {
		c.valuesCacheMu.RUnlock()
		return entry.values, nil
	}
	c.valuesCacheMu.RUnlock()

	// ── Step 1: resolve package detail (includes data.values if available) ──
	chart, err := c.GetChart(ctx, repoName, chartName)
	if err != nil {
		return "", fmt.Errorf("GetChartValues: resolve package detail: %w", err)
	}

	resolvedVersion := version
	if resolvedVersion == "" {
		resolvedVersion = strings.TrimSpace(chart.Version)
	}
	resolvedCacheKey := repoName + "/" + chartName + "/" + resolvedVersion

	// The package detail endpoint (/packages/helm/{repo}/{chart}) already returns
	// data.values with the raw values.yaml for the latest version. Use it directly
	// to avoid a second HTTP round-trip that can time out or 404.
	if chart.Data.Values != "" {
		c.cacheValues(cacheKey, resolvedCacheKey, chart.Data.Values)
		return chart.Data.Values, nil
	}

	// ── Step 2: fallback to the dedicated values endpoint ────────────────────
	pkgID := strings.TrimSpace(chart.PackageID)
	if pkgID == "" {
		// No package ID and no inline values — chart has no published defaults.
		c.cacheValues(cacheKey, resolvedCacheKey, "")
		return "", nil
	}
	if resolvedVersion == "" {
		// No version available — cannot construct the values URL.
		c.cacheValues(cacheKey, resolvedCacheKey, "")
		return "", nil
	}

	// Check cache again with resolved version (initial key may have been empty version).
	if resolvedCacheKey != cacheKey {
		c.valuesCacheMu.RLock()
		if entry, ok := c.valuesCache[resolvedCacheKey]; ok && time.Since(entry.fetchedAt) < chartValuesCacheTTL {
			c.valuesCacheMu.RUnlock()
			return entry.values, nil
		}
		c.valuesCacheMu.RUnlock()
	}

	endpoint := fmt.Sprintf("%s/packages/%s/%s/values",
		c.baseURL, url.PathEscape(pkgID), url.PathEscape(resolvedVersion))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("build artifacthub values request: %w", err)
	}
	resp, err := c.doWithRetry(ctx, req)
	if err != nil {
		return "", fmt.Errorf("artifacthub values request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		// Chart exists but has no published values.yaml — cache the empty result.
		c.cacheValues(cacheKey, resolvedCacheKey, "")
		return "", nil
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read artifacthub values body: %w", err)
	}

	result := string(raw)
	c.cacheValues(cacheKey, resolvedCacheKey, result)
	return result, nil
}

// cacheValues stores a values.yaml result under one or two cache keys.
func (c *ArtifactHubClient) cacheValues(key1, key2, values string) {
	c.valuesCacheMu.Lock()
	defer c.valuesCacheMu.Unlock()
	entry := chartValuesCacheEntry{values: values, fetchedAt: time.Now()}
	c.valuesCache[key1] = entry
	if key2 != key1 {
		c.valuesCache[key2] = entry
	}
	// Lazy eviction: purge expired entries when cache grows large.
	if len(c.valuesCache) > 200 {
		now := time.Now()
		for k, v := range c.valuesCache {
			if now.Sub(v.fetchedAt) >= chartValuesCacheTTL {
				delete(c.valuesCache, k)
			}
		}
	}
}

func (c *ArtifactHubClient) mapToAddOnEntry(chart ArtifactHubChart) models.AddOnEntry {
	var iconUrl string
	if chart.LogoImageID != "" {
		iconUrl = fmt.Sprintf("https://artifacthub.io/image/%s", chart.LogoImageID)
	}
	// Use repo/chart as ID so GetPackageByID can fetch details (Artifact Hub uses repo/chart in URLs).
	// Always produce a 3-part "community/{repo}/{chart}" ID so that GetAddonDefaultValues can
	// parse it. When Repository.Name is empty, fall back to PackageID as the repo segment.
	repoSlug := chart.Repository.Name
	if repoSlug == "" {
		repoSlug = chart.PackageID
	}
	communityID := "community/" + repoSlug + "/" + chart.Name

	// "Official" is true when either the package itself is official OR when it comes
	// from an officially maintained repository.
	isOfficial := chart.Official || chart.Repository.Official

	return models.AddOnEntry{
		ID:               communityID,
		Name:             chart.Name,
		DisplayName:      chart.DisplayName,
		Description:      chart.Description,
		Tier:             string(models.TierCommunity),
		Version:          chart.Version,
		K8sCompatMin:     "1.19",
		HelmRepoURL:      chart.Repository.URL,
		HelmChart:        chart.Name,
		HelmChartVersion: chart.Version,
		IconURL:          iconUrl,
		IsDeprecated:     chart.Deprecated,
		Stars:            chart.Stars,
		// Trust signals
		IsOfficial:          isOfficial,
		IsVerifiedPublisher: chart.Repository.VerifiedPublisher,
		IsSigned:            chart.Signed,
	}
}

func decodeArtifactHubError(resp *http.Response, requestURL string) error {
	const maxErrBody = 2048
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrBody))
	return &ArtifactHubHTTPError{
		StatusCode: resp.StatusCode,
		URL:        requestURL,
		Body:       strings.TrimSpace(string(body)),
	}
}
