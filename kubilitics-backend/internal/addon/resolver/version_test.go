package resolver

import "testing"

func TestVersionSatisfies(t *testing.T) {
	ok, err := VersionSatisfies("v1.2.3", ">=1.2.0, <2.0.0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatalf("expected version to satisfy constraint")
	}
}

func TestFindBestVersion(t *testing.T) {
	best, err := FindBestVersion([]string{"v1.2.0", "1.5.1", "1.3.9"}, ">=1.3.0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if best != "1.5.1" {
		t.Fatalf("unexpected best version: %s", best)
	}
}

func TestCompareVersions(t *testing.T) {
	if CompareVersions("v1.2.0", "1.2.0") != 0 {
		t.Fatalf("expected equal versions")
	}
	if CompareVersions("1.2.1", "1.2.0") <= 0 {
		t.Fatalf("expected first version greater")
	}
}
