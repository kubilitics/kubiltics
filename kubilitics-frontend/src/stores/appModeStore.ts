/**
 * App mode store.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7 — whether
 * the app is running in desktop (Tauri) or in-cluster (browser) mode is a
 * one-time boot-time flag independent of cluster state. This store is now
 * the SOLE source of truth for app mode; clusterStore has been dismantled.
 *
 * `isOnboarded` is NOT ported: it is now derived from the presence store
 * (`clusterPresenceStore.activeLogicalIdentity !== null`) via the helper
 * `useIsOnboarded()` exported here. All callers should read through the
 * helper so the derivation stays centralized.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';

export type AppMode = 'desktop' | 'in-cluster' | null;

interface AppModeState {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  reset: () => void;
}

export const useAppModeStore = create<AppModeState>()(
  persist(
    (set) => ({
      appMode: null,
      setAppMode: (appMode) => set({ appMode }),
      reset: () => set({ appMode: null }),
    }),
    {
      name: 'kubilitics.app.mode',
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);

/**
 * Derived selector: the user is considered "onboarded" once the presence
 * store has a logical identity for the active cluster. Replaces the former
 * `clusterStore.isOnboarded` boolean which was manually flipped after
 * connect — that flag is redundant now that presence is the single source
 * of truth for "is there a cluster to work against?".
 */
export function useIsOnboarded(): boolean {
  return useClusterPresenceStore((s) => s.activeLogicalIdentity !== null);
}
