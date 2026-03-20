// Unit test for backend config store (B4.3 critical path).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useBackendConfigStore } from './backendConfigStore';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';

describe('backendConfigStore', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    useBackendConfigStore.getState().setBackendBaseUrl('');
    useBackendConfigStore.getState().setCurrentClusterId(null);
  });

  afterEach(() => {
    // Restore window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('isBackendConfigured returns false when URL is empty', () => {
    // Mock window.location to be non-local so it doesn't auto-configure to true in dev
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        hostname: 'example.com',
      },
    });

    useBackendConfigStore.getState().setBackendBaseUrl('');
    // Ensure we are testing the non-auto-configured path
    expect(useBackendConfigStore.getState().isBackendConfigured()).toBe(false);
  });

  it('isBackendConfigured returns true when URL is set', () => {
    useBackendConfigStore.getState().setBackendBaseUrl(DEFAULT_BACKEND_BASE_URL);
    expect(useBackendConfigStore.getState().isBackendConfigured()).toBe(true);
  });

  it('setBackendBaseUrl trims and strips trailing slashes', () => {
    useBackendConfigStore.getState().setBackendBaseUrl(`  ${DEFAULT_BACKEND_BASE_URL}/  `);
    expect(useBackendConfigStore.getState().backendBaseUrl).toBe(DEFAULT_BACKEND_BASE_URL);
  });

  it('setCurrentClusterId updates cluster id', () => {
    useBackendConfigStore.getState().setCurrentClusterId('cluster-1');
    expect(useBackendConfigStore.getState().currentClusterId).toBe('cluster-1');
  });
});
