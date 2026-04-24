package identity

import "testing"

func TestLogicalIdentity_Equal_IgnoresTrailingSlash(t *testing.T) {
	a := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443/"}
	if !a.Equal(b) {
		t.Fatal("trailing slash should not differentiate identities")
	}
}

func TestLogicalIdentity_Equal_CaseInsensitiveHost(t *testing.T) {
	a := LogicalIdentity{Name: "prod", ServerURL: "https://X.example.com:6443"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443"}
	if !a.Equal(b) {
		t.Fatal("host must be compared case-insensitively")
	}
}

func TestLogicalIdentity_Equal_NamePreserveCase(t *testing.T) {
	a := LogicalIdentity{Name: "PROD", ServerURL: "https://x:6443"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x:6443"}
	if a.Equal(b) {
		t.Fatal("context name IS case-sensitive — kubeconfig preserves it")
	}
}

func TestLogicalIdentity_Key_Stable(t *testing.T) {
	a := LogicalIdentity{Name: "prod", ServerURL: "https://X.example.com:6443/"}
	b := LogicalIdentity{Name: "prod", ServerURL: "https://x.example.com:6443"}
	if a.Key() != b.Key() {
		t.Fatalf("keys must match: %q vs %q", a.Key(), b.Key())
	}
}

func TestLogicalIdentity_String(t *testing.T) {
	id := LogicalIdentity{Name: "prod", ServerURL: "https://x:6443"}
	if id.String() != "prod@https://x:6443" {
		t.Fatalf("string repr: %q", id.String())
	}
}
