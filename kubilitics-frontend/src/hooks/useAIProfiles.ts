import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type Profile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url: string;
  has_key: boolean;
  created_at: string;
  updated_at: string;
  last_validated_at: string | null;
  last_error: string | null;
};

export type AIProfilesState = {
  profiles: Profile[];
  activeId: string | null;
  isLoading: boolean;
  error?: Error;
  reload: () => Promise<void>;
};

/**
 * useAIProfiles — list of profiles + active id, fetched via Tauri invoke().
 * Single source of truth for profile state in the React tree. UI components
 * MUST consume this hook (or `useActiveProfile`) — direct invoke('list_profiles')
 * etc. is blocked by scripts/check-frontend-discipline.mjs.
 *
 * Spec: docs/superpowers/specs/2026-04-26-ai-profile-architecture-design.md
 */
export function useAIProfiles(): AIProfilesState {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(undefined);
      const [list, active] = await Promise.all([
        invoke<Profile[]>('list_profiles'),
        invoke<Profile | null>('get_active_profile'),
      ]);
      setProfiles(list);
      setActiveId(active?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { profiles, activeId, isLoading, error, reload };
}
