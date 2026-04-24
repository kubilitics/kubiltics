/**
 * App mode store.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7 — whether
 * the app is running in desktop (Tauri) or in-cluster (browser) mode is a
 * one-time boot-time flag independent of cluster state.
 *
 * `isOnboarded` is NOT ported: it is now derived from the presence store
 * (`clusterPresenceStore.activeLogicalIdentity !== null`) via the helper
 * `useIsOnboarded()` exported here. All callers should read through the
 * helper so the derivation stays centralized.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { useClusterStore } from '@/stores/clusterStore';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';

export type AppMode = 'desktop' | 'in-cluster' | null;

interface AppModeState {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
}

export const useAppModeStore = create<AppModeState>()(
  persist(
    (set) => ({
      appMode: null,
      setAppMode: (appMode) => {
        // Mirror into clusterStore so any remaining readers still see the
        // old field. Subagent 2 will flip those readers and remove the
        // mirror.
        useClusterStore.getState().setAppMode(appMode);
        set({ appMode });
      },
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
