package output

import (
	"fmt"
	"strings"
	"sync"

	"github.com/charmbracelet/lipgloss"
	"github.com/mattn/go-runewidth"
)

type Alignment int

const (
	Left Alignment = iota
	Center
	Right
)

type TableStyle int

const (
	Rounded TableStyle = iota
	Sharp
	Minimal
	None
)

type Column struct {
	Name      string
	Priority  int
	MinWidth  int
	MaxWidth  int
	Align     Alignment
	ColorFunc func(value string) lipgloss.Style
	origIndex int  // set by adaptColumns to map back to row data index
	isAutoNum bool // true for auto-generated # column
}

type Table struct {
	Columns    []Column
	Rows       [][]string
	Style      TableStyle
	SortCol    int
	SortDesc   bool
	ShowFooter bool
	FooterRow  []string
	AutoNumber bool // when true, # column values are auto-populated during Render
	mu         sync.RWMutex

	// NameColIdx and NSColIdx track which column indices hold resource name and
	// namespace data. Set by NewResourceTable to enable interactive mode.
	NameColIdx int
	NSColIdx   int
}

// ResourceNames returns the NAME column values from all rows (for interactive mode).
func (t *Table) ResourceNames() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	names := make([]string, 0, len(t.Rows))
	for _, row := range t.Rows {
		if t.NameColIdx < len(row) {
			names = append(names, row[t.NameColIdx])
		}
	}
	return names
}

// ResourceNamespaces returns the NAMESPACE column values from all rows.
func (t *Table) ResourceNamespaces() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	nss := make([]string, 0, len(t.Rows))
	for _, row := range t.Rows {
		if t.NSColIdx < len(row) {
			nss = append(nss, row[t.NSColIdx])
		}
	}
	return nss
}

func NewTable() *Table {
	return &Table{
		Columns:    []Column{},
		Rows:       [][]string{},
		Style:      Rounded,
		SortCol:    -1,
		SortDesc:   false,
		ShowFooter: false,
	}
}

func (t *Table) AddColumn(col Column) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if col.Priority == 0 {
		col.Priority = 5
	}
	if col.MinWidth == 0 {
		col.MinWidth = 10
	}
	if col.MaxWidth == 0 {
		col.MaxWidth = 50
	}
	if col.ColorFunc == nil {
		col.ColorFunc = func(s string) lipgloss.Style { return lipgloss.NewStyle() }
	}

	col.origIndex = len(t.Columns)
	t.Columns = append(t.Columns, col)
}

func (t *Table) AddRow(row []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	// If AutoNumber is enabled, prepend an empty placeholder for the # column.
	// The actual number is populated during Render().
	if t.AutoNumber && len(t.Columns) > 0 && t.Columns[0].Name == "#" {
		row = append([]string{""}, row...)
	}
	t.Rows = append(t.Rows, row)
}

func (t *Table) SetFooter(row []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.FooterRow = row
	t.ShowFooter = true
}

func (t *Table) Render(width int) string {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if len(t.Columns) == 0 {
		return ""
	}

	if width <= 0 {
		width = TermWidth()
	}

	// Auto-number: find the # column index and populate row values
	if t.AutoNumber {
		numColIdx := -1
		for i, col := range t.Columns {
			if col.Name == "#" {
				numColIdx = i
				break
			}
		}
		if numColIdx >= 0 {
			for rowIdx := range t.Rows {
				// Ensure the row has enough slots
				for len(t.Rows[rowIdx]) <= numColIdx {
					t.Rows[rowIdx] = append(t.Rows[rowIdx], "")
				}
				t.Rows[rowIdx][numColIdx] = fmt.Sprintf("%d", rowIdx+1)
			}
			// Auto-add footer with total count if not already set
			if !t.ShowFooter && len(t.Rows) > 0 {
				footer := make([]string, len(t.Columns))
				footer[numColIdx] = fmt.Sprintf("%d", len(t.Rows))
				// Put label in the NAME column if set, otherwise in the column after #
				totalIdx := -1
				if t.NameColIdx > numColIdx {
					totalIdx = t.NameColIdx
				} else if numColIdx+1 < len(footer) {
					totalIdx = numColIdx + 1
				}
				if totalIdx >= 0 && totalIdx < len(footer) {
					footer[totalIdx] = fmt.Sprintf("Total: %d resources", len(t.Rows))
				}
				t.FooterRow = footer
				t.ShowFooter = true
			}
		}
	}

	visibleCols := adaptColumns(t.Columns, width)
	colWidths := calculateColumnWidths(visibleCols, t.Rows, t.FooterRow, width)

	var result strings.Builder

	switch t.Style {
	case Rounded:
		result.WriteString(t.renderRounded(visibleCols, colWidths))
	case Sharp:
		result.WriteString(t.renderSharp(visibleCols, colWidths))
	case Minimal:
		result.WriteString(t.renderMinimal(visibleCols, colWidths))
	case None:
		result.WriteString(t.renderNone(visibleCols, colWidths))
	default:
		result.WriteString(t.renderRounded(visibleCols, colWidths))
	}

	return result.String()
}

func (t *Table) renderRounded(cols []Column, widths []int) string {
	var result strings.Builder
	theme := GetTheme()

	result.WriteString(theme.Border.Render("╭"))
	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]+2))
		if i < len(cols)-1 {
			result.WriteString(theme.Border.Render("┬"))
		}
	}
	result.WriteString(theme.Border.Render("╮"))
	result.WriteString("\n")

	result.WriteString(theme.Border.Render("│"))
	for i, col := range cols {
		headerText := padText(col.Name, widths[i], col.Align)
		result.WriteString(" " + theme.Header.Render(headerText) + " ")
		result.WriteString(theme.Border.Render("│"))
	}
	result.WriteString("\n")

	result.WriteString(theme.Border.Render("├"))
	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]+2))
		if i < len(cols)-1 {
			result.WriteString(theme.Border.Render("┼"))
		}
	}
	result.WriteString(theme.Border.Render("┤"))
	result.WriteString("\n")

	for _, row := range t.Rows {
		result.WriteString(theme.Border.Render("│"))
		for i, col := range cols {
			cell := rowCell(row, col)
			if cell != "" || col.origIndex < len(row) {
				cellText := truncateText(cell, widths[i])
				cellText = padText(cellText, widths[i], col.Align)
				styled := col.ColorFunc(cell)
				result.WriteString(" " + styled.Render(cellText) + " ")
			} else {
				result.WriteString(" " + strings.Repeat(" ", widths[i]) + " ")
			}
			result.WriteString(theme.Border.Render("│"))
		}
		result.WriteString("\n")
	}

	if t.ShowFooter && len(t.FooterRow) > 0 {
		t.renderFooterMerged(&result, cols, widths, theme, "├", "┼", "─", "┤", "│")
	}

	result.WriteString(theme.Border.Render("╰"))
	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]+2))
		if i < len(cols)-1 {
			result.WriteString(theme.Border.Render("┴"))
		}
	}
	result.WriteString(theme.Border.Render("╯"))
	result.WriteString("\n")

	return result.String()
}

func (t *Table) renderSharp(cols []Column, widths []int) string {
	var result strings.Builder
	theme := GetTheme()

	result.WriteString(theme.Border.Render("┌"))
	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]+2))
		if i < len(cols)-1 {
			result.WriteString(theme.Border.Render("┬"))
		}
	}
	result.WriteString(theme.Border.Render("┐"))
	result.WriteString("\n")

	result.WriteString(theme.Border.Render("│"))
	for i, col := range cols {
		headerText := padText(col.Name, widths[i], col.Align)
		result.WriteString(" " + theme.Header.Render(headerText) + " ")
		result.WriteString(theme.Border.Render("│"))
	}
	result.WriteString("\n")

	result.WriteString(theme.Border.Render("├"))
	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]+2))
		if i < len(cols)-1 {
			result.WriteString(theme.Border.Render("┼"))
		}
	}
	result.WriteString(theme.Border.Render("┤"))
	result.WriteString("\n")

	for _, row := range t.Rows {
		result.WriteString(theme.Border.Render("│"))
		for i, col := range cols {
			cell := rowCell(row, col)
			cellText := truncateText(cell, widths[i])
			cellText = padText(cellText, widths[i], col.Align)
			styled := col.ColorFunc(cell)
			result.WriteString(" " + styled.Render(cellText) + " ")
			result.WriteString(theme.Border.Render("│"))
		}
		result.WriteString("\n")
	}

	if t.ShowFooter && len(t.FooterRow) > 0 {
		t.renderFooterMerged(&result, cols, widths, theme, "├", "┼", "─", "┤", "│")
	}

	result.WriteString(theme.Border.Render("└"))
	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]+2))
		if i < len(cols)-1 {
			result.WriteString(theme.Border.Render("┴"))
		}
	}
	result.WriteString(theme.Border.Render("┘"))
	result.WriteString("\n")

	return result.String()
}

func (t *Table) renderMinimal(cols []Column, widths []int) string {
	var result strings.Builder
	theme := GetTheme()

	for i, col := range cols {
		headerText := padText(col.Name, widths[i], col.Align)
		result.WriteString(theme.Header.Render(headerText))
		if i < len(cols)-1 {
			result.WriteString("  ")
		}
	}
	result.WriteString("\n")

	for i := range cols {
		result.WriteString(strings.Repeat("─", widths[i]))
		if i < len(cols)-1 {
			result.WriteString("  ")
		}
	}
	result.WriteString("\n")

	for _, row := range t.Rows {
		for i, col := range cols {
			cell := rowCell(row, col)
			cellText := truncateText(cell, widths[i])
			cellText = padText(cellText, widths[i], col.Align)
			styled := col.ColorFunc(cell)
			result.WriteString(styled.Render(cellText))
			if i < len(cols)-1 {
				result.WriteString("  ")
			}
		}
		result.WriteString("\n")
	}

	if t.ShowFooter && len(t.FooterRow) > 0 {
		t.renderFooterMerged(&result, cols, widths, theme, "", "", "─", "", "")
	}

	return result.String()
}

func (t *Table) renderNone(cols []Column, widths []int) string {
	var result strings.Builder

	for i, col := range cols {
		headerText := padText(col.Name, widths[i], col.Align)
		result.WriteString(headerText)
		if i < len(cols)-1 {
			result.WriteString("  ")
		}
	}
	result.WriteString("\n")

	for _, row := range t.Rows {
		for i, col := range cols {
			cell := rowCell(row, col)
			cellText := truncateText(cell, widths[i])
			cellText = padText(cellText, widths[i], col.Align)
			result.WriteString(cellText)
			if i < len(cols)-1 {
				result.WriteString("  ")
			}
		}
		result.WriteString("\n")
	}

	if t.ShowFooter && len(t.FooterRow) > 0 {
		theme := GetTheme()
		t.renderFooterMerged(&result, cols, widths, theme, "", "", "", "", "")
	}

	return result.String()
}

// rowCell returns the cell value for a visible column, using origIndex
// to map back to the row's data slice.
func rowCell(row []string, col Column) string {
	idx := col.origIndex
	if idx < len(row) {
		return row[idx]
	}
	return ""
}

// renderFooterMerged renders a footer row where the label text spans all columns
// after the # column, preventing truncation. Border chars are empty for borderless styles.
func (t *Table) renderFooterMerged(result *strings.Builder, cols []Column, widths []int, theme *Theme,
	leftJoin, midJoin, hLine, rightJoin, vLine string) {

	if len(t.FooterRow) == 0 {
		return
	}

	hasBorder := vLine != ""

	// Separator line
	if hLine != "" {
		if hasBorder {
			result.WriteString(theme.Border.Render(leftJoin))
		}
		for i := range cols {
			result.WriteString(strings.Repeat(hLine, widths[i]+2))
			if i < len(cols)-1 {
				if hasBorder {
					result.WriteString(theme.Border.Render(midJoin))
				} else {
					result.WriteString("  ")
				}
			}
		}
		if hasBorder {
			result.WriteString(theme.Border.Render(rightJoin))
		}
		result.WriteString("\n")
	}

	// Find which cells have content
	var numCell string // the # count cell
	var labelCell string
	numColVisible := -1

	for i, col := range cols {
		cell := rowCell(t.FooterRow, col)
		if cell == "" {
			continue
		}
		if col.isAutoNum || col.Name == "#" {
			numCell = cell
			numColVisible = i
		} else if labelCell == "" {
			labelCell = cell
		}
	}

	// Render the row
	if hasBorder {
		result.WriteString(theme.Border.Render(vLine))
	}

	for i := range cols {
		w := widths[i]
		if i == numColVisible && numCell != "" {
			// Render # count cell normally
			cellText := padText(numCell, w, Right)
			result.WriteString(" " + theme.Muted.Render(cellText) + " ")
		} else if i == numColVisible+1 && labelCell != "" {
			// Merge remaining columns for the label
			mergedWidth := w
			for j := i + 1; j < len(cols); j++ {
				mergedWidth += widths[j] + 3 // +3 for " │ " border
			}
			cellText := truncateText(labelCell, mergedWidth)
			cellText = padText(cellText, mergedWidth, Left)
			result.WriteString(" " + theme.Muted.Render(cellText) + " ")
			if hasBorder {
				result.WriteString(theme.Border.Render(vLine))
			}
			break // done — we merged all remaining columns
		} else {
			result.WriteString(" " + strings.Repeat(" ", w) + " ")
		}
		if hasBorder {
			result.WriteString(theme.Border.Render(vLine))
		} else if i < len(cols)-1 {
			result.WriteString("  ")
		}
	}
	result.WriteString("\n")
}

func calculateColumnWidths(cols []Column, rows [][]string, footerRow []string, termWidth int) []int {
	widths := make([]int, len(cols))

	for i, col := range cols {
		widths[i] = runewidth.StringWidth(col.Name)

		for _, row := range rows {
			cell := rowCell(row, col)
			cellWidth := runewidth.StringWidth(cell)
			if cellWidth > widths[i] {
				widths[i] = cellWidth
			}
		}

		// Include footer row in width calculation
		if len(footerRow) > 0 {
			cell := rowCell(footerRow, col)
			cellWidth := runewidth.StringWidth(cell)
			if cellWidth > widths[i] {
				widths[i] = cellWidth
			}
		}

		if widths[i] < col.MinWidth {
			widths[i] = col.MinWidth
		}
		if col.MaxWidth > 0 && widths[i] > col.MaxWidth {
			widths[i] = col.MaxWidth
		}
	}

	totalWidth := 0
	for _, w := range widths {
		totalWidth += w + 3
	}

	if totalWidth > termWidth {
		availableWidth := termWidth - (3 * len(cols))
		for availableWidth > 0 && totalWidth > termWidth {
			maxReducibleIdx := -1
			maxReducibleAmount := 0

			for i, col := range cols {
				if widths[i] > col.MinWidth {
					reducibleAmount := widths[i] - col.MinWidth
					if reducibleAmount > maxReducibleAmount {
						maxReducibleAmount = reducibleAmount
						maxReducibleIdx = i
					}
				}
			}

			if maxReducibleIdx == -1 {
				break
			}

			widths[maxReducibleIdx]--
			totalWidth--
		}
	}

	return widths
}

func adaptColumns(cols []Column, width int) []Column {
	if len(cols) == 0 {
		return cols
	}

	if width <= 0 {
		width = TermWidth()
	}

	breakpoint := DetectBreakpoint(width)
	minBorderWidth := 3

	// First pass: determine which columns are eligible based on breakpoint
	eligible := make([]bool, len(cols))
	for i, col := range cols {
		if breakpoint == XS && col.Priority > 3 {
			eligible[i] = false
		} else if breakpoint == SM && col.Priority > 4 {
			eligible[i] = false
		} else {
			eligible[i] = true
		}
	}

	// Second pass: from eligible columns (in original order), include those
	// that fit within the terminal width. Always include Priority 1 columns.
	// Track original index so the renderer can map row data correctly.
	var visible []Column
	totalWidth := 0

	for i, col := range cols {
		if !eligible[i] {
			continue
		}
		colTotalWidth := col.MinWidth + minBorderWidth

		if totalWidth+colTotalWidth <= width || col.Priority == 1 {
			col.origIndex = i
			visible = append(visible, col)
			totalWidth += colTotalWidth
		}
	}

	if len(visible) == 0 && len(cols) > 0 {
		visible = []Column{cols[0]}
	}

	return visible
}

func padText(text string, width int, align Alignment) string {
	displayWidth := runewidth.StringWidth(text)
	if displayWidth >= width {
		return text
	}

	padding := width - displayWidth

	switch align {
	case Right:
		return strings.Repeat(" ", padding) + text
	case Center:
		leftPad := padding / 2
		rightPad := padding - leftPad
		return strings.Repeat(" ", leftPad) + text + strings.Repeat(" ", rightPad)
	default:
		return text + strings.Repeat(" ", padding)
	}
}

func truncateText(text string, maxWidth int) string {
	if maxWidth <= 0 {
		return text
	}

	displayWidth := runewidth.StringWidth(text)
	if displayWidth <= maxWidth {
		return text
	}

	if maxWidth <= 3 {
		return strings.Repeat(".", maxWidth)
	}

	// Truncate rune-by-rune to respect display width
	result := []rune(text)
	w := 0
	for i, r := range result {
		rw := runewidth.RuneWidth(r)
		if w+rw > maxWidth-1 { // -1 for ellipsis
			return string(result[:i]) + "…"
		}
		w += rw
	}
	return text
}
