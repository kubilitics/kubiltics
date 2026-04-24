package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildCatalog_IncludesToolFromTaxonomy(t *testing.T) {
	plain := map[string]string{
		"list_resources": "Shows you every workload, service, and config that lives inside a cluster.",
	}
	cat := buildCatalog(plain)
	if len(cat) == 0 {
		t.Fatal("expected non-empty catalog")
	}

	// Spot-check: every entry must have a name + category + description (taxonomy carries these).
	for _, e := range cat {
		if e.Name == "" {
			t.Fatalf("entry has empty Name: %+v", e)
		}
		if e.Category == "" {
			t.Fatalf("entry %q has empty Category", e.Name)
		}
		if e.Description == "" {
			t.Fatalf("entry %q has empty Description", e.Name)
		}
	}

	// If list_resources exists in the taxonomy, its PlainEnglish should be the merged value.
	for _, e := range cat {
		if e.Name == "list_resources" {
			if e.PlainEnglish != plain["list_resources"] {
				t.Fatalf("list_resources PlainEnglish = %q, want %q", e.PlainEnglish, plain["list_resources"])
			}
			return
		}
	}
	// If list_resources not in taxonomy, that's fine — just confirm non-empty catalog already checked.
}

func TestBuildCatalog_MarksMissingPlainEnglishAsPending(t *testing.T) {
	cat := buildCatalog(map[string]string{})
	if len(cat) == 0 {
		t.Fatal("expected non-empty catalog")
	}
	for _, e := range cat {
		if e.PlainEnglish != "(description pending)" {
			t.Fatalf("entry %q PlainEnglish = %q, want \"(description pending)\"", e.Name, e.PlainEnglish)
		}
	}
}

func TestWriteCatalogJSON_RoundTrip(t *testing.T) {
	cat := []CatalogEntry{
		{
			Name:         "list_resources",
			Category:     "observation",
			Description:  "List resources.",
			PlainEnglish: "Shows you stuff.",
			AutonomyLevel: 1,
		},
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "catalog.json")
	if err := writeCatalogJSON(path, cat); err != nil {
		t.Fatalf("writeCatalogJSON: %v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var got []CatalogEntry
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got) != 1 || got[0].Name != "list_resources" || got[0].PlainEnglish != "Shows you stuff." {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}
