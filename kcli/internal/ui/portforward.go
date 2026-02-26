package ui

// ---------------------------------------------------------------------------
// P4-2: In-TUI Port-Forward Management
//
// PortForwardManager manages a set of long-running kubectl port-forward
// subprocesses as background goroutines within the kcli process.
//
// Usage flow:
//   1. User presses `f` on a pod or service in the TUI list.
//   2. A mini input dialog appears: enter "LOCAL:POD" (e.g. "8080:8080").
//   3. PortForwardManager.Start() launches kubectl port-forward in background.
//   4. Status bar shows "[pf:N]" for N active port-forwards.
//   5. `F` key shows the list of active port-forwards in the detail pane.
//   6. On TUI quit, PortForwardManager.StopAll() cleans up all subprocesses.
//
// Thread safety: all public methods are safe for concurrent use.
// ---------------------------------------------------------------------------

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// PortForwardEntry describes one active port-forward subprocess.
type PortForwardEntry struct {
	ID        string // unique ID (e.g. "pf-1")
	PodOrSvc  string // resource name (e.g. "pod/nginx-abc" or "service/api")
	Namespace string // namespace (empty = cluster default)
	LocalPort string // local port (e.g. "8080")
	PodPort   string // container/service port (e.g. "8080")
	cancel    context.CancelFunc
}

// Display returns a single-line human-readable description.
// Format: "localhost:8080 → pod/nginx-abc:8080 [ns/default]"
func (e *PortForwardEntry) Display() string {
	loc := "localhost:" + e.LocalPort + " → " + e.PodOrSvc + ":" + e.PodPort
	if e.Namespace != "" && e.Namespace != "-" {
		loc += " [ns/" + e.Namespace + "]"
	}
	return loc
}

// PortForwardManager holds and manages multiple kubectl port-forward subprocesses.
// It is safe to use concurrently.
type PortForwardManager struct {
	mu      sync.Mutex
	entries []*PortForwardEntry
	nextID  int
}

// NewPortForwardManager returns an empty manager.
func NewPortForwardManager() *PortForwardManager {
	return &PortForwardManager{}
}

// Start launches a `kubectl port-forward` subprocess for the given resource.
// podOrSvc should be the kubectl resource string (e.g. "pod/nginx", "service/api").
// localPort and podPort are the port numbers as strings.
// The subprocess runs until Stop(id) or StopAll() is called.
// Returns the entry ID and any immediate startup error.
func (m *PortForwardManager) Start(opts Options, podOrSvc, namespace, localPort, podPort string) (string, error) {
	ctx, cancel := context.WithCancel(context.Background())

	args := buildPortForwardArgs(opts, podOrSvc, namespace, localPort, podPort)
	cmd := exec.CommandContext(ctx, kubectlBinary(), args...)

	if err := cmd.Start(); err != nil {
		cancel()
		return "", fmt.Errorf("port-forward %s %s:%s: %w", podOrSvc, localPort, podPort, err)
	}

	m.mu.Lock()
	m.nextID++
	id := fmt.Sprintf("pf-%d", m.nextID)
	entry := &PortForwardEntry{
		ID:        id,
		PodOrSvc:  podOrSvc,
		Namespace: namespace,
		LocalPort: localPort,
		PodPort:   podPort,
		cancel:    cancel,
	}
	m.entries = append(m.entries, entry)
	m.mu.Unlock()

	// Wait for the subprocess in a goroutine; remove from list when it exits.
	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		m.removeByID(id)
		m.mu.Unlock()
	}()

	return id, nil
}

// Stop cancels the port-forward with the given ID.
func (m *PortForwardManager) Stop(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.entries {
		if e.ID == id {
			e.cancel()
			return
		}
	}
}

// StopAll cancels every active port-forward.  Call this on TUI quit.
func (m *PortForwardManager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, e := range m.entries {
		e.cancel()
	}
	m.entries = nil
}

// List returns a snapshot of the currently active port-forwards.
func (m *PortForwardManager) List() []PortForwardEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]PortForwardEntry, len(m.entries))
	for i, e := range m.entries {
		out[i] = *e // copy value, not pointer, to avoid races
	}
	return out
}

// Count returns the number of active port-forwards.
func (m *PortForwardManager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.entries)
}

// removeByID removes the entry with the given ID (must hold m.mu).
func (m *PortForwardManager) removeByID(id string) {
	out := m.entries[:0]
	for _, e := range m.entries {
		if e.ID != id {
			out = append(out, e)
		}
	}
	m.entries = out
}

// ---------------------------------------------------------------------------
// buildPortForwardArgs constructs the kubectl port-forward argument list.
// ---------------------------------------------------------------------------

func buildPortForwardArgs(opts Options, podOrSvc, namespace, localPort, podPort string) []string {
	args := make([]string, 0, 10)
	if opts.Kubeconfig != "" {
		args = append(args, "--kubeconfig", opts.Kubeconfig)
	}
	if opts.Context != "" {
		args = append(args, "--context", opts.Context)
	}
	args = append(args, "port-forward", podOrSvc)
	if namespace != "" && namespace != "-" {
		args = append(args, "-n", namespace)
	}
	args = append(args, localPort+":"+podPort)
	return args
}

// ---------------------------------------------------------------------------
// parsePortSpec parses "LOCAL:POD" or "PORT" (both same) into two parts.
// ---------------------------------------------------------------------------

// parsePortSpec splits a port specification string into (localPort, podPort).
// Accepts:
//   - "8080:8080"  → ("8080", "8080")
//   - "9090:8080"  → ("9090", "8080")
//   - "8080"       → ("8080", "8080")  both ports equal
func parsePortSpec(spec string) (localPort, podPort string, ok bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return "", "", false
	}
	parts := strings.SplitN(spec, ":", 2)
	switch len(parts) {
	case 1:
		if !isPort(parts[0]) {
			return "", "", false
		}
		return parts[0], parts[0], true
	case 2:
		if !isPort(parts[0]) || !isPort(parts[1]) {
			return "", "", false
		}
		return parts[0], parts[1], true
	}
	return "", "", false
}

// isPort reports whether s is a non-empty numeric string (basic port validation).
func isPort(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
