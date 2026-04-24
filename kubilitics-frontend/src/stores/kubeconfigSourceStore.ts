/**
 * Kubeconfig source store — holds the raw kubeconfig PATH + CONTENT used to
 * connect to a cluster in desktop mode.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7. This store
 * is now the SOLE source of truth for kubeconfig path/content; clusterStore
 * has been dismantled.
 *
 * NOTE on naming: this file is deliberately `kubeconfigSourceStore.ts` (not
 * `kubeconfigStore.ts`) because `kubeConfigStore.ts` (camelCase) already
 * exists and holds a parsed YAML structure. On macOS APFS case-insensitive
 * filesystems a file named `kubeconfigStore.ts` would collide with the
 * existing file. The exported hook is still `useKubeconfigStore` as the
 * Phase-7 plan specifies.
 *
 * Persistence policy: we intentionally do NOT persist `kubeconfigContent`
 * (it contains tokens/client certs — same reason clusterStore's
 * partialize omitted it under BA-7). `kubeconfigPath` is also NOT persisted
 * to match the prior behavior — it is re-detected on launch.
 */
import { create } from 'zustand';

interface KubeconfigState {
  kubeconfigPath: string | undefined;
  kubeconfigContent: string | undefined;
  setKubeconfigPath: (path: string | undefined) => void;
  setKubeconfigContent: (content: string, path?: string) => void;
  reset: () => void;
}

export const useKubeconfigStore = create<KubeconfigState>((set) => ({
  kubeconfigPath: undefined,
  kubeconfigContent: undefined,
  setKubeconfigPath: (kubeconfigPath) => set({ kubeconfigPath }),
  setKubeconfigContent: (content, path) =>
    set({ kubeconfigContent: content, kubeconfigPath: path ?? undefined }),
  reset: () => set({ kubeconfigPath: undefined, kubeconfigContent: undefined }),
}));
