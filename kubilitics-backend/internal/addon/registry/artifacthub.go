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
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	defaultArtifactHubBaseURL = "https://artifacthub.io/api/v1"
)

type ArtifactHubClient struct {
	baseURL    string
	httpClient *http.Client
}

type ArtifactHubHTTPError struct {
	StatusCode int
	URL        string
	Body       string
}

func (e *ArtifactHubHTTPError) Error() string {
	return fmt.Sprintf("artifacthub request failed: status=%d url=%s body=%s", e.StatusCode, e.URL, e.Body)
}

func NewArtifactHubClient() *ArtifactHubClient {
	return &ArtifactHubClient{
		baseURL: defaultArtifactHubBaseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
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
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("artifacthub search request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, decodeArtifactHubError(resp, endpoint.String())
	}

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
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("artifacthub get chart request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, decodeArtifactHubError(resp, endpoint)
	}

	var out ArtifactHubChart
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode artifacthub chart response: %w", err)
	}
	return &out, nil
}

func (c *ArtifactHubClient) mapToAddOnEntry(chart ArtifactHubChart) models.AddOnEntry {
	var iconUrl string
	if chart.LogoImageID != "" {
		iconUrl = fmt.Sprintf("https://artifacthub.io/image/%s", chart.LogoImageID)
	}
	// Use repo/chart as ID so GetPackageByID can fetch details (Artifact Hub uses repo/chart in URLs).
	communityID := "community/" + chart.Repository.Name + "/" + chart.Name
	if chart.Repository.Name == "" {
		communityID = "community/" + chart.PackageID
	}

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
