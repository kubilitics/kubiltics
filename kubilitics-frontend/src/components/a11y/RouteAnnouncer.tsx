import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Announces route changes to screen readers via an aria-live region.
 * Place once in the app (e.g. inside AppLayout).
 */
export function RouteAnnouncer() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    // Small delay so the page has time to render
    const timeout = setTimeout(() => {
      const heading = document.querySelector('h1, h2, [role="heading"]');
      const pageTitle = heading?.textContent?.trim();
      setAnnouncement(
        pageTitle
          ? `Navigated to ${pageTitle}`
          : `Navigated to ${document.title}`
      );
    }, 100);

    return () => clearTimeout(timeout);
  }, [location.pathname]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </div>
  );
}
