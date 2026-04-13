package otel

import "testing"

func TestLookupDiagnosis_KnownSignature(t *testing.T) {
	d := LookupDiagnosis("namespace_missing")
	if d == nil {
		t.Fatal("expected to find namespace_missing")
	}
	if d.Title == "" {
		t.Errorf("expected non-empty title")
	}
	if d.Remediation == "" {
		t.Errorf("expected non-empty remediation")
	}
}

func TestLookupDiagnosis_UnknownSignature(t *testing.T) {
	if d := LookupDiagnosis("does-not-exist"); d != nil {
		t.Errorf("expected nil for unknown signature, got %+v", d)
	}
}

func TestAllDiagnoses_HasExpectedCount(t *testing.T) {
	all := AllDiagnoses()
	if len(all) < 14 {
		t.Errorf("expected at least 14 entries in diagnostics database, got %d", len(all))
	}
}

func TestAllDiagnoses_NoEmptyFields(t *testing.T) {
	for i, d := range AllDiagnoses() {
		if d.Signature == "" {
			t.Errorf("entry %d has empty Signature", i)
		}
		if d.Title == "" {
			t.Errorf("entry %d (%s) has empty Title", i, d.Signature)
		}
		if d.Remediation == "" {
			t.Errorf("entry %d (%s) has empty Remediation", i, d.Signature)
		}
	}
}

func TestAllDiagnoses_UniqueSignatures(t *testing.T) {
	seen := make(map[string]bool)
	for _, d := range AllDiagnoses() {
		if seen[d.Signature] {
			t.Errorf("duplicate signature: %s", d.Signature)
		}
		seen[d.Signature] = true
	}
}
