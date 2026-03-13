import { Columns } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ColumnVisibilityOption } from '@/hooks/useColumnVisibility';

export interface ColumnVisibilityDropdownProps {
  /** Column id + label for each toggleable column */
  columns: ColumnVisibilityOption[];
  /** Currently visible column ids (including always-visible like "name") */
  visibleColumns: Set<string>;
  /** Toggle a column's visibility */
  onToggle: (columnId: string, visible: boolean) => void;
  /** Optional aria-label for the trigger button */
  ariaLabel?: string;
  /** When true, show "Columns" label next to icon (default: true for consistency with filter button) */
  showLabel?: boolean;
}

/**
 * Dropdown button (Columns icon) with checkboxes to show/hide table columns.
 * Uses DropdownMenuCheckboxItem for reliable toggle behavior. Includes Hide all / Show all.
 */
export function ColumnVisibilityDropdown({
  columns,
  visibleColumns,
  onToggle,
  ariaLabel = 'Toggle columns',
  showLabel = true,
}: ColumnVisibilityDropdownProps) {
  const allVisible = columns.every((col) => visibleColumns.has(col.id));
  const noneVisible = columns.every((col) => !visibleColumns.has(col.id));

  const handleHideAll = () => {
    columns.forEach((col) => onToggle(col.id, false));
  };

  const handleShowAll = () => {
    columns.forEach((col) => onToggle(col.id, true));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 min-w-0 press-effect"
          aria-label={ariaLabel}
        >
          <Columns className="h-3.5 w-3.5 shrink-0" />
          {showLabel && <span className="whitespace-nowrap">Columns</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Show / hide columns
        </DropdownMenuLabel>
        <div className="flex gap-1 px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={handleHideAll}
            disabled={noneVisible}
          >
            Hide all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={handleShowAll}
            disabled={allVisible}
          >
            Show all
          </Button>
        </div>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.id}
            checked={visibleColumns.has(col.id)}
            onCheckedChange={(checked) => onToggle(col.id, checked === true)}
            onSelect={(e) => e.preventDefault()}
            className="cursor-pointer"
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
