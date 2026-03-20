import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useRecentResourcesStore } from '@/stores/recentResourcesStore';

/**
 * Tracks a resource detail page visit in the recent-resources store.
 *
 * Drop this hook into any resource detail page component:
 *
 * ```ts
 * useTrackRecentResource({ resourceKind: 'Pod', name, namespace });
 * ```
 *
 * On mount (and when the key fields change) the current route is recorded
 * so the sidebar "Recent" section stays up-to-date.
 */
export function useTrackRecentResource({
  resourceKind,
  name,
  namespace,
}: {
  /** Kubernetes kind label, e.g. "Pod", "Deployment", "Service" */
  resourceKind: string;
  /** Resource name from route params */
  name: string | undefined;
  /** Namespace from route params (pass empty string for cluster-scoped) */
  namespace?: string | undefined;
}) {
  const location = useLocation();
  const addRecentResource = useRecentResourcesStore(
    (s) => s.addRecentResource,
  );

  useEffect(() => {
    if (!name) return;
    addRecentResource({
      resourceKind,
      name,
      namespace: namespace ?? '',
      path: location.pathname,
    });
    // Only re-track when the identifying fields change, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceKind, name, namespace, location.pathname]);
}
