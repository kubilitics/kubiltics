package output

import (
	"strings"
	"testing"
)

func TestNewTable(t *testing.T) {
	table := NewTable()
	if table == nil {
		t.Fatal("NewTable() returned nil")
	}
	if table.Style != Rounded {
		t.Errorf("default style = %v, want Rounded", table.Style)
	}
}

func TestTableAddColumnAndRow(t *testing.T) {
	table := NewTable()
	table.AddColumn(Column{Name: "NAME", Priority: 10, MinWidth: 10, MaxWidth: 30, Align: Left})
	table.AddColumn(Column{Name: "STATUS", Priority: 8, MinWidth: 8, MaxWidth: 20, Align: Left})

	table.AddRow([]string{"api-server", "Running"})
	table.AddRow([]string{"worker", "Pending"})

	if len(table.Rows) != 2 {
		t.Errorf("row count = %d, want 2", len(table.Rows))
	}
	if len(table.Columns) != 2 {
		t.Errorf("column count = %d, want 2", len(table.Columns))
	}
}

func TestTableRender(t *testing.T) {
	table := NewTable()
	table.Style = Minimal
	table.AddColumn(Column{Name: "NAME", Priority: 10, MinWidth: 10, MaxWidth: 30, Align: Left})
	table.AddColumn(Column{Name: "AGE", Priority: 8, MinWidth: 5, MaxWidth: 10, Align: Left})

	table.AddRow([]string{"pod-1", "2d"})
	table.AddRow([]string{"pod-2", "5h"})

	result := table.Render(80)
	if result == "" {
		t.Error("Render() returned empty string")
	}
	if !strings.Contains(result, "NAME") {
		t.Error("Render() output missing header NAME")
	}
	if !strings.Contains(result, "pod-1") {
		t.Error("Render() output missing row data pod-1")
	}
	if !strings.Contains(result, "pod-2") {
		t.Error("Render() output missing row data pod-2")
	}
}

func TestTableSetFooter(t *testing.T) {
	table := NewTable()
	table.AddColumn(Column{Name: "STATUS", Priority: 10, MinWidth: 10, MaxWidth: 20, Align: Left})
	table.AddColumn(Column{Name: "COUNT", Priority: 10, MinWidth: 5, MaxWidth: 10, Align: Right})

	table.AddRow([]string{"Running", "5"})
	table.AddRow([]string{"Pending", "2"})
	table.SetFooter([]string{"Total", "7"})

	if !table.ShowFooter {
		t.Error("ShowFooter should be true after SetFooter")
	}
	if len(table.FooterRow) != 2 {
		t.Errorf("footer row length = %d, want 2", len(table.FooterRow))
	}

	result := table.Render(80)
	if !strings.Contains(result, "Total") {
		t.Error("Render() output missing footer Total")
	}
}

func TestTableStyles(t *testing.T) {
	styles := []TableStyle{Rounded, Sharp, Minimal, None}
	for _, style := range styles {
		table := NewTable()
		table.Style = style
		table.AddColumn(Column{Name: "A", Priority: 10, MinWidth: 5, MaxWidth: 10, Align: Left})
		table.AddRow([]string{"hello"})

		result := table.Render(80)
		if result == "" {
			t.Errorf("Render() with style %v returned empty string", style)
		}
	}
}

func TestTableFooterBoundsCheck(t *testing.T) {
	table := NewTable()
	table.Style = Rounded
	table.AddColumn(Column{Name: "A", Priority: 1, MinWidth: 5, MaxWidth: 10, Align: Left})
	table.AddColumn(Column{Name: "B", Priority: 1, MinWidth: 5, MaxWidth: 10, Align: Left})
	table.AddRow([]string{"hello", "world"})

	// Set a footer shorter than the column count — should not panic
	table.SetFooter([]string{"total"})

	result := table.Render(80)
	if result == "" {
		t.Error("Render with short footer should not return empty or panic")
	}
	if !strings.Contains(result, "total") {
		t.Error("Short footer should still render available cells")
	}
}

func TestTableEmptyRows(t *testing.T) {
	table := NewTable()
	table.AddColumn(Column{Name: "NAME", Priority: 10, MinWidth: 10, MaxWidth: 30, Align: Left})

	result := table.Render(80)
	// Should handle empty rows gracefully (just headers or empty)
	if result == "" {
		// Empty table can return empty string — that's fine
		return
	}
	if !strings.Contains(result, "NAME") {
		t.Error("Empty table should still render header")
	}
}
