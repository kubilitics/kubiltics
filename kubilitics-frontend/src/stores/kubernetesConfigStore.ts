import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface KubernetesConfig {
  apiUrl: string;
  token?: string;
  isConnected: boolean;
  lastConnected?: string;
}

interface KubernetesConfigStore {
  config: KubernetesConfig;
  setApiUrl: (url: string) => void;
  setToken: (token: string) => void;
  setConnected: (connected: boolean) => void;
  disconnect: () => void;
}

export const useKubernetesConfigStore = create<KubernetesConfigStore>()(
  persist(
    (set) => ({
      config: {
        apiUrl: '',
        token: undefined,
        isConnected: false,
      },
      setApiUrl: (url) => set((state) => ({ config: { ...state.config, apiUrl: url } })),
      setToken: (token) => set((state) => ({ config: { ...state.config, token } })),
      setConnected: (connected) =>
        set((state) => ({
          config: {
            ...state.config,
            isConnected: connected,
            lastConnected: connected ? new Date().toISOString() : state.config.lastConnected,
          },
        })),
      disconnect: () =>
        set({
          config: {
            apiUrl: '',
            token: undefined,
            isConnected: false,
          },
        }),
    }),
    {
      name: 'kubernetes-config',
    }
  )
);
