import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ADDON_KEYS } from "./useAddOnCatalog";
import { useAddOnStore } from "../stores/addonStore";

/**
 * useAddonHealthReconciler — Reconciliation loop for addon install state.
 *
 * Problem: The frontend tracks install state via WebSocket + Zustand store.
 * If the WebSocket disconnects, the browser tab is backgrounded, or the app
 * is refreshed, the store state can become stale. The user may have an addon
 * in INSTALLING state in the store, but on the cluster it's already INSTALLED
 * (or FAILED). The Installed tab may show stale data until the next poll.
 *
 * Solution: This hook runs a lightweight reconciliation check every 10 seconds
 * while any addon is in a transitional state. It compares the Zustand store's
 * `isInstalling` flag with the React Query cache. If the store thinks we're
 * installing but the query cache shows no transitional addons, it forces a
 * cache refresh and clears the stale store state.
 *
 * This is a passive safety net — it doesn't replace the primary WS flow or
 * the adaptive polling in useInstalledAddons. It catches edge cases where
 * those mechanisms fail silently.
 */
const RECONCILE_INTERVAL_MS = 10_000; // 10 seconds

const TRANSITIONAL = new Set([
  'INSTALLING', 'UPGRADING', 'ROLLING_BACK', 'UNINSTALLING',
]);

export function useAddonHealthReconciler(clusterId: string) {
  const queryClient = useQueryClient();
  const { isInstalling, setIsInstalling, setWsReconnectStatus, setInstallError } = useAddOnStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Only run reconciliation when we think an install is active
    if (!isInstalling || !clusterId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const reconcile = () => {
      // Check React Query cache for current installed addons data
      const cachedData = queryClient.getQueryData<unknown[]>(ADDON_KEYS.installed(clusterId));
      if (!cachedData) return; // No cache yet — wait for first fetch

      const hasTransitional = cachedData.some(
        (addon: unknown) => {
          const addonObj = addon as Record<string, unknown>;
          return TRANSITIONAL.has(addonObj.status as string);
        }
      );

      // If the cache shows no transitional addons but the store thinks we're
      // still installing, the install likely completed while we weren't watching.
      // Force a fresh fetch and clear the stale store state.
      if (!hasTransitional) {
        queryClient.invalidateQueries({ queryKey: ADDON_KEYS.installed(clusterId) });
        setIsInstalling(false);
        setWsReconnectStatus(null);
        setInstallError(null);
      }
    };

    intervalRef.current = setInterval(reconcile, RECONCILE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isInstalling, clusterId, queryClient, setIsInstalling, setWsReconnectStatus, setInstallError]);
}
