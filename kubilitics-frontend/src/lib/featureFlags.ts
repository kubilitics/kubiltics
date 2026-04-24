// Feature flag readers for the onboarding-v2 rollout. Priority:
//   1. localStorage override (QA / developer toggle, persists across reloads)
//   2. Vite build-time env (production default)
//   3. Hard-coded default (on as of Phase 6, 2026-04-24)
// Runtime changes require a page reload since stores read once at init.
//
// Opt-out: setting the localStorage key or Vite env to the literal string
// "false" forces the feature off even when the default is on. This is the
// rollback path for QA — no rebuild needed.

const STORAGE_PREFIX = 'kubilitics.feature.';

function readFlag(name: string, envKey: string, defaultOn: boolean): boolean {
  try {
    const ls = localStorage.getItem(STORAGE_PREFIX + name);
    if (ls === 'true') return true;
    if (ls === 'false') return false;
  } catch {
    // SSR / privacy mode — fall through.
  }
  const env = import.meta.env[envKey];
  if (env === 'true' || env === true) return true;
  if (env === 'false' || env === false) return false;
  return defaultOn;
}

export function featurePresenceV2(): boolean {
  // Phase 6 (2026-04-24): default flipped to on.
  return readFlag('presenceV2', 'VITE_FEATURE_PRESENCE_V2', true);
}
