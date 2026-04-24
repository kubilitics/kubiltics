// Feature flag readers for the onboarding-v2 rollout. Priority:
//   1. localStorage override (QA / developer toggle, persists across reloads)
//   2. Vite build-time env (production default)
//   3. Hard-coded default (false during rollout)
// Runtime changes require a page reload since stores read once at init.

const STORAGE_PREFIX = 'kubilitics.feature.';

function readFlag(name: string, envKey: string): boolean {
  try {
    const ls = localStorage.getItem(STORAGE_PREFIX + name);
    if (ls === 'true') return true;
    if (ls === 'false') return false;
  } catch {
    // SSR / privacy mode — fall through.
  }
  const env = import.meta.env[envKey];
  return env === 'true' || env === true;
}

export function featurePresenceV2(): boolean {
  return readFlag('presenceV2', 'VITE_FEATURE_PRESENCE_V2');
}
