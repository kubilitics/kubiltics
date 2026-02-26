package ai

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestParsePricingJSON_Valid(t *testing.T) {
	data := []byte(`{
		"schema": 1,
		"updated": "2026-01-01",
		"providers": {
			"openai":       [0.00015, 0.00060],
			"anthropic":    [0.003,   0.015  ]
		}
	}`)
	table, asOf, ok := parsePricingJSON(data)
	if !ok {
		t.Fatal("expected parsePricingJSON to succeed")
	}
	if asOf != "2026-01-01" {
		t.Fatalf("expected asOf=2026-01-01, got %q", asOf)
	}
	if r, exists := table["openai"]; !exists || r.InputPer1kUSD != 0.00015 || r.OutputPer1kUSD != 0.00060 {
		t.Fatalf("unexpected openai rates: %+v", r)
	}
	if r, exists := table["anthropic"]; !exists || r.InputPer1kUSD != 0.003 || r.OutputPer1kUSD != 0.015 {
		t.Fatalf("unexpected anthropic rates: %+v", r)
	}
}

func TestParsePricingJSON_InvalidSchema(t *testing.T) {
	// schema != 1 should be rejected
	data := []byte(`{"schema": 2, "updated": "2026-01-01", "providers": {"openai": [0.001, 0.002]}}`)
	_, _, ok := parsePricingJSON(data)
	if ok {
		t.Fatal("expected parsePricingJSON to reject schema!=1")
	}
}

func TestParsePricingJSON_EmptyProviders(t *testing.T) {
	data := []byte(`{"schema": 1, "updated": "2026-01-01", "providers": {}}`)
	_, _, ok := parsePricingJSON(data)
	if ok {
		t.Fatal("expected parsePricingJSON to reject empty providers")
	}
}

func TestParsePricingJSON_Malformed(t *testing.T) {
	_, _, ok := parsePricingJSON([]byte(`not-json`))
	if ok {
		t.Fatal("expected parsePricingJSON to reject malformed JSON")
	}
}

func TestBundledPricingIsComplete(t *testing.T) {
	// Every known provider must have a bundled entry.
	required := []string{ProviderOpenAI, ProviderAnthropic, ProviderAzureOpenAI, ProviderOllama, ProviderCustom}
	for _, p := range required {
		if _, ok := bundledPricing[p]; !ok {
			t.Errorf("bundledPricing is missing provider %q", p)
		}
	}
}

func TestBundledPricingRatesAreNonNegative(t *testing.T) {
	for p, r := range bundledPricing {
		if r.InputPer1kUSD < 0 || r.OutputPer1kUSD < 0 {
			t.Errorf("bundledPricing[%q] has negative rates: in=%.6f out=%.6f", p, r.InputPer1kUSD, r.OutputPer1kUSD)
		}
	}
}

func TestPricingRates_FallbackForUnknownProvider(t *testing.T) {
	in, out := PricingRates("unknown-provider-xyz")
	if in != 0 || out != 0 {
		t.Fatalf("expected zero rates for unknown provider, got in=%.6f out=%.6f", in, out)
	}
}

func TestDiskCacheRoundTrip(t *testing.T) {
	// Write a known table to a temp dir, then read it back.
	dir := t.TempDir()
	path := filepath.Join(dir, "pricing.json")

	table := PricingTable{
		"openai": {InputPer1kUSD: 0.0005, OutputPer1kUSD: 0.0015},
	}
	asOf := "2026-02-22"

	// Save using the feed JSON structure.
	feed := pricingFeedJSON{
		Schema:    1,
		Updated:   asOf,
		Providers: map[string][2]float64{"openai": {0.0005, 0.0015}},
	}
	data, err := json.MarshalIndent(feed, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Parse what was written.
	got, gotAsOf, ok := parsePricingJSON(data)
	if !ok {
		t.Fatal("expected parsePricingJSON to succeed on written file")
	}
	if gotAsOf != asOf {
		t.Fatalf("expected asOf=%q, got %q", asOf, gotAsOf)
	}
	if r, exists := got["openai"]; !exists {
		t.Fatal("openai missing from round-tripped table")
	} else if r.InputPer1kUSD != table["openai"].InputPer1kUSD || r.OutputPer1kUSD != table["openai"].OutputPer1kUSD {
		t.Fatalf("rates mismatch: got %+v want %+v", r, table["openai"])
	}
}

func TestEstimateCostUSD_UsesLivePricing(t *testing.T) {
	// estimateCostUSD must return a non-negative cost for a known provider.
	cost := estimateCostUSD(ProviderOpenAI, 1000, 1000)
	if cost <= 0 {
		t.Fatalf("expected positive cost for openai 1k/1k tokens, got %.6f", cost)
	}
	// Zero cost for free providers.
	if c := estimateCostUSD(ProviderOllama, 1000, 1000); c != 0 {
		t.Fatalf("expected zero cost for ollama, got %.6f", c)
	}
}

func TestEstimateCostUSD_NegativeTokensClamped(t *testing.T) {
	// Negative token counts must not produce negative costs.
	cost := estimateCostUSD(ProviderOpenAI, -100, -100)
	if cost < 0 {
		t.Fatalf("negative tokens should produce zero cost, got %.6f", cost)
	}
}

func TestFormatPricingTable_ContainsAllProviders(t *testing.T) {
	out := FormatPricingTable()
	for _, p := range []string{ProviderOpenAI, ProviderAnthropic, ProviderAzureOpenAI, ProviderOllama, ProviderCustom} {
		if !containsStr(out, p) {
			t.Errorf("FormatPricingTable output is missing provider %q", p)
		}
	}
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && contains(s, sub))
}

func contains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
