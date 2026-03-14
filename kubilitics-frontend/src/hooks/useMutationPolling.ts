/**
 * useMutationPolling — Accelerates React Query polling after mutations.
 *
 * After a scale, delete, restart, or rollback, the standard 60s polling is far
 * too slow to show pod lifecycle transitions (Creating → Running, Terminating → gone).
 * This hook provides a `triggerFastPolling()` function that:
 *
 *  1. Immediately invalidates specified query keys (instant refetch)
 *  2. Switches the refetchInterval to 2s for 30s (rapid polling window)
 *  3. Automatically decays back to the normal interval
 *
 * Usage in a detail page:
 *   const { refetchInterval, triggerFastPolling } = useMutationPolling();
 *   // Pass refetchInterval to useK8sResourceList options
 *   // Call triggerFastPolling() after any mutation
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseMutationPollingOptions {
  /** Fast polling interval in ms (default: 2000 = 2s) */
  fastInterval?: number;
  /** How long to keep fast polling in ms (default: 30000 = 30s) */
  fastDuration?: number;
  /** Normal polling interval in ms (default: 60000 = 60s) */
  normalInterval?: number;
  /** Query keys to invalidate immediately on trigger */
  invalidateKeys?: unknown[][];
}

export function useMutationPolling(options: UseMutationPollingOptions = {}) {
  const {
    fastInterval = 2000,
    fastDuration = 30000,
    normalInterval = 60000,
    invalidateKeys = [],
  } = options;

  const queryClient = useQueryClient();
  const [isFastPolling, setIsFastPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerFastPolling = useCallback((extraInvalidateKeys?: unknown[][]) => {
    // 1. Immediately invalidate all specified queries → instant refetch
    const allKeys = [...invalidateKeys, ...(extraInvalidateKeys ?? [])];
    for (const key of allKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }

    // 2. Switch to fast polling
    setIsFastPolling(true);

    // 3. Clear any existing decay timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 4. Set decay timer to return to normal polling
    timerRef.current = setTimeout(() => {
      setIsFastPolling(false);
      timerRef.current = null;
    }, fastDuration);
  }, [queryClient, invalidateKeys, fastDuration]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    /** Current refetch interval — pass to useK8sResourceList options */
    refetchInterval: isFastPolling ? fastInterval : normalInterval,
    /** Whether fast polling is active */
    isFastPolling,
    /** Call after any mutation to start fast polling */
    triggerFastPolling,
  };
}
