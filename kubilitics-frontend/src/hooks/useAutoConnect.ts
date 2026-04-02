/**
 * TASK-CORE-001: Auto-Connect Desktop Mode
 *
 * Detects desktop (Tauri) mode and automatically connects to the cluster:
 *  - Single context in kubeconfig: auto-connects without user interaction
 *  - Multiple contexts: returns context list for picker UI
 *  - Non-blocking toast for connection issues
 *  - Target: Home page visible within 10 seconds of first launch
 *
 * Uses the backend discover API (GET /api/v1/clusters/discover) to scan
 * ~/.kube/config contexts, then GET /api/v1/clusters for registered clusters.
 * Auto-registers and connects when a single context is found.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isTauri } from '@/lib/tauri';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  getClusters,
  discoverClusters,
  addCluster,
  type BackendCluster,
} from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { toast } from '@/components/ui/sonner';

/** Context info surfaced to the UI for the context picker. */
export interface DiscoveredContext {
  id: string;
  name: string;
  context: string;
  server: string;
  status: 'checking' | 'healthy' | 'unhealthy' | 'unknown';
  isCurrent?: boolean;
  kubeconfigPath?: string;
}

export interface UseAutoConnectReturn {
  /** True while the hook is actively probing / connecting. */
  isAutoConnecting: boolean;
  /** Discovered contexts available for selection (populated when >1 context). */
  contexts: DiscoveredContext[];
  /** The context that was auto-selected or user-selected. */
  selectedContext: string | null;
  /** Set the selected context (for picker UI). */
  setSelectedContext: (ctx: string) => void;
  /** Connect to the selected (or given) context. */
  connect: (contextName?: string) => Promise<void>;
  /** Error message if auto-connect failed (non-blocking). */
  error: string | null;
  /** True when running in desktop (Tauri) mode. */
  isDesktopMode: boolean;
  /** True when auto-connect completed (either succeeded or fell back to picker). */
  isResolved: boolean;
}

function mapBackendStatus(s?: string): DiscoveredContext['status'] {
  if (s === 'connected') return 'healthy';
  if (s === 'disconnected') return 'unhealthy';
  return 'unknown';
}

function backendToDiscovered(b: BackendCluster): DiscoveredContext {
  return {
    id: b.id,
    name: b.name,
    context: b.context,
    server: b.server_url ?? b.server ?? '',
    status: mapBackendStatus(b.status),
    isCurrent: b.is_current,
    kubeconfigPath: b.kubeconfig_path,
  };
}

/**
 * Auto-connect timeout (ms). If the entire flow takes longer than this,
 * we abort and show the manual connect UI. Target: Home in <10s.
 */
const AUTO_CONNECT_TIMEOUT_MS = 15_000;

export function useAutoConnect(): UseAutoConnectReturn {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Stores
  const { setActiveCluster, setClusters, setDemo, setAppMode } = useClusterStore();
  const storedBackendUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);

  // State
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [contexts, setContexts] = useState<DiscoveredContext[]>([]);
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDesktopMode] = useState(() => isTauri());
  const [isResolved, setIsResolved] = useState(false);

  // Guards
  // NOTE: didRun uses a module-level flag (not useRef) to survive React StrictMode
  // double-mount in development. StrictMode unmounts→remounts, which aborts the
  // first controller, but didRun.current is already true so the second mount skips.
  // Using a ref that resets on unmount would cause the same issue.
  const didRun = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Connect to a specific context: register it if needed, then set as active.
   */
  const connect = useCallback(async (contextName?: string) => {
    const target = contextName ?? selectedContext;
    if (!target) {
      setError('No context selected');
      return;
    }

    setIsAutoConnecting(true);
    setError(null);

    try {
      const baseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);

      // Check if context is already registered
      let clusterList = await getClusters(baseUrl);
      let backendCluster = clusterList.find((c) => c.context === target);

      // If not registered, register via discover path
      if (!backendCluster) {
        const discovered = await discoverClusters(baseUrl);
        const disc = discovered.find((c) => c.context === target);
        if (disc?.kubeconfig_path) {
          const newCluster = await addCluster(baseUrl, disc.kubeconfig_path, target);
          // Refresh cluster list
          clusterList = await getClusters(baseUrl);
          backendCluster = clusterList.find((c) => c.id === newCluster.id) ?? newCluster;
        } else {
          throw new Error(`Context "${target}" not found in kubeconfig`);
        }
      }

      // Apply connection to stores
      const connectedCluster = backendClusterToCluster(backendCluster);
      const allClusters = clusterList.map(backendClusterToCluster);

      setCurrentClusterId(backendCluster.id);
      setClusters(allClusters);
      setActiveCluster(connectedCluster);
      setDemo(false);
      setAppMode('desktop');

      // Invalidate queries so fresh data loads
      queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });

      toast.success(`Connected to ${backendCluster.name}`, {
        id: 'cluster-connect-status',
        description: `Context: ${target}`,
      });

      navigate('/home', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error('Connection failed', {
        id: 'cluster-connect-status',
        description: message,
      });
    } finally {
      setIsAutoConnecting(false);
    }
  }, [
    selectedContext,
    storedBackendUrl,
    setCurrentClusterId,
    setClusters,
    setActiveCluster,
    setDemo,
    setAppMode,
    queryClient,
    navigate,
  ]);

  /**
   * Main auto-connect effect. Runs once on mount in desktop mode.
   *
   * Flow:
   * 1. Fetch registered clusters from backend
   * 2. Fetch discovered (unregistered) contexts from kubeconfig
   * 3. Merge into a single list
   * 4. If exactly 1 context total -> auto-connect
   * 5. If >1 -> set contexts for picker, pre-select current-context
   * 6. If 0 -> resolved with empty (user needs to add manually)
   */
  useEffect(() => {
    if (!isDesktopMode || didRun.current) return;
    didRun.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsAutoConnecting(true);
    setAppMode('desktop');

    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
        setIsAutoConnecting(false);
        setIsResolved(true);
        setError('Auto-connect timed out');
        toast.warning('Auto-connect timed out', {
          id: 'auto-connect-status',
          description: 'Select a context manually to continue.',
        });
      }
    }, AUTO_CONNECT_TIMEOUT_MS);

    (async () => {
      try {
        const baseUrl = getEffectiveBackendBaseUrl(storedBackendUrl);

        // ── Discover clusters — fast, no health-check gate ──
        // Like Headlamp: just try to fetch contexts. If backend isn't
        // ready yet (sidecar cold start), retry every 500ms. The discover
        // endpoint is pure YAML parsing (<50ms), so once the backend is up
        // it responds instantly.
        let allBackend: BackendCluster[] = [];
        for (let attempt = 0; attempt < 20; attempt++) {
          if (controller.signal.aborted) return;
          try {
            const [registeredRaw, discoveredRaw] = await Promise.all([
              getClusters(baseUrl),
              discoverClusters(baseUrl),
            ]);
            const registered = Array.isArray(registeredRaw) ? registeredRaw : [] as BackendCluster[];
            const discovered = Array.isArray(discoveredRaw) ? discoveredRaw : [] as BackendCluster[];
            const registeredContexts = new Set(registered.map((c) => c.context));
            const unregistered = discovered.filter((d) => !registeredContexts.has(d.context));
            allBackend = [...registered, ...unregistered];
            if (allBackend.length > 0) break;
          } catch {
            // Backend not ready — retry
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        if (controller.signal.aborted) return;

        if (allBackend.length === 0) {
          // Truly no contexts after ~15s of retries
          setIsAutoConnecting(false);
          setIsResolved(true);
          return;
        }

        const allContexts = allBackend.map(backendToDiscovered);

        // ── Phase 2: Single context → auto-connect, skip picker ──
        // Like Lens: if there's only one context, just connect. No clicks.
        if (allContexts.length === 1) {
          const ctx = allContexts[0];
          setContexts(allContexts);
          setSelectedContext(ctx.context);
          clearTimeout(timeoutId);
          // Auto-connect immediately
          try {
            await connect(ctx.context);
            // connect() navigates to /home on success
            return;
          } catch {
            // Auto-connect failed — fall through to show picker
          }
        }

        // ── Phase 3: Multiple contexts → show picker ──
        setContexts(allContexts);
        const current = allContexts.find((c) => c.isCurrent);
        setSelectedContext(current?.context ?? allContexts[0]?.context ?? null);

        clearTimeout(timeoutId);
        setIsAutoConnecting(false);
        setIsResolved(true);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsAutoConnecting(false);
        setIsResolved(true);
        toast.error('Cluster detection failed', {
          id: 'auto-connect-status',
          description: message,
          duration: 10000,
        });
      }
    })();

    return () => {
      // NOTE: Do NOT call controller.abort() here.
      // React StrictMode unmounts→remounts in dev. If we abort on unmount,
      // the async flow from the first mount (which we want to keep running
      // since didRun prevents re-execution) gets killed at the signal check.
      // The timeout self-cleans, and navigation away will unmount the whole
      // component tree anyway.
      clearTimeout(timeoutId);
    };
    // Run once on mount — dependencies are stable refs/setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktopMode]);

  return {
    isAutoConnecting,
    contexts,
    selectedContext,
    setSelectedContext,
    connect,
    error,
    isDesktopMode,
    isResolved,
  };
}
