package accounting

import (
	"math"
	"testing"
)

func TestTallier_USD_GPT4o(t *testing.T) {
	// gpt-4o (Apr 2026): $2.50 / 1M input, $10.00 / 1M output.
	// 10,000 input + 2,000 output = $0.025 + $0.020 = $0.045.
	tr := NewTallier("gpt-4o")
	tr.AddInput(10_000)
	tr.AddOutput(2_000)
	want := 0.045
	if got := tr.USD(); math.Abs(got-want) > 1e-6 {
		t.Fatalf("USD = %.6f, want %.6f", got, want)
	}
}

func TestTallier_USD_Ollama_IsZero(t *testing.T) {
	tr := NewTallier("qwen2.5:7b-instruct")
	tr.AddInput(100_000)
	tr.AddOutput(50_000)
	if got := tr.USD(); got != 0 {
		t.Fatalf("ollama model should be $0, got %.6f", got)
	}
}

func TestTallier_USD_UnknownModel_IsZero(t *testing.T) {
	tr := NewTallier("some-future-model-we-havent-priced")
	tr.AddInput(1_000_000)
	if got := tr.USD(); got != 0 {
		t.Fatalf("unknown model must default to 0 so bench doesn't break on new models, got %.6f", got)
	}
}

func TestTallier_TokenTotals(t *testing.T) {
	tr := NewTallier("gpt-4o")
	tr.AddInput(5)
	tr.AddInput(7)
	tr.AddOutput(3)
	if tr.InputTokens() != 12 || tr.OutputTokens() != 3 {
		t.Fatalf("want (12,3), got (%d,%d)", tr.InputTokens(), tr.OutputTokens())
	}
}
