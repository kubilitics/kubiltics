package financial

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OpenCostClient calls the OpenCost allocation API.
type OpenCostClient struct {
	endpoint  string
	httpClient *http.Client
}

// NewOpenCostClient creates a client for the given OpenCost endpoint (e.g. http://opencost.namespace.svc.cluster.local:9003).
func NewOpenCostClient(endpoint string) *OpenCostClient {
	return &OpenCostClient{
		endpoint:   strings.TrimSuffix(endpoint, "/"),
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// allocationResponse is the top-level JSON from OpenCost allocation API.
type allocationResponse struct {
	Code int                   `json:"code"`
	Data []map[string]allocationEntry `json:"data"`
}

type allocationEntry struct {
	CPUCost              float64 `json:"cpuCost"`
	MemoryCost           float64 `json:"memoryCost"`
	StorageCost          float64 `json:"storageCost"`
	TotalCost            float64 `json:"totalCost"`
	CPUCoreRequestAvg    float64 `json:"cpuCoreRequestAverage"`
	CPUCoreUsageAvg      float64 `json:"cpuCoreUsageAverage"`
	RAMByteRequestAvg    float64 `json:"ramByteRequestAverage"`
	RAMByteUsageAvg      float64 `json:"ramByteUsageAverage"`
}

// QueryAllocation calls GET .../allocation/compute?window=&aggregate=&accumulate=true and returns allocations.
// window is e.g. "7d" or "1d"; aggregate is e.g. "namespace" or "label:app.kubernetes.io/instance".
func (c *OpenCostClient) QueryAllocation(ctx context.Context, window, aggregate string) ([]OpenCostAllocation, error) {
	u, err := url.Parse(c.endpoint + "/allocation/compute")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("window", window)
	q.Set("aggregate", aggregate)
	q.Set("accumulate", "true")
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		if strings.Contains(err.Error(), "connection refused") {
			return nil, nil
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("opencost allocation: %s", resp.Status)
	}
	var body allocationResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	var out []OpenCostAllocation
	for _, step := range body.Data {
		for name, entry := range step {
			out = append(out, OpenCostAllocation{
				Name:              name,
				CPUCost:           entry.CPUCost,
				MemoryCost:        entry.MemoryCost,
				StorageCost:       entry.StorageCost,
				TotalCost:         entry.TotalCost,
				CPUCoreRequestAvg: entry.CPUCoreRequestAvg,
				CPUCoreUsageAvg:   entry.CPUCoreUsageAvg,
				RAMByteRequestAvg: entry.RAMByteRequestAvg,
				RAMByteUsageAvg:   entry.RAMByteUsageAvg,
				Window:            window,
			})
		}
	}
	return out, nil
}

// GetReleaseAllocation finds allocation for the given release (by label app.kubernetes.io/instance) and returns attribution.
// Efficiency = (actual cost / requested cost) * 100 if requested > 0; else 0.
// Returns nil, nil if OpenCost is unreachable (e.g. connection refused); caller handles nil.
func (c *OpenCostClient) GetReleaseAllocation(ctx context.Context, releaseName, namespace, window string) (*AddonCostAttribution, error) {
	allocs, err := c.QueryAllocation(ctx, window, "label:app.kubernetes.io/instance")
	if err != nil {
		return nil, err
	}
	if allocs == nil {
		return nil, nil
	}
	for _, a := range allocs {
		if a.Name == releaseName {
			// Compute efficiency as usage / request ratio (0–100 percent).
			// When OpenCost returns average core/byte metrics, use those for precision.
			// Fall back to a binary 100% when we only have cost data.
			efficiency := 0.0
			if a.CPUCoreRequestAvg > 0 && a.CPUCoreUsageAvg >= 0 {
				efficiency = (a.CPUCoreUsageAvg / a.CPUCoreRequestAvg) * 100.0
			} else if a.TotalCost > 0 {
				efficiency = 100.0
			}
			return &AddonCostAttribution{
				AddonInstallID: "",
				ReleaseName:    releaseName,
				Namespace:      namespace,
				MonthlyCostUSD: a.TotalCost,
				Efficiency:     efficiency,
				Window:         window,
				FetchedAt:      time.Now(),
			}, nil
		}
	}
	return nil, nil
}
