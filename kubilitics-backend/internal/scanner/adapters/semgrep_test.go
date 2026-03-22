package adapters

import (
	"encoding/json"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/scanner"
)

func TestSemgrepMapFindings(t *testing.T) {
	raw := `{
		"results": [
			{
				"check_id": "go.lang.security.audit.xss.no-direct-write-to-responsewriter",
				"path": "internal/api/rest/handler.go",
				"start": {"line": 42, "col": 5},
				"end": {"line": 42, "col": 60},
				"extra": {
					"message": "Directly writing to ResponseWriter can lead to XSS",
					"severity": "WARNING",
					"metadata": {
						"cwe": ["CWE-79"],
						"confidence": "MEDIUM",
						"category": "security"
					}
				}
			},
			{
				"check_id": "go.lang.correctness.useless-eqeq",
				"path": "internal/service/scanner.go",
				"start": {"line": 100, "col": 3},
				"end": {"line": 100, "col": 20},
				"extra": {
					"message": "Comparison of identical expressions",
					"severity": "INFO",
					"metadata": {
						"category": "correctness"
					}
				}
			}
		],
		"errors": []
	}`

	var output semgrepOutput
	if err := json.Unmarshal([]byte(raw), &output); err != nil {
		t.Fatalf("failed to parse semgrep output: %v", err)
	}

	adapter := &SemgrepAdapter{binary: "semgrep"}
	findings := adapter.mapFindings(output)

	if len(findings) != 2 {
		t.Fatalf("expected 2 findings, got %d", len(findings))
	}

	// First finding: security warning
	f1 := findings[0]
	if f1.Severity != scanner.SeverityMedium {
		t.Errorf("expected severity=MEDIUM for WARNING, got %s", f1.Severity)
	}
	if f1.StartLine != 42 {
		t.Errorf("expected start_line=42, got %d", f1.StartLine)
	}
	if len(f1.CWE) != 1 || f1.CWE[0] != "CWE-79" {
		t.Errorf("expected CWE=[CWE-79], got %v", f1.CWE)
	}
	if f1.Confidence != "MEDIUM" {
		t.Errorf("expected confidence=MEDIUM, got %s", f1.Confidence)
	}

	// Second finding: info
	f2 := findings[1]
	if f2.Severity != scanner.SeverityLow {
		t.Errorf("expected severity=LOW for INFO, got %s", f2.Severity)
	}
}

func TestSemgrepSeverityMapping(t *testing.T) {
	cases := []struct {
		input    string
		expected scanner.Severity
	}{
		{"ERROR", scanner.SeverityHigh},
		{"WARNING", scanner.SeverityMedium},
		{"INFO", scanner.SeverityLow},
		{"", scanner.SeverityInfo},
	}

	for _, tc := range cases {
		got := mapSemgrepSeverity(tc.input)
		if got != tc.expected {
			t.Errorf("mapSemgrepSeverity(%q) = %s, want %s", tc.input, got, tc.expected)
		}
	}
}

func TestParseCWE(t *testing.T) {
	// String CWE
	result := parseCWE("CWE-89")
	if len(result) != 1 || result[0] != "CWE-89" {
		t.Errorf("expected [CWE-89], got %v", result)
	}

	// Array CWE
	result = parseCWE([]interface{}{"CWE-79", "CWE-89"})
	if len(result) != 2 {
		t.Errorf("expected 2 CWEs, got %d", len(result))
	}

	// Nil
	result = parseCWE(nil)
	if result != nil {
		t.Errorf("expected nil, got %v", result)
	}
}
