import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featurePresenceV2 } from './featureFlags';

describe('featurePresenceV2', () => {
  beforeEach(() => {
    (globalThis as any).__KUBILITICS_FEATURE_OVERRIDES__ = {};
    localStorage.removeItem('kubilitics.feature.presenceV2');
    vi.unstubAllEnvs();
  });

  // Phase 6 (2026-04-24) flipped the default on.
  it('defaults true when nothing is set (post-Phase-6 default-on)', () => {
    expect(featurePresenceV2()).toBe(true);
  });

  it('honors Vite env VITE_FEATURE_PRESENCE_V2=true', () => {
    vi.stubEnv('VITE_FEATURE_PRESENCE_V2', 'true');
    expect(featurePresenceV2()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('honors runtime localStorage override for QA toggling', () => {
    localStorage.setItem('kubilitics.feature.presenceV2', 'true');
    expect(featurePresenceV2()).toBe(true);
    localStorage.removeItem('kubilitics.feature.presenceV2');
  });

  // Explicit opt-out: QA must be able to roll back the UI without rebuilding.
  it('localStorage override "false" forces feature off even when default is on', () => {
    localStorage.setItem('kubilitics.feature.presenceV2', 'false');
    expect(featurePresenceV2()).toBe(false);
    localStorage.removeItem('kubilitics.feature.presenceV2');
  });

  it('Vite env VITE_FEATURE_PRESENCE_V2=false forces feature off', () => {
    vi.stubEnv('VITE_FEATURE_PRESENCE_V2', 'false');
    expect(featurePresenceV2()).toBe(false);
    vi.unstubAllEnvs();
  });
});
