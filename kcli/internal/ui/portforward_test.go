package ui

import (
	"testing"
)

// ---------------------------------------------------------------------------
// parsePortSpec
// ---------------------------------------------------------------------------

func TestParsePortSpec_ColonForm(t *testing.T) {
	local, pod, ok := parsePortSpec("8080:8080")
	if !ok {
		t.Fatal("expected ok=true")
	}
	if local != "8080" || pod != "8080" {
		t.Errorf("expected 8080:8080, got %s:%s", local, pod)
	}
}

func TestParsePortSpec_DifferentPorts(t *testing.T) {
	local, pod, ok := parsePortSpec("9090:8080")
	if !ok {
		t.Fatal("expected ok=true")
	}
	if local != "9090" || pod != "8080" {
		t.Errorf("expected 9090:8080, got %s:%s", local, pod)
	}
}

func TestParsePortSpec_SinglePort(t *testing.T) {
	local, pod, ok := parsePortSpec("3000")
	if !ok {
		t.Fatal("expected ok=true for single port")
	}
	if local != "3000" || pod != "3000" {
		t.Errorf("expected 3000:3000, got %s:%s", local, pod)
	}
}

func TestParsePortSpec_EmptyString(t *testing.T) {
	_, _, ok := parsePortSpec("")
	if ok {
		t.Fatal("expected ok=false for empty string")
	}
}

func TestParsePortSpec_NonNumeric(t *testing.T) {
	_, _, ok := parsePortSpec("abc:def")
	if ok {
		t.Fatal("expected ok=false for non-numeric ports")
	}
}

func TestParsePortSpec_TrailingWhitespace(t *testing.T) {
	local, pod, ok := parsePortSpec("  5432:5432  ")
	if !ok {
		t.Fatal("expected ok=true after trimming whitespace")
	}
	if local != "5432" || pod != "5432" {
		t.Errorf("expected 5432:5432, got %s:%s", local, pod)
	}
}

// ---------------------------------------------------------------------------
// isPort
// ---------------------------------------------------------------------------

func TestIsPort_ValidPorts(t *testing.T) {
	for _, p := range []string{"80", "443", "8080", "65535"} {
		if !isPort(p) {
			t.Errorf("expected isPort(%q)=true", p)
		}
	}
}

func TestIsPort_InvalidPorts(t *testing.T) {
	for _, p := range []string{"", "abc", "80a", "-1", "8 080"} {
		if isPort(p) {
			t.Errorf("expected isPort(%q)=false", p)
		}
	}
}

// ---------------------------------------------------------------------------
// buildPortForwardArgs
// ---------------------------------------------------------------------------

func TestBuildPortForwardArgs_Basic(t *testing.T) {
	opts := Options{}
	args := buildPortForwardArgs(opts, "pod/nginx", "default", "8080", "8080")
	contains := func(s string) bool {
		for _, a := range args {
			if a == s {
				return true
			}
		}
		return false
	}
	for _, want := range []string{"port-forward", "pod/nginx", "-n", "default", "8080:8080"} {
		if !contains(want) {
			t.Errorf("expected %q in args %v", want, args)
		}
	}
}

func TestBuildPortForwardArgs_WithContext(t *testing.T) {
	opts := Options{Context: "prod", Kubeconfig: "/kube/config"}
	args := buildPortForwardArgs(opts, "service/api", "api", "9090", "8080")
	contains := func(s string) bool {
		for _, a := range args {
			if a == s {
				return true
			}
		}
		return false
	}
	if !contains("--context") || !contains("prod") {
		t.Errorf("expected --context prod in %v", args)
	}
	if !contains("--kubeconfig") {
		t.Errorf("expected --kubeconfig in %v", args)
	}
	if !contains("9090:8080") {
		t.Errorf("expected port spec 9090:8080 in %v", args)
	}
}

func TestBuildPortForwardArgs_EmptyNamespace(t *testing.T) {
	opts := Options{}
	args := buildPortForwardArgs(opts, "pod/mypod", "-", "8080", "8080")
	for _, a := range args {
		if a == "-n" {
			t.Errorf("expected -n to be omitted when namespace is '-', got %v", args)
		}
	}
}

// ---------------------------------------------------------------------------
// PortForwardManager
// ---------------------------------------------------------------------------

func TestPortForwardManager_Count_StartsZero(t *testing.T) {
	m := NewPortForwardManager()
	if m.Count() != 0 {
		t.Fatalf("expected 0 entries initially, got %d", m.Count())
	}
}

func TestPortForwardManager_List_StartsEmpty(t *testing.T) {
	m := NewPortForwardManager()
	if len(m.List()) != 0 {
		t.Fatal("expected empty list initially")
	}
}

func TestPortForwardManager_StopAll_NoEntries(t *testing.T) {
	m := NewPortForwardManager()
	// Should not panic when there are no entries.
	m.StopAll()
	if m.Count() != 0 {
		t.Fatal("expected 0 after StopAll on empty manager")
	}
}

func TestPortForwardEntry_Display(t *testing.T) {
	e := &PortForwardEntry{
		ID:        "pf-1",
		PodOrSvc:  "pod/nginx",
		Namespace: "default",
		LocalPort: "8080",
		PodPort:   "8080",
	}
	d := e.Display()
	if d == "" {
		t.Fatal("expected non-empty display string")
	}
	// Should contain the key info.
	for _, want := range []string{"8080", "pod/nginx", "default"} {
		found := false
		for i := range d {
			if i+len(want) <= len(d) && d[i:i+len(want)] == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected %q in display %q", want, d)
		}
	}
}

func TestPortForwardEntry_Display_NoNamespace(t *testing.T) {
	e := &PortForwardEntry{
		ID:        "pf-2",
		PodOrSvc:  "pod/app",
		Namespace: "",
		LocalPort: "3000",
		PodPort:   "3000",
	}
	d := e.Display()
	// Should not include namespace bracket when namespace is empty.
	if len(d) == 0 {
		t.Fatal("expected non-empty display")
	}
}
