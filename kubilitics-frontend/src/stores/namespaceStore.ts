/**
 * Namespace filter store.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7 — namespace
 * filtering has nothing to do with cluster identity or session state, so it
 * gets its own focused store. The default value `'all'` matches the original
 * clusterStore behavior. Persistence uses a new key so the existing
 * clusterStore persistence can be removed in a later cleanup without data
 * loss (users land on 'all' which is the benign default).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

interface NamespaceState {
  activeNamespace: string;
  setActiveNamespace: (ns: string) => void;
}

export const useNamespaceStore = create<NamespaceState>()(
  persist(
    (set) => ({
      activeNamespace: 'all',
      setActiveNamespace: (activeNamespace) => set({ activeNamespace }),
    }),
    {
      name: 'kubilitics.namespace.active',
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);
