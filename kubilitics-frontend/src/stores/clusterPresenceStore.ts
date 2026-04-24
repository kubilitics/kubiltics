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
    return raw ? (JSON.parse(raw) as LogicalIdentity) : null;
  } catch {
    return null;
  }
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
    set((state) => ({
      discovered: snap.discovered,
      registered: snap.registered,
      connected: snap.connected,
      isReady: true,
      // Prefer backend's last_used only if no local preference exists.
      activeLogicalIdentity: state.activeLogicalIdentity ?? snap.last_used ?? null,
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
