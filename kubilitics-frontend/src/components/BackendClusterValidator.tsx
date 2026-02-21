/**
 * BackendClusterValidator
 *
 * Performance optimization: Non-blocking validation that runs in background.
 * Validates and clears stale cluster IDs when backend becomes ready.
 * This prevents 503/404 errors from using stale cluster IDs that no longer exist.
 *
 * Runs globally in App.tsx to catch stale IDs regardless of which page the user is on.
 * Actually tests cluster accessibility before restoring cluster ID.
 * 
 * Changes: Runs validation in background, doesn't block UI rendering.
 */
import { useEffect, useRef } from 'react';
import { isTauri, invokeWithRetry } from '@/lib/tauri';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';
import { getClusterOverview, reconnectCluster, BackendApiError } from '@/services/backendApiClient';

export function BackendClusterValidator() {
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const isBackendConfiguredFn = useBackendConfigStore((s) => s.isBackendConfigured);
  const validatedRef = useRef(false);
  const originalClusterIdRef = useRef<string | null>(null);
  
  // Fetch clusters - enabled when backend is configured
  const clustersQuery = useClustersFromBackend({
    gateOnHealth: false,
  });

  useEffect(() => {
    // Extend validation to browser mode as well (not just Tauri)
    if (!isBackendConfiguredFn()) return;
    if (validatedRef.current) return;
    
    // Check logout flag to prevent validation after logout
    const logoutFlag = useBackendConfigStore.getState().logoutFlag;
    if (logoutFlag) {
      // User logged out - don't validate/restore
      return;
    }
    
    // Store original cluster ID on first run ONLY if we haven't stored it yet
    if (originalClusterIdRef.current === null && currentClusterId) {
      originalClusterIdRef.current = currentClusterId;
    }
    
    // Single validation function that tests cluster accessibility
    const checkAndValidate = async () => {
      try {
        // In Tauri, check backend status via invoke; in browser, assume ready if health check passes
        let backendReady = false;
        if (isTauri()) {
          try {
            const status = await invokeWithRetry<{ status: string }>('get_backend_status');
            backendReady = status.status === 'ready';
          } catch {
            backendReady = false;
          }
        } else {
          // Browser mode: assume ready if backend is configured (health check happens elsewhere)
          backendReady = isBackendConfiguredFn();
        }
        
        if (!backendReady) {
          // Backend not ready yet - don't clear, just wait
          return;
        }

        // Backend is ready - wait for clusters data to be available
        if (!clustersQuery.data) {
          // Clusters not loaded yet, wait a bit and retry
          return;
        }

        // Validate original cluster ID against backend cluster list AND test accessibility
        const originalCid = originalClusterIdRef.current?.trim();
        if (!originalCid) {
          // No original cluster ID to validate
          validatedRef.current = true;
          return;
        }

        const clusterExists = clustersQuery.data.some((c) => c.id === originalCid);
        if (!clusterExists) {
          // Cluster doesn't exist in backend list - clear it silently
          setCurrentClusterId(null);
          validatedRef.current = true;
          return;
        }

        // Cluster exists in list - now test if it's actually accessible
        // Only validate if backend is ready (not starting up)
        try {
          const backendBaseUrl = getEffectiveBackendBaseUrl(useBackendConfigStore.getState().backendBaseUrl);
          try {
            await getClusterOverview(backendBaseUrl, originalCid);
          } catch (overviewError) {
            // If the cluster has a circuit-breaker error (503), auto-reconnect before giving up.
            // This handles the case where the backend was restarted or the circuit was tripped.
            const is503 = overviewError instanceof BackendApiError && overviewError.status === 503;
            if (is503) {
              try {
                await reconnectCluster(backendBaseUrl, originalCid);
                // Reconnect succeeded — cluster is healthy now
              } catch {
                // Reconnect also failed — clear the cluster ID so the user sees the connect page
                setCurrentClusterId(null);
                validatedRef.current = true;
                return;
              }
            } else {
              // Non-503 error (network, 404, etc.) — clear the cluster ID
              setCurrentClusterId(null);
              validatedRef.current = true;
              return;
            }
          }
          // Cluster is accessible - ensure it's set (may have been cleared earlier)
          if (currentClusterId !== originalCid) {
            setCurrentClusterId(originalCid);
          }
        } catch (error) {
          // Cluster exists but is not accessible - clear it silently
          // Don't log errors - they're expected during startup or transient failures
          setCurrentClusterId(null);
        }
        
        validatedRef.current = true;
      } catch (error) {
        // Silently ignore validation errors - they're expected during startup
        // Don't log to avoid console noise
      }
    };

    // Retry with exponential backoff — one-shot validation, not a continuous poll.
    // Starts at 500 ms, doubles each time (500 → 1000 → 2000 → 4000 → 8000 ms cap).
    // Stops as soon as validatedRef.current is true.
    let retryDelay = 500;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (validatedRef.current) return;
      retryTimer = setTimeout(async () => {
        if (!validatedRef.current) {
          await checkAndValidate();
          if (!validatedRef.current) {
            retryDelay = Math.min(retryDelay * 2, 8_000);
            scheduleRetry();
          }
        }
      }, retryDelay);
    };

    // Also listen for ready event (Tauri only)
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      const setupListener = async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');
          unlisten = await listen<{ status: string }>('backend-status', async (event) => {
            if (event.payload.status === 'ready' && !validatedRef.current) {
              setTimeout(() => checkAndValidate(), 500);
            }
          });
        } catch (error) {
          console.warn('[BackendClusterValidator] Failed to set up event listener:', error);
        }
      };
      setupListener();
    }

    // Run immediately, then retry with backoff if not yet validated
    checkAndValidate().then(() => { if (!validatedRef.current) scheduleRetry(); });

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      unlisten?.();
    };
  }, [
    isBackendConfiguredFn,
    currentClusterId,
    setCurrentClusterId,
    clustersQuery.data,
  ]);

  return null;
}
