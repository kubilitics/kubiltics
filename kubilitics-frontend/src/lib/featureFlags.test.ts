import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featurePresenceV2 } from './featureFlags';

describe('featurePresenceV2', () => {
  beforeEach(() => {
    (globalThis as any).__KUBILITICS_FEATURE_OVERRIDES__ = {};
    localStorage.removeItem('kubilitics.feature.presenceV2');
    vi.unstubAllEnvs();
  });

  it('defaults false when nothing is set', () => {
    expect(featurePresenceV2()).toBe(false);
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
});
