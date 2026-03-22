/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { TableHead, TableCell } from '@/components/ui/table';

const STORAGE_KEY_PREFIX = 'kubilitics-resizable-table-';
const MIN_WIDTH = 80;
const MAX_WIDTH = 800;

export interface ResizableColumnConfig {
  id: string;
  defaultWidth: number;
  minWidth?: number;
}

type ColumnWidths = Record<string, number>;

function loadWidths(tableId: string, columnConfig: ResizableColumnConfig[]): ColumnWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + tableId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ColumnWidths;
    const result: ColumnWidths = {};
    for (const col of columnConfig) {
      const v = parsed[col.id];
      if (typeof v === 'number' && v >= (col.minWidth ?? MIN_WIDTH) && v <= MAX_WIDTH) {
        result[col.id] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveWidths(tableId: string, widths: ColumnWidths): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + tableId, JSON.stringify(widths));
  } catch {
    // ignore
  }
}

interface ResizableTableContextValue {
  tableId: string;
  columnConfig: ResizableColumnConfig[];
  columnWidths: ColumnWidths;
  setColumnWidth: (columnId: string, width: number) => void;
  getWidth: (columnId: string) => number;
  getMinWidth: (columnId: string) => number;
}

const ResizableTableContext = React.createContext<ResizableTableContextValue | null>(null);

export interface ResizableTableProviderProps {
  tableId: string;
  columnConfig: ResizableColumnConfig[];
  children: React.ReactNode;
}

export function ResizableTableProvider({ tableId, columnConfig, children }: ResizableTableProviderProps) {
  const [columnWidths, setColumnWidthsState] = React.useState<ColumnWidths>(() =>
    loadWidths(tableId, columnConfig),
  );

  const setColumnWidth = React.useCallback(
    (columnId: string, width: number) => {
      const config = columnConfig.find((c) => c.id === columnId);
      const minW = config?.minWidth ?? MIN_WIDTH;
      const clamped = Math.min(MAX_WIDTH, Math.max(minW, width));
      setColumnWidthsState((prev) => {
        const next = { ...prev, [columnId]: clamped };
        saveWidths(tableId, next);
        return next;
      });
    },
    [tableId, columnConfig],
  );

  const getWidth = React.useCallback(
    (columnId: string) => {
      const stored = columnWidths[columnId];
      if (typeof stored === 'number') return stored;
      const config = columnConfig.find((c) => c.id === columnId);
      return config?.defaultWidth ?? 120;
    },
    [columnWidths, columnConfig],
  );

  const getMinWidth = React.useCallback(
    (columnId: string) => {
      const config = columnConfig.find((c) => c.id === columnId);
      return config?.minWidth ?? MIN_WIDTH;
    },
    [columnConfig],
  );

  const value: ResizableTableContextValue = {
    tableId,
    columnConfig,
    columnWidths,
    setColumnWidth,
    getWidth,
    getMinWidth,
  };

  return (
    <ResizableTableContext.Provider value={value}>
      {children}
    </ResizableTableContext.Provider>
  );
}

export function useResizableTable(): ResizableTableContextValue {
  const ctx = React.useContext(ResizableTableContext);
  if (!ctx) throw new Error('useResizableTable must be used within ResizableTableProvider');
  return ctx;
}

/** Optional: use inside ResizableTableProvider to get width for a cell without rendering the resize UI. */
export function useResizableColumnStyle(columnId: string): React.CSSProperties {
  const ctx = React.useContext(ResizableTableContext);
  if (!ctx) return {};
  const width = ctx.getWidth(columnId);
  const minWidth = ctx.getMinWidth(columnId);
  return { width, minWidth, maxWidth: width };
}

/** Resize handle: visible vertical rule, wide hit area for easy grabbing. */
const RESIZE_HANDLE_HIT_WIDTH = 10; // px — comfortable grab area

function ResizeHandle({ columnId }: { columnId: string }) {
  const ctx = React.useContext(ResizableTableContext);
  const [isHovered, setIsHovered] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(0);

  if (!ctx) return null;

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = ctx.getWidth(columnId);
    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current;
      ctx.setColumnWidth(columnId, startWidthRef.current + delta);
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const active = isHovered || isDragging;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      title="Drag to resize column"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'absolute right-0 top-0 bottom-0 cursor-col-resize flex items-stretch justify-center z-[1]',
        'rounded-sm transition-colors duration-150',
        active && 'bg-primary/10'
      )}
      style={{
        width: RESIZE_HANDLE_HIT_WIDTH,
        marginRight: -Math.floor(RESIZE_HANDLE_HIT_WIDTH / 2),
        touchAction: 'none',
      }}
    >
      {/* Always-visible vertical rule; bold on hover/drag so you know where to grab */}
      <div
        className={cn(
          'self-stretch rounded-full transition-all duration-150',
          active ? 'w-0.5 bg-primary' : 'w-px bg-border'
        )}
      />
    </div>
  );
}

/** Resizable table header cell: drag the right edge to resize. Use inside ResizableTableProvider. */
export interface ResizableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  columnId: string;
  children: React.ReactNode;
}

export const ResizableTableHead = React.forwardRef<HTMLTableCellElement, ResizableTableHeadProps>(
  ({ columnId, children, className, style, ...props }, ref) => {
    const ctx = React.useContext(ResizableTableContext);
    const width = ctx ? ctx.getWidth(columnId) : undefined;
    const minWidth = ctx ? ctx.getMinWidth(columnId) : undefined;

    return (
      <TableHead
        ref={ref}
        className={cn('relative select-none', className)}
        style={{
          ...style,
          width: width ?? style?.width,
          minWidth: minWidth ?? style?.minWidth,
        }}
        {...props}
      >
        {children}
        {ctx && <ResizeHandle columnId={columnId} />}
      </TableHead>
    );
  },
);
ResizableTableHead.displayName = 'ResizableTableHead';

/** Resizable table body cell: same width as header. Use inside ResizableTableProvider. */
export interface ResizableTableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  columnId: string;
  children?: React.ReactNode;
}

export const ResizableTableCell = React.forwardRef<HTMLTableCellElement, ResizableTableCellProps>(
  ({ columnId, children, className, style, ...props }, ref) => {
    const ctx = React.useContext(ResizableTableContext);
    const width = ctx ? ctx.getWidth(columnId) : undefined;
    const minWidth = ctx ? ctx.getMinWidth(columnId) : undefined;

    return (
      <TableCell
        ref={ref}
        className={cn('min-w-0 overflow-hidden', className)}
        style={{
          ...style,
          width: width ?? style?.width,
          minWidth: minWidth ?? style?.minWidth,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        {...props}
      >
        {children}
      </TableCell>
    );
  },
);
ResizableTableCell.displayName = 'ResizableTableCell';
