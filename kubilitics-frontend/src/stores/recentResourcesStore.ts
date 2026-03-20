import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RecentResource {
  /** Kubernetes resource kind, e.g. "Pod", "Deployment" */
  resourceKind: string;
  /** Resource name */
  name: string;
  /** Namespace (empty string for cluster-scoped resources) */
  namespace: string;
  /** Route path to the detail page, e.g. "/pods/default/nginx" */
  path: string;
  /** Unix epoch ms when the resource was last viewed */
  timestamp: number;
}

interface RecentResourcesState {
  /** Most-recently-viewed resources (newest first, max 10) */
  recentResources: RecentResource[];
  /** Add or promote a resource to the top of the recents list */
  addRecentResource: (resource: Omit<RecentResource, 'timestamp'>) => void;
  /** Clear all recent resources */
  clearRecent: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_RECENT = 10;
const STORAGE_KEY = 'kubilitics-recent-resources';

// ─── Store ───────────────────────────────────────────────────────────────────

export const useRecentResourcesStore = create<RecentResourcesState>()(
  persist(
    (set) => ({
      recentResources: [],

      addRecentResource: (resource) =>
        set((state) => {
          // De-duplicate by path: remove existing entry with same path
          const filtered = state.recentResources.filter(
            (r) => r.path !== resource.path,
          );
          const entry: RecentResource = {
            ...resource,
            timestamp: Date.now(),
          };
          return {
            recentResources: [entry, ...filtered].slice(0, MAX_RECENT),
          };
        }),

      clearRecent: () => set({ recentResources: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        recentResources: state.recentResources,
      }),
    },
  ),
);
