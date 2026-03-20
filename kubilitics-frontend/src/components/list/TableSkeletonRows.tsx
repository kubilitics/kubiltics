import { TableRow, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_ROW_COUNT = 10;

export interface TableSkeletonRowsProps {
  /** Number of columns (e.g. visibleColumnCount). Must match table header. */
  columnCount: number;
  /** Number of skeleton rows to show (default 10). */
  rowCount?: number;
  /** Optional className for each row. */
  rowClassName?: string;
}

/**
 * Renders skeleton table rows while list data is loading.
 * Use instead of a single full-width Loader2 row to avoid layout shift and match column layout.
 * Place inside <TableBody> when isLoading is true.
 */
export function TableSkeletonRows({
  columnCount,
  rowCount = SKELETON_ROW_COUNT,
  rowClassName,
}: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, i) => (
        <TableRow key={i} className={rowClassName} data-skeleton-row>
          {Array.from({ length: columnCount }, (_, j) => (
            <TableCell key={j} className="py-3">
              <Skeleton className="h-6 w-full min-w-[2rem]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
