/**
 * PERF Area 2: Scroll position restoration on back-navigation.
 *
 * React Router v6 unmounts pages on navigation, losing scroll position.
 * This hook saves scroll position when leaving a page and restores it
 * when returning. Combined with React Query cache (instant data) and
 * hover prefetch, this makes back-navigation feel near-instant.
 *
 * NOTE: A full keep-alive (caching mounted component trees) was considered
 * but rejected — React Router v6 outlet elements carry route context that
 * goes stale when cached across navigations, causing subtle bugs with
 * providers, portals, and stale closures. Scroll restoration + TanStack
 * Query cache achieves 90% of the benefit with zero risk.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** In-memory scroll position map. Survives re-renders but not page refresh (intentional). */
const scrollPositions = new Map<string, number>();

/** Max entries to prevent unbounded growth. */
const MAX_ENTRIES = 50;

/**
 * Saves scroll position on navigate-away, restores on navigate-back.
 * Call this inside the layout component that contains the scrollable main area.
 *
 * @param scrollRef - Ref to the scrollable container element (e.g., <main>)
 */
export function useScrollRestoration(scrollRef: React.RefObject<HTMLElement | null>) {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;
    prevPathRef.current = currentPath;

    // Save scroll position of the page we're leaving
    if (prevPath !== currentPath && scrollRef.current) {
      scrollPositions.set(prevPath, scrollRef.current.scrollTop);

      // Evict oldest entries if over limit
      if (scrollPositions.size > MAX_ENTRIES) {
        const firstKey = scrollPositions.keys().next().value;
        if (firstKey) scrollPositions.delete(firstKey);
      }
    }

    // Restore scroll position if we've been to this page before
    const savedPosition = scrollPositions.get(currentPath);
    if (savedPosition != null && scrollRef.current) {
      // Use rAF to ensure DOM has updated before scrolling
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = savedPosition;
        }
      });
    } else if (scrollRef.current) {
      // New page — scroll to top
      scrollRef.current.scrollTop = 0;
    }
  }, [location.pathname, scrollRef]);
}
