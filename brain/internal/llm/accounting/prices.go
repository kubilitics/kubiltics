// Package accounting maps LLM token counts to USD. Prices are kept here
// as package-level constants rather than a config file — they change
// rarely, every change warrants a code review + a new bench baseline,
// and callers can override via NewTallierWithPrice for tests.
//
// Sources cited per-model in comments. Keep entries sorted by provider
// then by model name for quick review.
package accounting

// Price per million input / output tokens, in USD.
type Price struct {
	InputPerM  float64
	OutputPerM float64
}

// priceTable — keep sorted by provider then model for reviewability.
// Source: provider public docs as of Apr 2026.
var priceTable = map[string]Price{
	// OpenAI — https://openai.com/api/pricing
	"gpt-4o":        {InputPerM: 2.50, OutputPerM: 10.00},
	"gpt-4o-mini":   {InputPerM: 0.15, OutputPerM: 0.60},
	"gpt-4-turbo":   {InputPerM: 10.00, OutputPerM: 30.00},
	"gpt-3.5-turbo": {InputPerM: 0.50, OutputPerM: 1.50},
	// Anthropic — https://www.anthropic.com/pricing
	"claude-3-5-sonnet-latest": {InputPerM: 3.00, OutputPerM: 15.00},
	"claude-3-5-haiku-latest":  {InputPerM: 0.80, OutputPerM: 4.00},
	"claude-3-opus-latest":     {InputPerM: 15.00, OutputPerM: 75.00},
	// Ollama models — $0 by definition (self-hosted). Listed for
	// explicit matching rather than falling through.
	"qwen2.5:3b":           {},
	"qwen2.5:7b-instruct":  {},
	"qwen2.5:14b-instruct": {},
	"llama3:8b":            {},
	"llama3:70b":           {},
}

// lookupPrice returns the Price for the given model, or a zero Price
// (free) for unknown models. Unknown-model path is intentional so a new
// provider doesn't break the bench — cost simply reports $0 until the
// model is added to the table.
func lookupPrice(model string) Price {
	if p, ok := priceTable[model]; ok {
		return p
	}
	return Price{}
}
