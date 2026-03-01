package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// TestNamespaceSwitchOnEnter verifies that pressing Enter on a namespace row
// switches the active namespace and returns to pods view (not detail view).
func TestNamespaceSwitchOnEnter(t *testing.T) {
	m := initialModel(Options{
		Namespace: "default",
		Context:   "test-ctx",
	})
	// Put the model in namespace view with some rows
	nsSpec, ok := resolveResourceSpec(":ns")
	if !ok {
		t.Fatal("could not resolve :ns spec")
	}
	m.spec = nsSpec
	m.rows = []resourceRow{
		{Name: "default", Columns: []string{"default", "Active", "10d"}},
		{Name: "kube-system", Columns: []string{"kube-system", "Active", "10d"}},
		{Name: "production", Columns: []string{"production", "Active", "5d"}},
	}
	m.filtered = m.rows
	m.selected = 1 // cursor on kube-system

	// Simulate pressing Enter
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e', 'n', 't', 'e', 'r'}}
	// Actually we need the proper key type for "enter"
	msg = tea.KeyMsg{Type: tea.KeyEnter}
	newM, _ := m.Update(msg)
	updated := newM.(model)

	// Verify namespace was switched
	if updated.opts.Namespace != "kube-system" {
		t.Errorf("expected namespace to be 'kube-system', got %q", updated.opts.Namespace)
	}

	// Verify we switched to pods view (not detail mode)
	if updated.detailMode {
		t.Error("expected detailMode=false after namespace switch, got true")
	}
	// resolveResourceSpec(":po") returns the spec with Key="pods" (alias "po")
	if updated.spec.Key != "pods" {
		t.Errorf("expected spec key 'pods' after namespace switch, got %q", updated.spec.Key)
	}

	// Verify the detail message mentions the switch
	if !strings.Contains(updated.detail, "kube-system") {
		t.Errorf("expected detail to mention 'kube-system', got %q", updated.detail)
	}
}

// TestNamespaceSwitchViaCommand verifies :ns <name> direct namespace switch.
func TestNamespaceSwitchViaCommand(t *testing.T) {
	m := initialModel(Options{
		Namespace: "default",
		Context:   "test-ctx",
	})
	// Put model in command mode
	m.cmdMode = true
	m.cmdInput.SetValue(":ns production")

	// Simulate pressing Enter in command mode
	msg := tea.KeyMsg{Type: tea.KeyEnter}
	newM, _ := m.Update(msg)
	updated := newM.(model)

	// Verify namespace was switched
	if updated.opts.Namespace != "production" {
		t.Errorf("expected namespace to be 'production', got %q", updated.opts.Namespace)
	}

	// Should NOT be in command mode anymore
	if updated.cmdMode {
		t.Error("expected cmdMode=false after :ns command")
	}

	// Should stay on the same resource spec (not switch to ns view)
	// The initial spec is pods (default)
	if updated.spec.Key == "ns" {
		t.Error("should not switch to namespace view when doing :ns <name>")
	}
}

// TestNamespaceSwitchAll verifies :ns all switches to all-namespaces mode.
func TestNamespaceSwitchAll(t *testing.T) {
	m := initialModel(Options{
		Namespace: "kube-system",
		Context:   "test-ctx",
	})
	m.cmdMode = true
	m.cmdInput.SetValue(":ns all")

	msg := tea.KeyMsg{Type: tea.KeyEnter}
	newM, _ := m.Update(msg)
	updated := newM.(model)

	// Verify namespace was set to empty (all namespaces)
	if updated.opts.Namespace != "" {
		t.Errorf("expected namespace to be empty (all), got %q", updated.opts.Namespace)
	}

	if !strings.Contains(updated.detail, "all namespaces") {
		t.Errorf("expected detail to mention 'all namespaces', got %q", updated.detail)
	}
}

// TestNamespaceDisplayInHeader verifies that headerView reflects the updated namespace.
func TestNamespaceDisplayInHeader(t *testing.T) {
	m := initialModel(Options{
		Namespace: "production",
		Context:   "my-cluster",
	})
	m.width = 120

	header := m.headerView()
	if !strings.Contains(header, "production") {
		t.Errorf("expected header to contain 'production', got %q", header)
	}

	// Switch namespace
	m.opts.Namespace = "staging"
	header = m.headerView()
	if !strings.Contains(header, "staging") {
		t.Errorf("expected header to contain 'staging' after switch, got %q", header)
	}

	// All namespaces
	m.opts.Namespace = ""
	header = m.headerView()
	if !strings.Contains(header, "all-namespaces") {
		t.Errorf("expected header to contain 'all-namespaces' when empty, got %q", header)
	}
}
