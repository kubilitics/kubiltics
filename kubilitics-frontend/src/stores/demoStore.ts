/**
 * Demo mode store.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7 — whether
 * the UI is running in demo mode is an app-level flag unrelated to cluster
 * identity. This store is now the SOLE source of truth for demo mode;
 * clusterStore has been dismantled.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

interface DemoState {
  isDemo: boolean;
  setDemo: (isDemo: boolean) => void;
  reset: () => void;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      isDemo: false,
      setDemo: (isDemo) => set({ isDemo }),
      reset: () => set({ isDemo: false }),
    }),
    {
      name: 'kubilitics.demo.enabled',
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);
