/**
 * Demo mode store.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7 — whether
 * the UI is running in demo mode is an app-level flag unrelated to cluster
 * identity. `setDemo(true)` historically also seeded demo clusters into the
 * cluster store; that behavior is preserved by proxying through to the
 * existing `useClusterStore.setDemo` for now (cleanup comes in Subagent 2
 * when clusterStore is trimmed to cluster-only state).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { useClusterStore } from '@/stores/clusterStore';

interface DemoState {
  isDemo: boolean;
  setDemo: (isDemo: boolean) => void;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemo: false,
      setDemo: (isDemo) => {
        // Preserve existing side effect: clusterStore.setDemo seeds demo
        // clusters and namespaces when isDemo flips to true, and clears
        // the flag when false. We must call through until clusterStore is
        // dismantled so no call-site behavior changes.
        useClusterStore.getState().setDemo(isDemo);
        set({ isDemo });
      },
    }),
    {
      name: 'kubilitics.demo.enabled',
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);
