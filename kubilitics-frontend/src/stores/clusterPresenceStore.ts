// The single source of truth for cluster presence in the frontend.
// Supersedes the former clusterStore + backendConfigStore cluster fields +
// onboardingStore (all deleted in Phase 7).
//
// Never persists session UUIDs. Only logical identity persists.
import { create } from 'zustand';
import type {
  ConnectedCluster,
  DiscoveredCluster,
  LogicalIdentity,
  PresenceSnapshot,
  RegisteredCluster,
} from '@/types/resilient';
import { logicalIdentityEqual, logicalIdentityKey } from '@/types/resilient';

const STORAGE_KEY = 'kubilitics.presence.lastActive';

function loadPersisted(): LogicalIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed ? normalizeIdentity(parsed) : null;
  } catch {
    return null;
  }
}

// normalizeIdentity translates the backend wire shape ({name, server_url})
// into the frontend camelCase shape ({name, serverUrl}). Tolerates either
// input case-shape so already-camelCase data round-trips unchanged.
function normalizeIdentity(id: Record<string, unknown> | LogicalIdentity): LogicalIdentity {
  const raw = id as { name?: string; serverUrl?: string; server_url?: string };
  return {
    name: raw?.name ?? '',
    serverUrl: raw?.serverUrl ?? raw?.server_url ?? '',
  };
}

// normalizeClusterShape walks a cluster-like object and normalizes the
// inner identity. Non-identity fields pass through untouched so top-
// level snake_case fields (context_name, last_seen_at, session_id,
// registered_at, connected_at, etc.) stay as the rest of the frontend
// already reads them.
function normalizeClusterShape<T extends { identity: LogicalIdentity | Record<string, unknown> }>(c: T): T {
  if (!c) return c;
  return { ...c, identity: normalizeIdentity(c.identity as Record<string, unknown>) } as T;
}

interface ClusterPresenceState {
  discovered: DiscoveredCluster[];
  registered: RegisteredCluster[];
  connected: ConnectedCluster[];
  activeLogicalIdentity: LogicalIdentity | null;
  isReady: boolean;

  applySnapshot(snap: PresenceSnapshot): void;
  setActiveByLogicalIdentity(id: LogicalIdentity): void;
  activeCluster(): ConnectedCluster | null;
  availableClusters(): DiscoveredCluster[];
}

export const useClusterPresenceStore = create<ClusterPresenceState>((set, get) => ({
  discovered: [],
  registered: [],
  connected: [],
  activeLogicalIdentity: loadPersisted(),
  isReady: false,

  applySnapshot(snap) {
    // Normalize wire-shape: the Go backend serializes LogicalIdentity as
    // {name, server_url} (snake_case per json tags). The frontend TS
    // interface declares {name, serverUrl} (camelCase). When the raw
    // JSON is handed to the store unchanged, every read of
    // identity.serverUrl returns undefined — crashing normalizeUrl in
    // type helpers, blanking cluster cards, and in the worst case
    // tripping the GlobalErrorBoundary. Translate once here so every
    // downstream consumer gets the camelCase shape it expects.
    const normalized = {
      discovered: (snap.discovered ?? []).map(normalizeClusterShape) as DiscoveredCluster[],
      registered: (snap.registered ?? []).map(normalizeClusterShape) as RegisteredCluster[],
      connected: (snap.connected ?? []).map(normalizeClusterShape) as ConnectedCluster[],
      last_used: snap.last_used ? normalizeIdentity(snap.last_used) : null,
    };
    set((state) => ({
      discovered: normalized.discovered,
      registered: normalized.registered,
      connected: normalized.connected,
      isReady: true,
      // Prefer backend's last_used only if no local preference exists.
      activeLogicalIdentity:
        state.activeLogicalIdentity ?? normalized.last_used ?? null,
    }));
  },

  setActiveByLogicalIdentity(id) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    } catch {
      // ignore quota/privacy failures
    }
    set({ activeLogicalIdentity: id });
  },

  activeCluster() {
    const { connected, activeLogicalIdentity } = get();
    if (!activeLogicalIdentity) return null;
    return connected.find((c) => logicalIdentityEqual(c.identity, activeLogicalIdentity)) ?? null;
  },

  availableClusters() {
    const { discovered, registered } = get();
    const mergedMap = new Map<string, DiscoveredCluster>();
    for (const c of discovered) mergedMap.set(logicalIdentityKey(c.identity), c);
    for (const c of registered) mergedMap.set(logicalIdentityKey(c.identity), c);
    return Array.from(mergedMap.values());
  },
}));

// Test-only reset.
export function __resetForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  useClusterPresenceStore.setState({
    discovered: [],
    registered: [],
    connected: [],
    activeLogicalIdentity: null,
    isReady: false,
  });
}

/**
 * Legacy-shaped view of the active cluster — a read-only object that mirrors
 * the fields the pre-Phase-7 `clusterStore.activeCluster` used to expose.
 *
 * This exists as a migration shim so the ~100+ component/page files that read
 * `activeCluster?.id`, `.name`, `.provider`, `.serverUrl` do not each need a
 * bespoke rewrite — they can swap `useClusterStore((s) => s.activeCluster)`
 * for `useActiveCluster()` with zero behavioral change. The object is derived
 * from the canonical presence/registry tuples, so there is no duplicate state.
 *
 * Fields map as follows:
 *   id        ← connected.session_id | registered.session_id | discovered.session_id | ''
 *   name      ← identity.name
 *   serverUrl ← identity.serverUrl (camelCase — legacy tests consume it this way)
 *   provider  ← discovered.provider (carried through registered/connected)
 *
 * When `session_id` is empty (the logical identity is known but no backend
 * registration exists yet) callers must treat that as "not ready for
 * session-scoped API calls" — same guarantee useActiveClusterId() offers.
 */
export interface ActiveClusterView {
  /** Backend-issued UUID for session-scoped API calls. Empty when unregistered. */
  id: string;
  /** Kubeconfig context / logical name. */
  name: string;
  /** Kubernetes API server URL (normalized). */
  serverUrl: string;
  /** Cloud/local provider classification (eks | gke | aks | minikube | ...). */
  provider: string;
}

function viewForIdentity(
  state: ClusterPresenceState,
  id: LogicalIdentity,
): ActiveClusterView | null {
  const eq = (i: LogicalIdentity) => logicalIdentityEqual(i, id);
  const connected = state.connected.find((c) => eq(c.identity));
  if (connected) {
    return {
      id: connected.session_id ?? '',
      name: connected.identity.name,
      serverUrl: connected.identity.serverUrl,
      provider: connected.provider ?? '',
    };
  }
  const registered = state.registered.find((c) => eq(c.identity));
  if (registered) {
    return {
      id: registered.session_id ?? '',
      name: registered.identity.name,
      serverUrl: registered.identity.serverUrl,
      provider: registered.provider ?? '',
    };
  }
  const discovered = state.discovered.find((c) => eq(c.identity));
  if (discovered) {
    return {
      id: discovered.session_id ?? '',
      name: discovered.identity.name,
      serverUrl: discovered.identity.serverUrl,
      provider: discovered.provider ?? '',
    };
  }
  // Identity known but not yet propagated via SSE — still give callers the
  // logical tuple so URL/name-based UI (headers, breadcrumbs) renders.
  return {
    id: '',
    name: id.name,
    serverUrl: id.serverUrl,
    provider: '',
  };
}

/**
 * React hook returning the legacy-shaped active cluster view, or `null` when
 * no cluster is selected. Re-renders on snapshot changes.
 *
 * Subscribes to the individual scalar fields (name/serverUrl/session_id/
 * provider) instead of returning a fresh object from the selector — Zustand
 * compares selector output by reference and would otherwise trigger an
 * infinite `setState → re-render` loop on every parent render.
 */
export function useActiveCluster(): ActiveClusterView | null {
  const id = useClusterPresenceStore((s) => s.activeLogicalIdentity);
  const name = id?.name ?? null;
  const serverUrl = id?.serverUrl ?? null;

  const sessionId = useClusterPresenceStore((s) => {
    if (!id) return null;
    return (
      s.connected.find((c) => logicalIdentityEqual(c.identity, id))?.session_id ??
      s.registered.find((c) => logicalIdentityEqual(c.identity, id))?.session_id ??
      s.discovered.find((c) => logicalIdentityEqual(c.identity, id))?.session_id ??
      ''
    );
  });
  const provider = useClusterPresenceStore((s) => {
    if (!id) return '';
    return (
      s.connected.find((c) => logicalIdentityEqual(c.identity, id))?.provider ??
      s.registered.find((c) => logicalIdentityEqual(c.identity, id))?.provider ??
      s.discovered.find((c) => logicalIdentityEqual(c.identity, id))?.provider ??
      ''
    );
  });

  if (!id || name === null || serverUrl === null) return null;
  return { id: sessionId ?? '', name, serverUrl, provider: provider ?? '' };
}

/** Imperative equivalent — for non-React callers (subscribe hooks, utilities). */
export function getActiveCluster(): ActiveClusterView | null {
  const s = useClusterPresenceStore.getState();
  if (!s.activeLogicalIdentity) return null;
  return viewForIdentity(s, s.activeLogicalIdentity);
}

/**
 * Activate a cluster by its backend session UUID. Looks the identity up in
 * registered/connected lists and forwards to `setActiveByLogicalIdentity`.
 *
 * Use only when the caller has a backend-issued id (fleet search, dashboard
 * drill-down, chat focus). For the common "switch by kubeconfig context"
 * path prefer the logical-identity setter directly.
 *
 * Returns true when a matching identity was found and activated.
 */
export function setActiveClusterBySessionId(sessionId: string): boolean {
  const s = useClusterPresenceStore.getState();
  const hit =
    s.connected.find((c) => c.session_id === sessionId) ??
    s.registered.find((c) => c.session_id === sessionId);
  if (!hit) return false;
  s.setActiveByLogicalIdentity(hit.identity);
  return true;
}
