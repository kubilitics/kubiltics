import { useAIProfiles, type Profile } from './useAIProfiles';

/**
 * useActiveProfile — the active profile or null. Convenience wrapper
 * around useAIProfiles that's the natural read for "what is the user
 * currently configured to use?"
 */
export function useActiveProfile(): Profile | null {
  const { profiles, activeId } = useAIProfiles();
  if (!activeId) return null;
  return profiles.find((p) => p.id === activeId) ?? null;
}
