package registry

import "testing"

func TestLoadCoreCatalog(t *testing.T) {
	files, err := LoadCoreCatalog()
	if err != nil {
		t.Fatalf("load core catalog: %v", err)
	}
	if len(files) != 11 {
		t.Fatalf("expected 11 core catalog files, got %d", len(files))
	}
	for i := range files {
		if err := ValidateCatalogFile(files[i]); err != nil {
			t.Fatalf("invalid catalog file %s: %v", files[i].AddOn.ID, err)
		}
	}
}
