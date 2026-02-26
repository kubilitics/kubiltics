package ai

// ---------------------------------------------------------------------------
// Live AI Pricing Feed — P1-4
// ---------------------------------------------------------------------------
//
// kcli fetches its per-token pricing table from a versioned JSON file hosted
// in the kcli GitHub repository:
//
//   https://raw.githubusercontent.com/kubilitics/kcli/main/pricing.json
//
// The file is cached on disk at ~/.kcli/pricing.json and refreshed at most
// once every 24 hours.  If the fetch fails (network error, air-gapped env,
// 404) the bundled fallback table is used so budget accounting always works.
//
// The fetch is triggered lazily (on first call to CurrentPricing) in a
// background goroutine so it never delays startup.
//
// Pricing JSON schema (arrays are [inputPer1kTokensUSD, outputPer1kTokensUSD]):
//
//   {
//     "schema": 1,
//     "updated": "2026-01-15",
//     "providers": {
//       "openai":       [0.00015, 0.00060],
//       "anthropic":    [0.00300, 0.01500],
//       "azure-openai": [0.00020, 0.00080],
//       "ollama":       [0.0,     0.0    ],
//       "custom":       [0.0,     0.0    ]
//     }
//   }

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	pricingFeedURL  = "https://raw.githubusercontent.com/kubilitics/kcli/main/pricing.json"
	pricingCacheTTL = 24 * time.Hour
	pricingCacheFile = "pricing.json"
	pricingFetchTimeout = 8 * time.Second
)

// ProviderRates holds per-1000-token cost rates for a single provider.
type ProviderRates struct {
	InputPer1kUSD  float64 `json:"input_per_1k_usd"`
	OutputPer1kUSD float64 `json:"output_per_1k_usd"`
}

// PricingTable maps provider name → cost rates.
type PricingTable map[string]ProviderRates

// pricingFeedJSON is the on-disk / wire format.
type pricingFeedJSON struct {
	Schema    int                       `json:"schema"`
	Updated   string                    `json:"updated"`
	Providers map[string][2]float64     `json:"providers"`
}

// bundledPricing is the fallback table compiled into the binary.
// Update this whenever known pricing changes.
var bundledPricing = PricingTable{
	ProviderOpenAI:      {InputPer1kUSD: 0.00015, OutputPer1kUSD: 0.00060},
	ProviderAnthropic:   {InputPer1kUSD: 0.00300, OutputPer1kUSD: 0.01500},
	ProviderAzureOpenAI: {InputPer1kUSD: 0.00020, OutputPer1kUSD: 0.00080},
	ProviderOllama:      {InputPer1kUSD: 0.0, OutputPer1kUSD: 0.0},
	ProviderCustom:      {InputPer1kUSD: 0.0, OutputPer1kUSD: 0.0},
}

var (
	pricingOnce   sync.Once
	pricingMu     sync.RWMutex
	activePricing = clone(bundledPricing) // starts with bundled; updated async
	pricingSource = "bundled"              // "bundled", "cache", or "live"
	pricingAsOf   string                  // human-readable date from the feed
)

// CurrentPricing returns the active pricing table and triggers a background
// refresh if the cached data is stale.  It always returns immediately.
func CurrentPricing() (PricingTable, string, string) {
	pricingOnce.Do(func() { go refreshPricing() })
	pricingMu.RLock()
	defer pricingMu.RUnlock()
	return clone(activePricing), pricingSource, pricingAsOf
}

// PricingRates returns the input/output rates for a given provider.
// Falls back to zero-cost if the provider is unknown (safe for budget logic).
func PricingRates(provider string) (inputPer1kUSD, outputPer1kUSD float64) {
	table, _, _ := CurrentPricing()
	if r, ok := table[provider]; ok {
		return r.InputPer1kUSD, r.OutputPer1kUSD
	}
	return 0, 0
}

// refreshPricing loads pricing from disk cache (if fresh) or fetches from the
// live feed URL.  It updates activePricing atomically on success.
func refreshPricing() {
	if table, asOf, ok := loadFromDiskCache(); ok {
		setPricing(table, "cache", asOf)
		return
	}
	if table, asOf, ok := fetchFromURL(); ok {
		setPricing(table, "live", asOf)
		_ = saveToDiskCache(table, asOf)
	}
	// If both fail, activePricing retains the bundled fallback — no action needed.
}

// setPricing atomically replaces the active pricing table.
func setPricing(table PricingTable, source, asOf string) {
	pricingMu.Lock()
	defer pricingMu.Unlock()
	activePricing = table
	pricingSource = source
	pricingAsOf = asOf
}

// loadFromDiskCache reads ~/.kcli/pricing.json if it is less than 24 hours old.
func loadFromDiskCache() (PricingTable, string, bool) {
	path, err := cacheFilePath()
	if err != nil {
		return nil, "", false
	}
	info, err := os.Stat(path)
	if err != nil || time.Since(info.ModTime()) > pricingCacheTTL {
		return nil, "", false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", false
	}
	return parsePricingJSON(data)
}

// saveToDiskCache writes the pricing table to ~/.kcli/pricing.json.
func saveToDiskCache(table PricingTable, asOf string) error {
	path, err := cacheFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	feed := pricingFeedJSON{
		Schema:    1,
		Updated:   asOf,
		Providers: make(map[string][2]float64, len(table)),
	}
	for k, v := range table {
		feed.Providers[k] = [2]float64{v.InputPer1kUSD, v.OutputPer1kUSD}
	}
	data, err := json.MarshalIndent(feed, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// fetchFromURL downloads the pricing feed from GitHub.
func fetchFromURL() (PricingTable, string, bool) {
	client := &http.Client{Timeout: pricingFetchTimeout}
	resp, err := client.Get(pricingFeedURL)
	if err != nil {
		return nil, "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", false
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024)) // 64 KB max
	if err != nil {
		return nil, "", false
	}
	return parsePricingJSON(data)
}

// parsePricingJSON decodes the pricing feed JSON into a PricingTable.
func parsePricingJSON(data []byte) (PricingTable, string, bool) {
	var feed pricingFeedJSON
	if err := json.Unmarshal(data, &feed); err != nil {
		return nil, "", false
	}
	if feed.Schema != 1 || len(feed.Providers) == 0 {
		return nil, "", false
	}
	table := make(PricingTable, len(feed.Providers))
	for k, v := range feed.Providers {
		table[k] = ProviderRates{InputPer1kUSD: v[0], OutputPer1kUSD: v[1]}
	}
	return table, feed.Updated, true
}

// cacheFilePath returns the path to the pricing cache file.
func cacheFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".kcli", pricingCacheFile), nil
}

// clone makes a shallow copy of a PricingTable so callers can't mutate the
// shared map.
func clone(t PricingTable) PricingTable {
	out := make(PricingTable, len(t))
	for k, v := range t {
		out[k] = v
	}
	return out
}

// FormatPricingTable returns a human-readable table of the current pricing,
// suitable for display in `kcli ai pricing`.
func FormatPricingTable() string {
	table, source, asOf := CurrentPricing()
	// Wait briefly for the async refresh to complete on first call.
	time.Sleep(50 * time.Millisecond)
	table, source, asOf = CurrentPricing()

	sourceLabel := fmt.Sprintf("(source: %s", source)
	if asOf != "" {
		sourceLabel += ", updated: " + asOf
	}
	sourceLabel += ")"

	out := "AI Provider Pricing " + sourceLabel + "\n"
	out += fmt.Sprintf("%-20s  %14s  %15s\n", "Provider", "Input/1k tokens", "Output/1k tokens")
	out += fmt.Sprintf("%-20s  %14s  %15s\n", "--------", "---------------", "----------------")
	providers := []string{ProviderOpenAI, ProviderAnthropic, ProviderAzureOpenAI, ProviderOllama, ProviderCustom}
	for _, p := range providers {
		r := table[p]
		in := fmt.Sprintf("$%.5f", r.InputPer1kUSD)
		out2 := fmt.Sprintf("$%.5f", r.OutputPer1kUSD)
		if r.InputPer1kUSD == 0 {
			in = "free"
		}
		if r.OutputPer1kUSD == 0 {
			out2 = "free"
		}
		out += fmt.Sprintf("%-20s  %14s  %15s\n", p, in, out2)
	}
	return out
}
