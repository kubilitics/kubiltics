import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    TableBody,
    TableCell,
    TableRow,
} from '@/components/ui/table';

interface VirtualTableBodyProps<T> {
    data: T[];
    renderRow: (item: T) => React.ReactNode;
    rowHeight?: number;
    tableContainerRef: React.RefObject<HTMLDivElement>;
}

export function VirtualTableBody<T>({
    data,
    renderRow,
    rowHeight = 48,
    tableContainerRef,
}: VirtualTableBodyProps<T>) {
    const virtualizer = useVirtualizer({
        count: data.length,
        getScrollElement: () => tableContainerRef.current,
        estimateSize: () => rowHeight,
        overscan: 20,
    });

    const items = virtualizer.getVirtualItems();

    // Calculate padding based on virtualizer state
    const totalSize = virtualizer.getTotalSize();
    const paddingTop = items.length > 0 ? items[0].start : 0;
    const paddingBottom = items.length > 0 ? totalSize - items[items.length - 1].end : 0;

    if (data.length === 0) return (
        <TableBody>
            <TableRow>
                <TableCell colSpan={100} className="h-24 text-center">
                    No results.
                </TableCell>
            </TableRow>
        </TableBody>
    );

    return (
        <TableBody>
            {paddingTop > 0 && (
                <TableRow>
                    <TableCell colSpan={100} style={{ padding: 0, height: paddingTop, border: 'none' }} />
                </TableRow>
            )}
            {items.map((virtualRow) => (
                <React.Fragment key={virtualRow.key}>
                    {renderRow(data[virtualRow.index])}
                </React.Fragment>
            ))}
            {paddingBottom > 0 && (
                <TableRow>
                    <TableCell colSpan={100} style={{ padding: 0, height: paddingBottom, border: 'none' }} />
                </TableRow>
            )}
        </TableBody>
    );
}
