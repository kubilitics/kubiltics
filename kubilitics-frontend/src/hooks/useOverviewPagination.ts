import { useState, useEffect } from 'react';

/**
 * Client-side pagination hook for all Overview pages.
 * Automatically resets to page 1 when the search query or page size changes.
 */
export function useOverviewPagination<T>(
  items: T[],
  searchQuery: string,
  initialPageSize = 25,
) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Reset to page 1 whenever the filtered set or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  // Guard against currentPage going out of range after filter narrows
  const safePage = Math.min(currentPage, totalPages);

  const startIndex = (safePage - 1) * pageSize;
  const paginatedItems = items.slice(startIndex, startIndex + pageSize);

  const startItem = totalItems === 0 ? 0 : startIndex + 1;
  const endItem = Math.min(startIndex + pageSize, totalItems);
  const rangeLabel =
    totalItems === 0 ? 'No results' : `${startItem}–${endItem} of ${totalItems}`;

  return {
    currentPage: safePage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    paginatedItems,
    rangeLabel,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
    onPrev: () => setCurrentPage(p => Math.max(1, p - 1)),
    onNext: () => setCurrentPage(p => Math.min(totalPages, p + 1)),
  };
}
