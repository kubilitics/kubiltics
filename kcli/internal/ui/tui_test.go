package ui

import (
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) {
	// P1-4: Goroutine leak detection. Ignore known goroutines from TestRunProgramForTest
	// which runs a full bubbletea Program that spawns kubectl and tick goroutines.
	// These are from third-party libs (bubbletea, exec) and are cleaned up when the Program exits,
	// but may linger briefly. IgnoreAnyFunction matches if the function appears anywhere in the stack.
	goleak.VerifyTestMain(m,
		goleak.IgnoreAnyFunction("github.com/charmbracelet/bubbletea.(*Program).execBatchMsg"),
		goleak.IgnoreAnyFunction("github.com/charmbracelet/bubbletea.Tick.func1"),
		goleak.IgnoreAnyFunction("os/exec.(*Cmd).Start"),
		goleak.IgnoreAnyFunction("os/exec.(*Cmd).Run"),
		goleak.IgnoreAnyFunction("os/exec.(*Cmd).writerDescriptor.func1"),
	)
}

func TestResolveResourceSpec(t *testing.T) {
	cases := []string{":pods", "po", ":deploy", "service", ":nodes", ":events", ":ns", ":ing", ":cm", ":secrets", ":pvc", ":jobs", ":cronjobs"}
	for _, in := range cases {
		if _, ok := resolveResourceSpec(in); !ok {
			t.Fatalf("expected resolveResourceSpec(%q) to succeed", in)
		}
	}
	if _, ok := resolveResourceSpec(":unknown"); ok {
		t.Fatal("expected unknown shortcut to fail")
	}
}

func TestSpecForKind(t *testing.T) {
	cases := []string{"Deployment", "Pod", "Service", "Ingress", "ReplicaSet", "Endpoints"}
	for _, in := range cases {
		if _, ok := specForKind(in); !ok {
			t.Fatalf("expected specForKind(%q) to succeed", in)
		}
	}
}

func TestCommandModeSwitchResource(t *testing.T) {
	m := initialModel(Options{})
	if m.spec.Key != "pods" {
		t.Fatalf("expected default pods, got %s", m.spec.Key)
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{':'}})
	m2 := updated.(model)
	if !m2.cmdMode {
		t.Fatal("expected command mode enabled")
	}

	for _, r := range []rune("deploy") {
		updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m2 = updated.(model)
	}
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m2 = updated.(model)
	if m2.spec.Key != "deploy" {
		t.Fatalf("expected switched resource deploy, got %s", m2.spec.Key)
	}
}

func TestFilteringAndSortingRows(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
		{Namespace: "default", Name: "worker-0", Columns: []string{"default", "worker-0", "1/1", "Running", "2", "2m", "n2"}},
		{Namespace: "ops", Name: "job-0", Columns: []string{"ops", "job-0", "0/1", "Pending", "0", "1m", "n3"}},
	}
	m.refreshFiltered()

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	m2 := updated.(model)
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'o'}})
	m2 = updated.(model)
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	m2 = updated.(model)
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m2 = updated.(model)
	if len(m2.filtered) != 1 || m2.filtered[0].Namespace != "ops" {
		t.Fatalf("unexpected filtered rows: %+v", m2.filtered)
	}

	m2.filterInput.SetValue("")
	m2.refreshFiltered()
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'5'}}) // restarts column index
	m2 = updated.(model)
	if m2.filtered[len(m2.filtered)-1].Name != "worker-0" {
		t.Fatalf("expected worker-0 last after asc sort, got %+v", m2.filtered)
	}
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'S'}})
	m2 = updated.(model)
	if m2.filtered[0].Name != "worker-0" {
		t.Fatalf("expected worker-0 first after desc sort, got %+v", m2.filtered)
	}
}

func TestRegexAndFieldFiltering(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
		{Namespace: "default", Name: "worker-0", Columns: []string{"default", "worker-0", "1/1", "CrashLoopBackOff", "2", "2m", "n2"}},
	}
	m.filterInput.SetValue("status:Running")
	m.refreshFiltered()
	if len(m.filtered) != 1 || m.filtered[0].Name != "api-0" {
		t.Fatalf("field filter failed: %+v", m.filtered)
	}

	m.filterInput.SetValue("re:^default\\s+worker")
	m.refreshFiltered()
	if len(m.filtered) != 1 || m.filtered[0].Name != "worker-0" {
		t.Fatalf("regex filter failed: %+v", m.filtered)
	}
}

func TestMultiSelectAndBulkParsing(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":deploy")
	m.filtered = []resourceRow{
		{Namespace: "default", Name: "api", Columns: []string{"default", "api", "1/1", "1", "1", "2m"}},
		{Namespace: "default", Name: "worker", Columns: []string{"default", "worker", "1/1", "1", "1", "2m"}},
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{' '}})
	m2 := updated.(model)
	if len(m2.selectedRows) != 1 {
		t.Fatalf("expected one selected row, got %d", len(m2.selectedRows))
	}

	m2.selected = 1
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{' '}})
	m2 = updated.(model)
	if len(m2.selectedRows) != 2 {
		t.Fatalf("expected two selected rows, got %d", len(m2.selectedRows))
	}

	req, err := m2.parseBulkRequest("scale=3")
	if err != nil {
		t.Fatalf("parseBulkRequest scale error: %v", err)
	}
	if req.Action != "scale" || req.Replicas != 3 || len(req.Targets) != 2 {
		t.Fatalf("unexpected bulk req: %+v", req)
	}
}

func TestThemeToggle(t *testing.T) {
	m := initialModel(Options{})
	initial := m.themeIndex
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlT})
	m2 := updated.(model)
	if m2.themeIndex == initial {
		t.Fatal("expected theme index to change on ctrl+t")
	}
}

func TestInitialThemeFromOptions(t *testing.T) {
	m := initialModel(Options{Theme: "forest", Animations: true})
	if m.themeIndex != 1 {
		t.Fatalf("expected forest theme index 1, got %d", m.themeIndex)
	}
}

func TestAIToggle(t *testing.T) {
	m := initialModel(Options{AIEnabled: true})
	if !m.aiEnabled {
		t.Fatal("expected AI enabled initially")
	}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlA})
	m2 := updated.(model)
	if m2.aiEnabled {
		t.Fatal("expected AI disabled after ctrl+a")
	}
}

func TestSaveSnapshot(t *testing.T) {
	m := initialModel(Options{Context: "docker-desktop"})
	m.filtered = []resourceRow{
		{Namespace: "default", Name: "api", Columns: []string{"default", "api", "1/1", "Running", "0", "1m", "n1"}},
	}
	p, err := m.saveSnapshot()
	if err != nil {
		t.Fatalf("saveSnapshot error: %v", err)
	}
	if !strings.Contains(p, "kcli-ui-pods-") {
		t.Fatalf("unexpected snapshot path: %s", p)
	}
}

func TestBulkConfirmRequiresYes(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":deploy")
	m.filtered = []resourceRow{{Namespace: "default", Name: "api", Columns: []string{"default", "api", "1/1", "1", "1", "2m"}}}
	m.selectedRows[m.rowKey(m.filtered[0])] = true
	m.pendingBulk = bulkRequest{Action: "delete", Targets: m.filtered}
	m.confirmMode = true
	m.confirmInput.SetValue("no")

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m2 := updated.(model)
	if m2.confirmMode {
		t.Fatal("expected confirm mode to close")
	}
	if !strings.Contains(strings.ToLower(m2.detail), "cancelled") {
		t.Fatalf("expected cancellation detail message, got %q", m2.detail)
	}
}

func TestParseFunctions(t *testing.T) {
	if row, ok := parsePodsLine("default api-0 1/1 Running 3 12m 10.1.0.1 node-1 <none> <none>", ""); !ok || row.Name != "api-0" {
		t.Fatalf("parsePodsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseDeploymentsLine("default api 1/1 1 1 2m", ""); !ok || row.Name != "api" {
		t.Fatalf("parseDeploymentsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseServicesLine("default svc ClusterIP 10.0.0.1 <none> 80/TCP 2m", ""); !ok || row.Name != "svc" {
		t.Fatalf("parseServicesLine failed: %+v %v", row, ok)
	}
	// P0-5: StatefulSets, DaemonSets, ServiceAccounts
	if row, ok := parseStatefulSetsLine("default web 2/2 6d22h", ""); !ok || row.Name != "web" {
		t.Fatalf("parseStatefulSetsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseStatefulSetsLine("web 2/2 6d22h", "default"); !ok || row.Name != "web" {
		t.Fatalf("parseStatefulSetsLine namespaced failed: %+v %v", row, ok)
	}
	if row, ok := parseDaemonSetsLine("kube-system kindnet 3 3 3 3 3 kubernetes.io/os=linux 143d", ""); !ok || row.Name != "kindnet" {
		t.Fatalf("parseDaemonSetsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseServiceAccountsLine("default default 0 143d", ""); !ok || row.Name != "default" {
		t.Fatalf("parseServiceAccountsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseRolesLine("default pod-reader 91d", ""); !ok || row.Name != "pod-reader" {
		t.Fatalf("parseRolesLine failed: %+v %v", row, ok)
	}
	if row, ok := parseRoleBindingsLine("default pod-monitor-binding Role/pod-reader 91d", ""); !ok || row.Name != "pod-monitor-binding" {
		t.Fatalf("parseRoleBindingsLine failed: %+v %v", row, ok)
	}
}

func TestFlattenXray(t *testing.T) {
	root := &xrayNode{
		Kind:      "Deployment",
		Namespace: "default",
		Name:      "api",
		Children: []*xrayNode{
			{Kind: "ReplicaSet", Namespace: "default", Name: "api-rs", Children: []*xrayNode{{Kind: "Pod", Namespace: "default", Name: "api-0"}}},
			{Kind: "Service", Namespace: "default", Name: "api-svc"},
		},
	}
	out := flattenXray(root)
	if len(out) < 3 {
		t.Fatalf("expected flattened xray nodes, got %d", len(out))
	}
	if !strings.Contains(out[0].Line, "Deployment") || !strings.Contains(out[1].Line, "ReplicaSet") {
		t.Fatalf("unexpected flattened lines: %+v", out)
	}
}

func TestViewRendersFrameworkComponents(t *testing.T) {
	m := initialModel(Options{Context: "docker-desktop", Namespace: "default", AIEnabled: true})
	m.width = 120
	m.height = 36
	m.filtered = []resourceRow{{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "2m", "n1"}}}
	m.detail = "resource details"

	view := m.View()
	checks := []string{
		"kcli ui | context: docker-desktop | namespace: default | resource: pods | ai: on",
		"NAMESPACE",
		"Details",
		"q quit",
	}
	for _, want := range checks {
		if !strings.Contains(view, want) {
			t.Fatalf("view missing %q", want)
		}
	}
}

func TestDetailAITabLoads(t *testing.T) {
	m := initialModel(Options{
		AIEnabled: true,
		AIFunc: func(target string) (string, error) {
			return "analysis for " + target, nil
		},
	})
	m.spec, _ = resolveResourceSpec(":pods")
	row := resourceRow{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "2m", "n1"}}
	m.enterDetailMode(row)
	updated, cmd := m.switchDetailTab(tabAI)
	m2 := updated.(model)
	if !m2.detailLoading {
		t.Fatal("expected AI tab load to set detailLoading")
	}
	if cmd == nil {
		t.Fatal("expected AI tab load command")
	}
}

func TestRunProgramForTestQuitsCleanly(t *testing.T) {
	done := make(chan error, 1)
	go func() {
		done <- runProgramForTest(Options{}, strings.NewReader("q"), io.Discard)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runProgramForTest returned error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("tui did not exit within timeout")
	}
}

// ---------------------------------------------------------------------------
// Virtual scrolling tests (P1-2)
// ---------------------------------------------------------------------------

// makeRows builds n synthetic pod rows for use in virtual scrolling tests.
func makeRows(n int) []resourceRow {
	rows := make([]resourceRow, n)
	for i := range rows {
		name := fmt.Sprintf("pod-%04d", i)
		rows[i] = resourceRow{
			Namespace: "default",
			Name:      name,
			Columns:   []string{"default", name, "1/1", "Running", "0", "1m", "node-1"},
		}
	}
	return rows
}

func TestClampViewport_BasicScroll(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30 // pageSize() = max(8, 30-13) = 17
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(100)
	m.refreshFiltered() // also calls clampViewport

	ps := m.pageSize()
	if ps != 17 {
		t.Fatalf("expected pageSize=17, got %d", ps)
	}

	// Move cursor down past the bottom of the first viewport.
	for i := 0; i < ps+5; i++ {
		m.selected++
		m.clampViewport()
	}
	// viewportTop should have shifted so selected stays in view.
	if m.selected < m.viewportTop || m.selected >= m.viewportTop+ps {
		t.Fatalf("selected %d out of viewport [%d, %d)", m.selected, m.viewportTop, m.viewportTop+ps)
	}
	// Cursor must have advanced by ps+5.
	if m.selected != ps+5 {
		t.Fatalf("expected selected=%d, got %d", ps+5, m.selected)
	}
}

func TestClampViewport_ScrollUp(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(50)
	m.refreshFiltered()

	// Jump to bottom.
	m.selected = 49
	m.clampViewport()

	// Now scroll back to top one step at a time.
	for m.selected > 0 {
		m.selected--
		m.clampViewport()
		ps := m.pageSize()
		if m.selected < m.viewportTop || m.selected >= m.viewportTop+ps {
			t.Fatalf("selected %d out of viewport [%d, %d) during upward scroll",
				m.selected, m.viewportTop, m.viewportTop+ps)
		}
	}
	if m.viewportTop != 0 {
		t.Fatalf("expected viewportTop=0 at top, got %d", m.viewportTop)
	}
}

func TestClampViewport_EmptyList(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = nil
	m.refreshFiltered()
	// Must not panic; viewportTop must be zero.
	m.clampViewport()
	if m.viewportTop != 0 {
		t.Fatalf("expected viewportTop=0 for empty list, got %d", m.viewportTop)
	}
}

func TestClampViewport_SmallList(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30 // pageSize = 17
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(5)
	m.refreshFiltered()

	// All items fit on screen; viewportTop must stay 0 regardless of cursor.
	for i := 0; i < 5; i++ {
		m.selected = i
		m.clampViewport()
		if m.viewportTop != 0 {
			t.Fatalf("expected viewportTop=0 for small list (selected=%d), got %d", i, m.viewportTop)
		}
	}
}

func TestVirtualScrolling_KeyNavigation(t *testing.T) {
	// Simulate pressing 'j' 30 times on a 100-item list with pageSize=17.
	m := initialModel(Options{})
	m.width = 120
	m.height = 30
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(100)
	m.refreshFiltered()

	for i := 0; i < 30; i++ {
		updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
		m = updated.(model)
	}

	ps := m.pageSize()
	if m.selected != 30 {
		t.Fatalf("expected selected=30 after 30xj, got %d", m.selected)
	}
	if m.selected < m.viewportTop || m.selected >= m.viewportTop+ps {
		t.Fatalf("selected %d outside viewport [%d, %d) after j-navigation",
			m.selected, m.viewportTop, m.viewportTop+ps)
	}
}

func TestVirtualScrolling_HomeEnd(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(100)
	m.refreshFiltered()

	// Press 'G' (go to end).
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'G'}})
	m = updated.(model)
	if m.selected != 99 {
		t.Fatalf("G: expected selected=99, got %d", m.selected)
	}
	ps := m.pageSize()
	if m.selected < m.viewportTop || m.selected >= m.viewportTop+ps {
		t.Fatalf("G: selected %d outside viewport [%d, %d)", m.selected, m.viewportTop, m.viewportTop+ps)
	}

	// Press 'g' (go to top).
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'g'}})
	m = updated.(model)
	if m.selected != 0 {
		t.Fatalf("g: expected selected=0, got %d", m.selected)
	}
	if m.viewportTop != 0 {
		t.Fatalf("g: expected viewportTop=0, got %d", m.viewportTop)
	}
}

func TestVirtualScrolling_PgDownPgUp(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30 // pageSize = 17
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(100)
	m.refreshFiltered()

	ps := m.pageSize()

	// PgDown.
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyPgDown})
	m = updated.(model)
	if m.selected != ps {
		t.Fatalf("PgDown: expected selected=%d, got %d", ps, m.selected)
	}

	// PgUp.
	updated, _ = m.Update(tea.KeyMsg{Type: tea.KeyPgUp})
	m = updated.(model)
	if m.selected != 0 {
		t.Fatalf("PgUp: expected selected=0, got %d", m.selected)
	}
	if m.viewportTop != 0 {
		t.Fatalf("PgUp to top: expected viewportTop=0, got %d", m.viewportTop)
	}
}

func TestVirtualScrolling_ResourcesView_RenderedRowCount(t *testing.T) {
	// resourcesView must render at most pageSize rows regardless of total count.
	m := initialModel(Options{})
	m.width = 120
	m.height = 30 // pageSize = 17
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(10_000)
	m.refreshFiltered()

	view := m.resourcesView(110)
	lines := strings.Split(strings.TrimRight(view, "\n"), "\n")
	// lines: title + header + up to pageSize data rows + status line
	// Maximum expected: 1 + 1 + pageSize + 1 = 20
	if len(lines) > 22 {
		t.Fatalf("resourcesView rendered %d lines for 10k pods (pageSize=%d); expected <=22",
			len(lines), m.pageSize())
	}
}

func TestVirtualScrolling_FilterResetsViewport(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(100)
	m.refreshFiltered()

	// Scroll down.
	m.selected = 50
	m.clampViewport()
	if m.viewportTop == 0 {
		t.Fatal("expected viewportTop > 0 after scrolling to 50")
	}

	// Apply a filter that matches only the first few items.
	m.filterInput.SetValue("pod-000")
	m.refreshFiltered() // also calls clampViewport

	// After filtering, viewportTop must be valid (selected in viewport).
	ps := m.pageSize()
	if m.selected < 0 || m.selected >= len(m.filtered) {
		t.Fatalf("selected %d out of filtered range [0,%d)", m.selected, len(m.filtered))
	}
	if m.selected < m.viewportTop || m.selected >= m.viewportTop+ps {
		t.Fatalf("selected %d outside viewport [%d, %d) after filter", m.selected, m.viewportTop, m.viewportTop+ps)
	}
}

func TestVirtualScrolling_StatusLineShowsPosition(t *testing.T) {
	m := initialModel(Options{})
	m.width = 120
	m.height = 30
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = makeRows(50)
	m.refreshFiltered()

	view := m.resourcesView(110)
	// Status line format: "N/total resources  pct%"
	if !strings.Contains(view, "/50 resources") {
		t.Fatalf("status line should contain '/50 resources', got:\n%s", view)
	}
}

// ---------------------------------------------------------------------------
// P1-10: Read-only mode tests
// ---------------------------------------------------------------------------

// TestReadOnly_InitialModelCopiesFlag verifies that ReadOnly from Options
// propagates to the model's readOnly field.
func TestReadOnly_InitialModelCopiesFlag(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	if !m.readOnly {
		t.Fatal("expected model.readOnly = true when Options.ReadOnly = true")
	}
	m2 := initialModel(Options{ReadOnly: false})
	if m2.readOnly {
		t.Fatal("expected model.readOnly = false when Options.ReadOnly = false")
	}
}

// TestReadOnly_EditKeyBlocked ensures the "e" key in list mode sets an error
// message instead of triggering editInEditorCmd when read-only is on.
func TestReadOnly_EditKeyBlocked(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
	}
	m.refreshFiltered()

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}})
	m2 := updated.(model)
	if !strings.Contains(m2.err, "Read-only") {
		t.Fatalf("expected read-only error message for 'e', got: %q", m2.err)
	}
}

// TestReadOnly_ExecShellKeyBlocked ensures "s" in list mode is blocked.
func TestReadOnly_ExecShellKeyBlocked(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
	}
	m.refreshFiltered()

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'s'}})
	m2 := updated.(model)
	if !strings.Contains(m2.err, "Read-only") {
		t.Fatalf("expected read-only error message for 's', got: %q", m2.err)
	}
}

// TestReadOnly_BulkOpsKeyBlocked ensures Ctrl+B in list mode is blocked.
func TestReadOnly_BulkOpsKeyBlocked(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
	}
	m.refreshFiltered()
	// Select a row so bulk would normally proceed.
	m.selectedRows["default/api-0"] = true

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlB})
	m2 := updated.(model)
	if !strings.Contains(m2.err, "Read-only") {
		t.Fatalf("expected read-only error for ctrl+b, got: %q", m2.err)
	}
}

// TestReadOnly_PortForwardKeyBlocked ensures "f" in list mode is blocked.
func TestReadOnly_PortForwardKeyBlocked(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
	}
	m.refreshFiltered()

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}})
	m2 := updated.(model)
	if !strings.Contains(m2.err, "Read-only") {
		t.Fatalf("expected read-only error message for 'f', got: %q", m2.err)
	}
}

// TestReadOnly_HeaderContainsBadge verifies the header includes [READ-ONLY]
// when read-only mode is active.
func TestReadOnly_HeaderContainsBadge(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	m.width = 120
	header := m.headerView()
	if !strings.Contains(header, "READ-ONLY") {
		t.Fatalf("expected header to contain READ-ONLY, got: %q", header)
	}
}

// TestReadOnly_HeaderNoBadgeWhenOff verifies no badge in normal mode.
func TestReadOnly_HeaderNoBadgeWhenOff(t *testing.T) {
	m := initialModel(Options{ReadOnly: false})
	m.width = 120
	header := m.headerView()
	if strings.Contains(header, "READ-ONLY") {
		t.Fatalf("expected no READ-ONLY badge in normal mode, got: %q", header)
	}
}

// TestReadOnly_MutationAllowedWhenOff verifies that "e" key works normally
// when read-only is false (no error set — returns a Cmd, not an error msg).
func TestReadOnly_MutationAllowedWhenOff(t *testing.T) {
	m := initialModel(Options{ReadOnly: false})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
	}
	m.refreshFiltered()

	updated, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}})
	m2 := updated.(model)
	// In non-read-only mode, pressing "e" on a row should not set an error.
	if strings.Contains(m2.err, "Read-only") {
		t.Fatalf("expected no read-only error in normal mode, got: %q", m2.err)
	}
	// A tea.Cmd should have been returned (editor launch).
	if cmd == nil {
		t.Fatal("expected a non-nil Cmd from 'e' in normal mode")
	}
}

// TestReadOnly_HelpViewShowsNotice verifies that the help overlay includes
// the read-only warning when in read-only mode.
func TestReadOnly_HelpViewShowsNotice(t *testing.T) {
	m := initialModel(Options{ReadOnly: true})
	m.width = 80
	help := m.helpView()
	if !strings.Contains(help, "READ-ONLY") {
		t.Fatalf("expected help view to mention READ-ONLY, got: %q", help)
	}
}
