/**
 * Kubeconfig source store — holds the raw kubeconfig PATH + CONTENT used to
 * connect to a cluster in desktop mode.
 *
 * Extracted from the monolithic `useClusterStore` during Phase 7.
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
 * partialize omits it under BA-7). `kubeconfigPath` is also NOT persisted
 * to match clusterStore's behavior — it is re-detected on launch.
 */
import { create } from 'zustand';
import { useClusterStore } from '@/stores/clusterStore';

interface KubeconfigState {
  kubeconfigPath: string | undefined;
  kubeconfigContent: string | undefined;
  setKubeconfigPath: (path: string | undefined) => void;
  setKubeconfigContent: (content: string, path?: string) => void;
}

export const useKubeconfigStore = create<KubeconfigState>((set) => ({
  kubeconfigPath: undefined,
  kubeconfigContent: undefined,
  setKubeconfigPath: (kubeconfigPath) => {
    // Mirror into clusterStore so existing readers (API clients reading
    // `useClusterStore.getState().kubeconfigContent` for the X-Kubeconfig
    // header) keep seeing the same data. Subagent 2 will flip those readers
    // to useKubeconfigStore directly and then this mirror goes away.
    useClusterStore.setState({ kubeconfigPath });
    set({ kubeconfigPath });
  },
  setKubeconfigContent: (content, path) => {
    // Preserve clusterStore.setKubeconfigContent semantics exactly.
    useClusterStore.getState().setKubeconfigContent(content, path);
    set({ kubeconfigContent: content, kubeconfigPath: path ?? undefined });
  },
}));
