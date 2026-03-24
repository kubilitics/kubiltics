import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Per-cluster appearance settings (Week 7) ───

export interface ClusterAppearance {
  color: string;        // hex color e.g. '#ef4444'
  environment: string;  // 'production' | 'staging' | 'development' | 'testing' | custom
  alias: string;        // short display name
}

const DEFAULT_APPEARANCE: ClusterAppearance = {
  color: '#3b82f6',       // blue
  environment: '',
  alias: '',
};

const APPEARANCE_STORAGE_KEY = 'kubilitics-cluster-appearance';

function loadAppearanceMap(): Record<string, ClusterAppearance> {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAppearanceMap(map: Record<string, ClusterAppearance>) {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(map));
}

export function getClusterAppearance(clusterId: string | undefined): ClusterAppearance {
  if (!clusterId) return DEFAULT_APPEARANCE;
  const map = loadAppearanceMap();
  return map[clusterId] ?? DEFAULT_APPEARANCE;
}

export function setClusterAppearance(clusterId: string, appearance: Partial<ClusterAppearance>): void {
  const map = loadAppearanceMap();
  map[clusterId] = { ...(map[clusterId] ?? DEFAULT_APPEARANCE), ...appearance };
  saveAppearanceMap(map);
}

/** Environment badge label mapping */
export function getEnvBadgeLabel(env: string): string | null {
  switch (env) {
    case 'production': return 'PROD';
    case 'staging': return 'STG';
    case 'development': return 'DEV';
    case 'testing': return 'TEST';
    default: return env ? env.toUpperCase().slice(0, 4) : null;
  }
}

/** Environment badge color classes */
export function getEnvBadgeClasses(env: string): string {
  switch (env) {
    case 'production': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800';
    case 'staging': return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800';
    case 'development': return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-800';
    case 'testing': return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:border-sky-800';
    default: return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

export interface Cluster {
  id: string;
  name: string;
  context: string;
  version: string;
  status: 'healthy' | 'warning' | 'error';
  region: string;
  provider: 'eks' | 'gke' | 'aks' | 'minikube' | 'kind' | 'on-prem' | 'openshift' | 'rancher' | 'k3s' | 'docker-desktop';
  nodes: number;
  namespaces: number;
  isCurrent?: boolean;
  pods: { running: number; pending: number; failed: number };
  cpu: { used: number; total: number };
  memory: { used: number; total: number };
  kubeconfig?: string; // Kubeconfig content for this cluster (desktop mode)
  /** P0-A: When true, cluster is demo mock — never use for API calls; backend has no such ID. */
  __isDemo?: boolean;
}

export interface Namespace {
  name: string;
  status: 'Active' | 'Terminating';
  pods: number;
  services: number;
}

export interface KubeconfigContext {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
}

interface ClusterState {
  clusters: Cluster[];
  activeCluster: Cluster | null;
  activeNamespace: string;
  namespaces: Namespace[];
  isDemo: boolean;
  appMode: 'desktop' | 'in-cluster' | null;
  isOnboarded: boolean;
  kubeconfigPath?: string; // Path to kubeconfig file (desktop mode)
  kubeconfigContent?: string; // Full kubeconfig content (desktop mode)
  detectedClusters?: KubeconfigContext[]; // Auto-detected clusters from kubeconfig
  setClusters: (clusters: Cluster[]) => void;
  setActiveCluster: (cluster: Cluster) => void;
  setActiveNamespace: (namespace: string) => void;
  setNamespaces: (namespaces: Namespace[]) => void;
  setDemo: (isDemo: boolean) => void;
  setAppMode: (mode: 'desktop' | 'in-cluster' | null) => void;
  setOnboarded: (onboarded: boolean) => void;
  setKubeconfigContent: (content: string, path?: string) => void;
  setDetectedClusters: (clusters: KubeconfigContext[]) => void;
  autoDetectClusters: () => Promise<void>; // Auto-detect clusters from kubeconfig (Tauri only)
  signOut: () => void;
}

// Demo mock data — IDs are unambiguously synthetic (prefixed __demo__) so they can
// never be confused with real cluster UUIDs persisted from the backend. See P0-A.
const demoClusters: Cluster[] = [
  {
    id: '__demo__cluster-alpha',
    name: 'Demo: Production (EKS)',
    context: '__demo__prod-context',
    version: 'v1.28.4',
    status: 'healthy',
    region: 'us-east-1',
    provider: 'eks',
    nodes: 12,
    namespaces: 24,
    pods: { running: 156, pending: 3, failed: 1 },
    cpu: { used: 68, total: 100 },
    memory: { used: 72, total: 100 },
    __isDemo: true,
  },
  {
    id: '__demo__cluster-beta',
    name: 'Demo: Staging (EKS)',
    context: '__demo__staging-context',
    version: 'v1.28.2',
    status: 'warning',
    region: 'eu-west-1',
    provider: 'eks',
    nodes: 6,
    namespaces: 12,
    pods: { running: 78, pending: 5, failed: 2 },
    cpu: { used: 45, total: 100 },
    memory: { used: 52, total: 100 },
    __isDemo: true,
  },
  {
    id: '__demo__cluster-gamma',
    name: 'Demo: Local Dev (Minikube)',
    context: '__demo__local-context',
    version: 'v1.29.0',
    status: 'healthy',
    region: 'local',
    provider: 'minikube',
    nodes: 1,
    namespaces: 8,
    pods: { running: 24, pending: 0, failed: 0 },
    cpu: { used: 32, total: 100 },
    memory: { used: 41, total: 100 },
    __isDemo: true,
  },
];

const demoNamespaces: Namespace[] = [
  { name: 'default', status: 'Active', pods: 12, services: 4 },
  { name: 'kube-system', status: 'Active', pods: 28, services: 8 },
  { name: 'production', status: 'Active', pods: 45, services: 12 },
  { name: 'staging', status: 'Active', pods: 23, services: 6 },
  { name: 'monitoring', status: 'Active', pods: 15, services: 3 },
  { name: 'logging', status: 'Active', pods: 8, services: 2 },
  { name: 'ingress-nginx', status: 'Active', pods: 4, services: 1 },
  { name: 'cert-manager', status: 'Active', pods: 3, services: 1 },
];

export const useClusterStore = create<ClusterState>()(
  persist(
    (set, get) => ({
      clusters: [],
      activeCluster: null,
      activeNamespace: 'all',
      namespaces: [],
      isDemo: false,
      appMode: null,
      isOnboarded: false,
      kubeconfigPath: undefined,
      kubeconfigContent: undefined,
      detectedClusters: undefined,
      setClusters: (clusters) => set({ clusters }),
      setActiveCluster: (cluster) => set({ activeCluster: cluster }),
      setActiveNamespace: (namespace) => set({ activeNamespace: namespace }),
      setNamespaces: (namespaces) => set({ namespaces }),
      setAppMode: (appMode) => set({ appMode }),
      setOnboarded: (isOnboarded) => set({ isOnboarded }),
      setKubeconfigContent: (content, path) => set({ kubeconfigContent: content, kubeconfigPath: path }),
      setDetectedClusters: (clusters) => set({ detectedClusters: clusters }),
      autoDetectClusters: async () => {
        // Only works in Tauri desktop mode
        if (typeof window === 'undefined') return;
        const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
        const isTauri = !!(w.__TAURI_INTERNALS__ ?? w.__TAURI__);

        if (!isTauri) return;

        try {
          const { invoke } = await import('@tauri-apps/api/core');

          // Get kubeconfig info (path defaults to ~/.kube/config)
          const kubeconfigInfo = await invoke<{
            path: string;
            current_context?: string;
            contexts: Array<{ name: string; cluster: string; user: string; namespace?: string }>;
          }>('get_kubeconfig_info', { path: null });

          if (kubeconfigInfo.contexts.length > 0) {
            set({
              detectedClusters: kubeconfigInfo.contexts,
              kubeconfigPath: kubeconfigInfo.path,
            });
          }
        } catch (error) {
          console.error('Failed to auto-detect kubeconfig:', error);
        }
      },
      setDemo: (isDemo) => {
        if (isDemo) {
          set({
            isDemo,
            clusters: demoClusters,
            activeCluster: demoClusters[0],
            namespaces: demoNamespaces,
          });
        } else {
          set({ isDemo: false });
        }
      },
      signOut: () =>
        set({
          clusters: [],
          activeCluster: null,
          activeNamespace: 'all',
          namespaces: [],
          isDemo: false,
          appMode: null,
          isOnboarded: false,
          kubeconfigPath: undefined,
          kubeconfigContent: undefined,
          detectedClusters: undefined,
        }),
    }),
    {
      name: 'kubilitics-cluster',
      // P0-A: Only persist stable user preferences. Never persist cluster state or credentials.
      // Excluded: activeCluster, clusters, isDemo, namespaces, kubeconfigPath, detectedClusters, kubeconfigContent.
      // - activeCluster/clusters/isDemo: re-derived from live backend on every launch
      // - kubeconfigPath/detectedClusters: re-detect on launch (e.g. get_kubeconfig_info)
      // - kubeconfigContent: credentials must not sit in localStorage (BA-7)
      partialize: (state) => ({
        appMode: state.appMode,
        activeNamespace: state.activeNamespace,
        isOnboarded: state.isOnboarded,
      }),
    }
  )
);
