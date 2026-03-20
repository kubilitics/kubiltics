/**
 * WebSocket-based watch hook for real-time Kubernetes resource updates.
 *
 * Implements a SharedInformerFactory-inspired pattern: a single WebSocket
 * connection per resource type is shared across all subscribers. Events
 * (ADDED, MODIFIED, DELETED) are pushed to TanStack Query cache, giving
 * components instant updates without polling.
 *
 * Falls back to polling when:
 *  - WebSocket connection fails after max retries
 *  - The backend does not support the /ws/watch endpoint
 *  - The hook consumer explicitly disables WebSocket
 *
 * TASK-SCALE-003
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { useClusterStore } from '@/stores/clusterStore';
import { trackRowAnimation } from './useResourceLiveUpdates';
import type { KubernetesResource, ResourceList, ResourceType } from '@/hooks/useKubernetes';

// ── Types ──────────────────────────────────────────────────────────────────────

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';

export interface WatchEvent<T = KubernetesResource> {
  type: WatchEventType;
  object: T;
}

export type WatchConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'fallback-polling';

export interface UseKubernetesWatchOptions<T extends KubernetesResource = KubernetesResource> {
  /** Kubernetes resource type (e.g. 'pods', 'deployments') */
  resourceType: ResourceType;
  /** Namespace filter; omit for cluster-scoped or all-namespaces */
  namespace?: string;
  /** Label selector (e.g. 'app=nginx') */
  labelSelector?: string;
  /** Field selector (e.g. 'metadata.name=my-pod') */
  fieldSelector?: string;
  /** Disable the watch entirely */
  enabled?: boolean;
  /** Disable WebSocket, force polling fallback */
  disableWebSocket?: boolean;
  /** Polling interval in ms when using fallback (default 10000) */
  pollingInterval?: number;
  /** Callback fired for every watch event */
  onEvent?: (event: WatchEvent<T>) => void;
  /** Callback fired on connection state change */
  onConnectionChange?: (state: WatchConnectionState) => void;
}

export interface UseKubernetesWatchReturn {
  /** Current connection state */
  connectionState: WatchConnectionState;
  /** Number of events received since last connect */
  eventCount: number;
  /** Manually reconnect the WebSocket */
  reconnect: () => void;
  /** Timestamp of last received event */
  lastEventTime: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_RETRIES = 8;

// ── Shared Informer Registry ───────────────────────────────────────────────────
// Deduplicates WebSocket connections: one connection per (clusterId, resourceType, namespace).

interface InformerEntry {
  ws: WebSocket | null;
  subscribers: Set<(event: WatchEvent) => void>;
  retryCount: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  resourceVersion: string | null;
  state: WatchConnectionState;
}

const informerRegistry = new Map<string, InformerEntry>();

function informerKey(clusterId: string, resourceType: string, namespace?: string): string {
  return `${clusterId}::${resourceType}::${namespace ?? '*'}`;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useKubernetesWatch<T extends KubernetesResource = KubernetesResource>(
  options: UseKubernetesWatchOptions<T>,
): UseKubernetesWatchReturn {
  const {
    resourceType,
    namespace,
    labelSelector,
    fieldSelector,
    enabled = true,
    disableWebSocket = false,
    pollingInterval = 10_000,
    onEvent,
    onConnectionChange,
  } = options;

  const queryClient = useQueryClient();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const currentClusterId = useBackendConfigStore((s) => s.currentClusterId);
  const isDemo = useClusterStore((s) => s.isDemo);

  const [connectionState, setConnectionState] = useState<WatchConnectionState>('disconnected');
  const [eventCount, setEventCount] = useState(0);
  const [lastEventTime, setLastEventTime] = useState<number | null>(null);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build the TanStack Query key that corresponds to useK8sResourceList
  const queryKey: QueryKey = useMemo(
    () => ['backend', 'resources', currentClusterId, 'no-project', resourceType, namespace, '', '', '', '', ''],
    [currentClusterId, resourceType, namespace],
  );

  // ── Cache Updater ──────────────────────────────────────────────────────────

  const applyCacheUpdate = useCallback(
    (event: WatchEvent<T>) => {
      // PERF Area 6: Track animation for the affected row
      const uid = event.object?.metadata?.uid;
      if (uid && (event.type === 'ADDED' || event.type === 'MODIFIED' || event.type === 'DELETED')) {
        trackRowAnimation(uid, event.type === 'ADDED' ? 'added' : event.type === 'DELETED' ? 'deleted' : 'modified');
      }

      queryClient.setQueryData<ResourceList<T>>(queryKey, (prev) => {
        if (!prev) return prev;
        const items = [...prev.items];
        const idx = items.findIndex(
          (item) =>
            item.metadata.uid === event.object.metadata.uid ||
            (item.metadata.name === event.object.metadata.name &&
              item.metadata.namespace === event.object.metadata.namespace),
        );

        switch (event.type) {
          case 'ADDED':
            if (idx === -1) items.push(event.object);
            else items[idx] = event.object; // treat as upsert
            break;
          case 'MODIFIED':
            if (idx !== -1) items[idx] = event.object;
            else items.push(event.object);
            break;
          case 'DELETED':
            if (idx !== -1) items.splice(idx, 1);
            break;
          case 'BOOKMARK':
            // Bookmarks only carry resourceVersion; no data change
            break;
          case 'ERROR':
            // Watch errors may require a re-list
            queryClient.invalidateQueries({ queryKey });
            break;
        }
        return { ...prev, items };
      });
    },
    [queryClient, queryKey],
  );

  // ── WebSocket Connection ───────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    if (!isBackendConfigured() || !currentClusterId || !backendBaseUrl || isDemo || disableWebSocket) {
      return;
    }

    const key = informerKey(currentClusterId, resourceType, namespace);
    let entry = informerRegistry.get(key);

    // Re-use existing connection if healthy
    if (entry?.ws?.readyState === WebSocket.OPEN) {
      setConnectionState('connected');
      return;
    }

    if (!entry) {
      entry = {
        ws: null,
        subscribers: new Set(),
        retryCount: 0,
        reconnectTimer: null,
        resourceVersion: null,
        state: 'connecting',
      };
      informerRegistry.set(key, entry);
    }

    // Build URL
    const protocol = backendBaseUrl.startsWith('https') ? 'wss' : 'ws';
    const host = backendBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const url = new URL(`/ws/watch/${resourceType}`, `${protocol}://${host}`);
    url.searchParams.set('cluster_id', currentClusterId);
    if (namespace) url.searchParams.set('namespace', namespace);
    if (labelSelector) url.searchParams.set('labelSelector', labelSelector);
    if (fieldSelector) url.searchParams.set('fieldSelector', fieldSelector);
    if (entry.resourceVersion) url.searchParams.set('resourceVersion', entry.resourceVersion);

    const updateState = (state: WatchConnectionState) => {
      entry!.state = state;
      setConnectionState(state);
      onConnectionChangeRef.current?.(state);
    };

    updateState('connecting');

    const ws = new WebSocket(url.toString());
    entry.ws = ws;

    ws.onopen = () => {
      entry!.retryCount = 0;
      updateState('connected');
      // Stop polling fallback if it was running
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };

    ws.onmessage = (msgEvent) => {
      try {
        const watchEvent = JSON.parse(msgEvent.data) as WatchEvent<T>;

        // Track resourceVersion for resumption
        if (watchEvent.object?.metadata?.resourceVersion) {
          entry!.resourceVersion = watchEvent.object.metadata.resourceVersion;
        }

        setEventCount((c) => c + 1);
        setLastEventTime(Date.now());

        // Apply to cache
        applyCacheUpdate(watchEvent);

        // Notify subscribers
        onEventRef.current?.(watchEvent);
        entry!.subscribers.forEach((cb) => cb(watchEvent as WatchEvent));
      } catch (err) {
        console.warn('[useKubernetesWatch] Failed to parse watch event:', err);
      }
    };

    ws.onclose = (closeEvent) => {
      if (entry!.retryCount >= MAX_RETRIES) {
        updateState('fallback-polling');
        startPollingFallback();
        return;
      }

      // 1000 = normal close, 1001 = going away
      if (closeEvent.code === 1000 || closeEvent.code === 1001) {
        updateState('disconnected');
        return;
      }

      updateState('reconnecting');
      const delay = Math.min(
        INITIAL_RECONNECT_MS * Math.pow(BACKOFF_MULTIPLIER, entry!.retryCount),
        MAX_RECONNECT_MS,
      );
      entry!.retryCount++;
      entry!.reconnectTimer = setTimeout(() => connectWs(), delay);
    };

    ws.onerror = () => {
      // onclose will fire after onerror; handling is done there
    };
  }, [
    backendBaseUrl,
    currentClusterId,
    isBackendConfigured,
    isDemo,
    resourceType,
    namespace,
    labelSelector,
    fieldSelector,
    disableWebSocket,
    applyCacheUpdate,
  ]);

  // ── Polling Fallback ───────────────────────────────────────────────────────

  const startPollingFallback = useCallback(() => {
    if (pollingTimerRef.current) return;
    pollingTimerRef.current = setInterval(() => {
      queryClient.invalidateQueries({ queryKey });
    }, pollingInterval);
  }, [queryClient, queryKey, pollingInterval]);

  // ── Reconnect ──────────────────────────────────────────────────────────────

  const reconnect = useCallback(() => {
    if (!currentClusterId) return;
    const key = informerKey(currentClusterId, resourceType, namespace);
    const entry = informerRegistry.get(key);
    if (entry) {
      if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
      entry.retryCount = 0;
      entry.ws?.close();
    }
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    connectWs();
  }, [currentClusterId, resourceType, namespace, connectWs]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || isDemo) {
      setConnectionState('disconnected');
      return;
    }

    if (disableWebSocket) {
      setConnectionState('fallback-polling');
      startPollingFallback();
      return () => {
        if (pollingTimerRef.current) {
          clearInterval(pollingTimerRef.current);
          pollingTimerRef.current = null;
        }
      };
    }

    connectWs();

    return () => {
      // Cleanup: close WS if this is the last subscriber
      if (!currentClusterId) return;
      const key = informerKey(currentClusterId, resourceType, namespace);
      const entry = informerRegistry.get(key);
      if (entry) {
        if (entry.subscribers.size === 0) {
          entry.ws?.close();
          if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
          informerRegistry.delete(key);
        }
      }
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [enabled, isDemo, disableWebSocket, connectWs, currentClusterId, resourceType, namespace, startPollingFallback]);

  return {
    connectionState,
    eventCount,
    reconnect,
    lastEventTime,
  };
}

// ── Convenience: Pre-configured watches for common resources ───────────────────

/** Watch Pods in a namespace with real-time updates */
export function usePodWatch(namespace?: string, enabled = true) {
  return useKubernetesWatch({
    resourceType: 'pods',
    namespace,
    enabled,
  });
}

/** Watch Deployments in a namespace with real-time updates */
export function useDeploymentWatch(namespace?: string, enabled = true) {
  return useKubernetesWatch({
    resourceType: 'deployments',
    namespace,
    enabled,
  });
}

/** Watch Events in a namespace with real-time updates */
export function useEventWatch(namespace?: string, enabled = true) {
  return useKubernetesWatch({
    resourceType: 'events',
    namespace,
    enabled,
  });
}

/** Watch Nodes (cluster-scoped) with real-time updates */
export function useNodeWatch(enabled = true) {
  return useKubernetesWatch({
    resourceType: 'nodes',
    enabled,
  });
}
