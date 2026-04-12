package output

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// ResourceScope determines whether a table shows NAMESPACE or CLUSTER column.
type ResourceScope int

const (
	ScopeNamespaced ResourceScope = iota // Adds NAMESPACE column
	ScopeCluster                         // Adds CLUSTER column
)

// Column priority constants — lower number = higher priority = shown on narrower terminals.
const (
	PriorityAlways    = 1 // NAME — never hidden
	PriorityCritical  = 2 // STATUS, READY — essential info
	PriorityContext   = 3 // NAMESPACE, AGE — important context
	PrioritySecondary = 4 // IP, NODE, TYPE, PORTS — detail
	PriorityExtended  = 5 // LABELS, ANNOTATIONS, CONDITIONS — wide only
)

// ResourceTableOpts configures a resource table.
type ResourceTableOpts struct {
	Scope       ResourceScope
	ClusterName string // current context name, used for CLUSTER column
	ShowNumber  bool   // add a # serial number column (default true)
}

// NewResourceTable creates a Table pre-configured for Kubernetes resource display.
// It automatically adds a # column and a NAMESPACE/CLUSTER column.
func NewResourceTable(opts ResourceTableOpts) *Table {
	table := NewTable()
	table.Style = Rounded
	table.AutoNumber = true // auto-populate # column during Render

	// # column — always first, always visible
	table.AddColumn(Column{
		Name:     "#",
		Priority: PriorityAlways,
		MinWidth: 3,
		MaxWidth: 5,
		Align:    Right,
		ColorFunc: func(string) lipgloss.Style {
			return GetTheme().Muted
		},
		isAutoNum: true,
	})

	switch opts.Scope {
	case ScopeNamespaced:
		table.NSColIdx = len(table.Columns) // track NAMESPACE column index
		table.AddColumn(Column{
			Name:     "NAMESPACE",
			Priority: PriorityContext,
			MinWidth: 12,
			MaxWidth: 25,
			Align:    Left,
			ColorFunc: func(string) lipgloss.Style {
				return GetTheme().Info
			},
		})
	case ScopeCluster:
		clusterName := opts.ClusterName
		if clusterName == "" {
			clusterName = "—"
		}
		table.AddColumn(Column{
			Name:     "CLUSTER",
			Priority: PrioritySecondary,
			MinWidth: 10,
			MaxWidth: 30,
			Align:    Left,
			ColorFunc: func(string) lipgloss.Style {
				return GetTheme().Primary
			},
		})
	}

	return table
}

// AddNameColumn adds a NAME column with highest priority (always visible).
func (t *Table) AddNameColumn(names ...string) {
	name := "NAME"
	if len(names) > 0 && names[0] != "" {
		name = names[0]
	}
	t.NameColIdx = len(t.Columns) // track NAME column index for interactive mode
	t.AddColumn(Column{
		Name:     name,
		Priority: PriorityAlways,
		MinWidth: 20,
		MaxWidth: 55,
		Align:    Left,
		ColorFunc: func(string) lipgloss.Style {
			return GetTheme().Primary
		},
	})
}

// AddStatusColumn adds a STATUS column with auto-coloring based on resource kind.
func (t *Table) AddStatusColumn(resourceKind string) {
	t.AddColumn(Column{
		Name:      "STATUS",
		Priority:  PriorityCritical,
		MinWidth:  12,
		MaxWidth:  22,
		Align:     Left,
		ColorFunc: StatusColorFunc(resourceKind),
	})
}

// AddReadyColumn adds a READY column (e.g. "3/3") with color based on readiness.
func (t *Table) AddReadyColumn() {
	t.AddColumn(Column{
		Name:      "READY",
		Priority:  PriorityCritical,
		MinWidth:  5,
		MaxWidth:  8,
		Align:     Right,
		ColorFunc: ReadyColorFunc(),
	})
}

// AddAgeColumn adds an AGE column with time-gradient coloring.
func (t *Table) AddAgeColumn() {
	t.AddColumn(Column{
		Name:      "AGE",
		Priority:  PriorityContext,
		MinWidth:  8,
		MaxWidth:  15,
		Align:     Left,
		ColorFunc: AgeColorFunc(),
	})
}

// StatusColorFunc returns a ColorFunc that maps status text to themed colors.
func StatusColorFunc(resourceKind string) func(string) lipgloss.Style {
	return func(value string) lipgloss.Style {
		// Strip icon prefix if present ("✓ Running" → "Running")
		clean := value
		for _, prefix := range []string{"✓ ", "✗ ", "⏳ ", "— ", "? "} {
			clean = strings.TrimPrefix(clean, prefix)
		}
		return StatusStyle(resourceKind, clean)
	}
}

// ReadyColorFunc returns a ColorFunc that parses "N/M" format and colors accordingly.
func ReadyColorFunc() func(string) lipgloss.Style {
	return func(value string) lipgloss.Style {
		theme := GetTheme()
		parts := strings.Split(value, "/")
		if len(parts) == 2 {
			ready, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
			total, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
			if err1 == nil && err2 == nil {
				if ready == total && ready > 0 {
					return theme.StatusReady
				}
				if ready == 0 {
					return theme.StatusError
				}
				return theme.StatusPending
			}
		}
		return theme.Primary
	}
}

// AgeColorFunc returns a ColorFunc that colors age strings by recency.
func AgeColorFunc() func(string) lipgloss.Style {
	return func(value string) lipgloss.Style {
		switch {
		case strings.Contains(value, "now") || strings.Contains(value, "s ago") || strings.Contains(value, "m ago"):
			return lipgloss.NewStyle().Foreground(lipgloss.Color("10")) // green — fresh
		case strings.Contains(value, "h ago") || strings.Contains(value, "d ago"):
			return lipgloss.NewStyle() // default — normal
		case strings.Contains(value, "w ago"):
			return lipgloss.NewStyle().Foreground(lipgloss.Color("11")) // yellow — aging
		case strings.Contains(value, "mo ago") || strings.Contains(value, "y ago"):
			return lipgloss.NewStyle().Foreground(lipgloss.Color("208")) // orange — old
		default:
			return lipgloss.NewStyle()
		}
	}
}

// RestartColorFunc returns a ColorFunc that colors restart counts.
func RestartColorFunc() func(string) lipgloss.Style {
	return func(value string) lipgloss.Style {
		theme := GetTheme()
		n, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return theme.Primary
		}
		switch {
		case n == 0:
			return theme.StatusReady
		case n <= 5:
			return theme.Warning
		default:
			return theme.Error
		}
	}
}

// FormatStatus prepends a status icon to the status string.
// Returns "✓ Running", "✗ Failed", "⏳ Pending", etc.
func FormatStatus(status string) string {
	icon := StatusIcon(status)
	return icon + " " + status
}

// Print renders the table at auto-detected terminal width and prints it to stdout.
func (t *Table) Print() {
	fmt.Print(t.Render(0))
}

// PrintTo renders the table and writes to the given writer.
func (t *Table) PrintTo(w interface{ Write([]byte) (int, error) }) {
	w.Write([]byte(t.Render(0)))
}
