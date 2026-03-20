import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const BASE_TITLE = 'Kubilitics';

/**
 * Sets the document title based on the current route path.
 * Falls back to a humanized version of the pathname.
 *
 * Usage:
 *   useDocumentTitle()           // auto-detects from route
 *   useDocumentTitle('Pods')     // explicit override
 */
export function useDocumentTitle(title?: string) {
  const location = useLocation();

  useEffect(() => {
    if (title) {
      document.title = `${title} · ${BASE_TITLE}`;
      return;
    }

    // Derive from pathname
    const path = location.pathname;
    if (path === '/' || path === '/dashboard') {
      document.title = BASE_TITLE;
      return;
    }

    // Take the last meaningful segment and humanize it
    const segments = path.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';

    // Skip UUIDs and detail IDs
    const isDetailId = segments.length > 1 && /^[a-f0-9-]{8,}$/i.test(last);
    const segment = isDetailId ? segments[segments.length - 2] || '' : last;

    const humanized = segment
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    document.title = humanized ? `${humanized} · ${BASE_TITLE}` : BASE_TITLE;
  }, [location.pathname, title]);
}
