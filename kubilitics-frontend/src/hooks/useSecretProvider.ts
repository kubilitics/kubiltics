/**
 * useSecretProvider — ENT-001
 *
 * Hook for managing secret provider configuration. Talks to the backend
 * /api/v1/settings/secrets endpoint. Exposes provider CRUD, health polling,
 * and optimistic-update helpers used by the SecretManagement settings panel.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

// ─── Types ───────────────────────────────────────────────────

export type SecretProviderType =
  | 'kubernetes'
  | 'vault'
  | 'aws-secrets-manager'
  | 'azure-key-vault';

export interface SecretProviderConfig {
  provider: SecretProviderType;
  /** Display name shown in the UI */
  displayName: string;
  /** Endpoint URL for external providers (Vault address, etc.) */
  endpointUrl?: string;
  /** Path to credentials file or mount path */
  credentialsPath?: string;
  /** Vault-specific: mount path for the secrets engine */
  mountPath?: string;
  /** AWS-specific: region */
  region?: string;
  /** Azure-specific: tenant ID */
  tenantId?: string;
  /** Whether TLS verification is enabled */
  tlsVerify?: boolean;
}

export interface SecretProviderHealth {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unconfigured';
  latencyMs?: number;
  message?: string;
  lastChecked: string;
}

export interface SecretProviderState {
  config: SecretProviderConfig | null;
  health: SecretProviderHealth;
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  error: string | null;
}

// ─── Defaults ────────────────────────────────────────────────

const UNCONFIGURED_HEALTH: SecretProviderHealth = {
  status: 'unconfigured',
  message: 'No secret provider configured',
  lastChecked: new Date().toISOString(),
};

const PROVIDER_META: Record<SecretProviderType, { displayName: string; defaultEndpoint: string }> = {
  kubernetes: {
    displayName: 'Kubernetes Secrets',
    defaultEndpoint: '',
  },
  vault: {
    displayName: 'HashiCorp Vault',
    defaultEndpoint: 'https://vault.example.com:8200',
  },
  'aws-secrets-manager': {
    displayName: 'AWS Secrets Manager',
    defaultEndpoint: '',
  },
  'azure-key-vault': {
    displayName: 'Azure Key Vault',
    defaultEndpoint: 'https://my-vault.vault.azure.net',
  },
};

export { PROVIDER_META };

// ─── Hook ────────────────────────────────────────────────────

export function useSecretProvider() {
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<SecretProviderState>({
    config: null,
    health: UNCONFIGURED_HEALTH,
    isLoading: true,
    isSaving: false,
    isTesting: false,
    error: null,
  });

  // ── Fetch current config from backend ──────────────────────

  const fetchConfig = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/secrets`);
      if (!res.ok) {
        if (res.status === 404) {
          // Not configured yet
          setState((s) => ({
            ...s,
            config: null,
            health: UNCONFIGURED_HEALTH,
            isLoading: false,
          }));
          return;
        }
        throw new Error(`Failed to fetch secret provider config: ${res.statusText}`);
      }
      const data = await res.json();
      setState((s) => ({
        ...s,
        config: data.config ?? null,
        health: data.health ?? UNCONFIGURED_HEALTH,
        isLoading: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [backendBaseUrl]);

  // ── Save config ────────────────────────────────────────────

  const saveConfig = useCallback(
    async (config: SecretProviderConfig): Promise<boolean> => {
      setState((s) => ({ ...s, isSaving: true, error: null }));
      try {
        const res = await fetch(`${backendBaseUrl}/api/v1/settings/secrets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || res.statusText);
        }
        const data = await res.json();
        setState((s) => ({
          ...s,
          config: data.config ?? config,
          health: data.health ?? s.health,
          isSaving: false,
        }));
        return true;
      } catch (err) {
        setState((s) => ({
          ...s,
          isSaving: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
        return false;
      }
    },
    [backendBaseUrl]
  );

  // ── Test connection ────────────────────────────────────────

  const testConnection = useCallback(
    async (config: SecretProviderConfig): Promise<SecretProviderHealth> => {
      setState((s) => ({ ...s, isTesting: true, error: null }));
      try {
        const res = await fetch(`${backendBaseUrl}/api/v1/settings/secrets/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || res.statusText);
        }
        const data: SecretProviderHealth = await res.json();
        setState((s) => ({ ...s, health: data, isTesting: false }));
        return data;
      } catch (err) {
        const failedHealth: SecretProviderHealth = {
          status: 'unreachable',
          message: err instanceof Error ? err.message : 'Connection test failed',
          lastChecked: new Date().toISOString(),
        };
        setState((s) => ({ ...s, health: failedHealth, isTesting: false }));
        return failedHealth;
      }
    },
    [backendBaseUrl]
  );

  // ── Delete / reset config ──────────────────────────────────

  const deleteConfig = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, isSaving: true, error: null }));
    try {
      const res = await fetch(`${backendBaseUrl}/api/v1/settings/secrets`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
      setState((s) => ({
        ...s,
        config: null,
        health: UNCONFIGURED_HEALTH,
        isSaving: false,
      }));
      return true;
    } catch (err) {
      setState((s) => ({
        ...s,
        isSaving: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
      return false;
    }
  }, [backendBaseUrl]);

  // ── Health polling (every 30s when configured) ─────────────

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (state.config) {
      pollingRef.current = setInterval(() => {
        testConnection(state.config!);
      }, 30_000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // Only re-create interval when the provider type changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config?.provider]);

  return {
    ...state,
    fetchConfig,
    saveConfig,
    testConnection,
    deleteConfig,
  };
}
