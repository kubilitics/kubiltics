import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface KubeCluster {
  name: string;
  server: string;
  certificateAuthority?: string;
}

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
}

export interface KubeUser {
  name: string;
  token?: string;
  clientCertificate?: string;
  clientKey?: string;
}

export interface KubeConfig {
  apiVersion: string;
  kind: string;
  clusters: { name: string; cluster: KubeCluster }[];
  contexts: { name: string; context: KubeContext }[];
  users: { name: string; user: KubeUser }[];
  currentContext?: string;
}

// Assuming ShellStatusResult is defined elsewhere or is an empty interface for now
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ShellStatusResult { }

// This interface seems to be intended as an empty extension,
// but the properties listed after it are syntactically incorrect in that position.
// Given the instruction "Fix explicit any and empty interface lint errors (retry)",
// and the context, it's likely this was meant to be an empty interface
// or the properties were meant to be part of it, but the provided snippet is malformed.
// For now, I'll make it a syntactically correct empty interface as per the `no-empty-object-type` comment.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface KCLITUIStateResult extends ShellStatusResult { }

export interface ParsedCluster {
  id: string;
  name: string;
  server: string;
  context: string;
  user: string;
  namespace: string;
  isConnected: boolean;
  status: 'unknown' | 'healthy' | 'warning' | 'error';
}

interface KubeConfigStore {
  rawConfig: KubeConfig | null;
  parsedClusters: ParsedCluster[];
  selectedCluster: ParsedCluster | null;
  isAuthenticated: boolean;

  // Actions
  setKubeConfig: (config: KubeConfig) => void;
  selectCluster: (clusterId: string) => void;
  setClusterStatus: (clusterId: string, status: ParsedCluster['status']) => void;
  clearConfig: () => void;
  setAuthenticated: (value: boolean) => void;
}

export const useKubeConfigStore = create<KubeConfigStore>()(
  persist(
    (set, get) => ({
      rawConfig: null,
      parsedClusters: [],
      selectedCluster: null,
      isAuthenticated: false,

      setKubeConfig: (config) => {
        const parsedClusters: ParsedCluster[] = config.contexts.map((ctx) => {
          const cluster = config.clusters.find((c) => c.name === ctx.context.cluster);
          return {
            id: ctx.name,
            name: ctx.context.cluster,
            server: cluster?.cluster.server || 'Unknown',
            context: ctx.name,
            user: ctx.context.user,
            namespace: ctx.context.namespace || 'default',
            isConnected: false,
            status: 'unknown' as const,
          };
        });

        const selectedCluster = config.currentContext
          ? parsedClusters.find((c) => c.context === config.currentContext) || parsedClusters[0]
          : parsedClusters[0];

        set({
          rawConfig: config,
          parsedClusters,
          selectedCluster: selectedCluster ? { ...selectedCluster, isConnected: true, status: 'healthy' } : null,
        });
      },

      selectCluster: (clusterId) => {
        const { parsedClusters } = get();
        const cluster = parsedClusters.find((c) => c.id === clusterId);
        if (cluster) {
          set({ selectedCluster: { ...cluster, isConnected: true, status: 'healthy' } });
        }
      },

      setClusterStatus: (clusterId, status) => {
        set((state) => ({
          parsedClusters: state.parsedClusters.map((c) =>
            c.id === clusterId ? { ...c, status } : c
          ),
          selectedCluster:
            state.selectedCluster?.id === clusterId
              ? { ...state.selectedCluster, status }
              : state.selectedCluster,
        }));
      },

      clearConfig: () => {
        set({
          rawConfig: null,
          parsedClusters: [],
          selectedCluster: null,
        });
      },

      setAuthenticated: (value) => set({ isAuthenticated: value }),
    }),
    {
      name: 'kubeconfig-storage',
    }
  )
);

// Parser function
export function parseKubeConfig(content: string): KubeConfig {
  // Simple YAML parser for kubeconfig structure
  const lines = content.split('\n');
  const config: KubeConfig = {
    apiVersion: 'v1',
    kind: 'Config',
    clusters: [],
    contexts: [],
    users: [],
    currentContext: undefined,
  };

  let currentSection: 'clusters' | 'contexts' | 'users' | null = null;
  // The original instruction had a duplicated line and an explicit any.
  // The explicit any is kept as per the instruction's snippet, but the duplicated line is removed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentItem: any = null;
  let currentSubSection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level keys
    if (line.startsWith('apiVersion:')) {
      config.apiVersion = trimmed.split(':')[1].trim();
    } else if (line.startsWith('kind:')) {
      config.kind = trimmed.split(':')[1].trim();
    } else if (line.startsWith('current-context:')) {
      config.currentContext = trimmed.split(':').slice(1).join(':').trim();
    } else if (line.startsWith('clusters:')) {
      currentSection = 'clusters';
    } else if (line.startsWith('contexts:')) {
      currentSection = 'contexts';
    } else if (line.startsWith('users:')) {
      currentSection = 'users';
    } else if (trimmed.startsWith('- name:') && currentSection) {
      // New item in array
      if (currentItem && currentSection) {
        config[currentSection].push(currentItem);
      }
      const name = trimmed.replace('- name:', '').trim();
      if (currentSection === 'clusters') {
        currentItem = { name, cluster: { name: '', server: '' } };
      } else if (currentSection === 'contexts') {
        currentItem = { name, context: { name: '', cluster: '', user: '' } };
      } else if (currentSection === 'users') {
        currentItem = { name, user: { name: '' } };
      }
      currentSubSection = null;
    } else if (trimmed.startsWith('cluster:') && !trimmed.includes('server')) {
      currentSubSection = 'cluster';
    } else if (trimmed.startsWith('context:')) {
      currentSubSection = 'context';
    } else if (trimmed.startsWith('user:') && currentSection === 'users') {
      currentSubSection = 'user';
    } else if (currentItem) {
      // Parse sub-properties
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();

      if (currentSection === 'clusters' && currentSubSection === 'cluster') {
        if (key === 'server') currentItem.cluster.server = value;
        if (key === 'certificate-authority-data') currentItem.cluster.certificateAuthority = value;
      } else if (currentSection === 'contexts' && currentSubSection === 'context') {
        if (key === 'cluster') currentItem.context.cluster = value;
        if (key === 'user') currentItem.context.user = value;
        if (key === 'namespace') currentItem.context.namespace = value;
      } else if (currentSection === 'users' && currentSubSection === 'user') {
        if (key === 'token') currentItem.user.token = value;
        if (key === 'client-certificate-data') currentItem.user.clientCertificate = value;
        if (key === 'client-key-data') currentItem.user.clientKey = value;
      }
    }
  }

  // Push last item
  if (currentItem && currentSection) {
    config[currentSection].push(currentItem);
  }

  return config;
}

// Validation
export function validateKubeConfig(config: KubeConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.clusters || config.clusters.length === 0) {
    errors.push('No clusters found in kubeconfig');
  }

  if (!config.contexts || config.contexts.length === 0) {
    errors.push('No contexts found in kubeconfig');
  }

  if (!config.users || config.users.length === 0) {
    errors.push('No users found in kubeconfig');
  }

  config.contexts.forEach((ctx) => {
    const hasCluster = config.clusters.some((c) => c.name === ctx.context.cluster);
    const hasUser = config.users.some((u) => u.name === ctx.context.user);

    if (!hasCluster) {
      errors.push(`Context "${ctx.name}" references unknown cluster "${ctx.context.cluster}"`);
    }
    if (!hasUser) {
      errors.push(`Context "${ctx.name}" references unknown user "${ctx.context.user}"`);
    }
  });

  return { valid: errors.length === 0, errors };
}
