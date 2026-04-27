package summary

import (
	"context"
	"testing"

	"github.com/vellankikoti/kubilitics/brain/internal/derived"
)

// TestGenerateSignatureRejectsRawData is a compile-time fence:
// Generate's signature accepts ONLY DerivedSummary. If someone widens
// the signature to accept []byte or a richer type, this assignment
// will fail to compile and the test breaks.
func TestGenerateSignatureRejectsRawData(t *testing.T) {
	var _ func(context.Context, derived.DerivedSummary) (string, error) = Generate
}

func TestGenerateEnforcesOneLine(t *testing.T) {
	got := enforceOneLine("line one\nline two", 80)
	if got != "line one" {
		t.Fatalf("got %q", got)
	}
}

func TestGenerateEnforcesLengthCap(t *testing.T) {
	in := "0123456789012345678901234567890123456789" // 40 chars
	got := enforceOneLine(in+in+in, 80)
	if len(got) > 80 {
		t.Fatalf("got %d chars (>80)", len(got))
	}
}
