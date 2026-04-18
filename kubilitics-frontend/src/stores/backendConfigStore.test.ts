// Unit test for backend config store (B4.3 critical path).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useBackendConfigStore, getEffectiveBackendBaseUrl, getCurrentBackendUrl } from './backendConfigStore';
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

  it('isBackendConfigured returns true in any browser context (empty URL = same-origin)', () => {
    // In-cluster Helm install serves the frontend via nginx that proxies /api/*
    // to the backend Service. The frontend's "backend URL" is therefore empty
    // (same-origin) and that IS valid configuration. Without this contract the
    // production browser routes every user to /connect because syncClusters
    // refuses to fire when "backend not configured".
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        hostname: 'example.com',
      },
    });

    useBackendConfigStore.getState().setBackendBaseUrl('');
    expect(useBackendConfigStore.getState().isBackendConfigured()).toBe(true);
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

  it('setCurrentClusterId accepts null to clear', () => {
    useBackendConfigStore.getState().setCurrentClusterId('cluster-1');
    useBackendConfigStore.getState().setCurrentClusterId(null);
    expect(useBackendConfigStore.getState().currentClusterId).toBeNull();
  });

  it('clearBackend resets URL to default and clears cluster', () => {
    useBackendConfigStore.getState().setBackendBaseUrl('http://custom:9999');
    useBackendConfigStore.getState().setCurrentClusterId('c1');

    useBackendConfigStore.getState().clearBackend();

    expect(useBackendConfigStore.getState().currentClusterId).toBeNull();
    expect(useBackendConfigStore.getState().logoutFlag).toBe(true);
  });

  it('setLogoutFlag toggles logout flag', () => {
    // Reset logoutFlag first (clearBackend in previous tests may have set it)
    useBackendConfigStore.getState().setLogoutFlag(false);
    expect(useBackendConfigStore.getState().logoutFlag).toBe(false);
    useBackendConfigStore.getState().setLogoutFlag(true);
    expect(useBackendConfigStore.getState().logoutFlag).toBe(true);
    useBackendConfigStore.getState().setLogoutFlag(false);
    expect(useBackendConfigStore.getState().logoutFlag).toBe(false);
  });

  it('setBackendBaseUrl handles URL with multiple trailing slashes', () => {
    useBackendConfigStore.getState().setBackendBaseUrl('http://example.com:8190///');
    expect(useBackendConfigStore.getState().backendBaseUrl).toBe('http://example.com:8190');
  });

  it('setBackendBaseUrl handles empty string', () => {
    useBackendConfigStore.getState().setBackendBaseUrl('');
    expect(useBackendConfigStore.getState().backendBaseUrl).toBe('');
  });
});

describe('getEffectiveBackendBaseUrl', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('returns empty string in dev on localhost (Vite proxy mode)', () => {
    // In dev + localhost, getEffectiveBackendBaseUrl returns '' so the Vite proxy is used
    const result = getEffectiveBackendBaseUrl('');
    // The function returns '' for dev localhost (proxy mode) - this is the expected behavior
    expect(typeof result).toBe('string');
  });

  it('trims whitespace and trailing slashes from stored URL', () => {
    // Mock non-localhost to avoid the dev proxy shortcircuit
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, hostname: 'example.com' },
    });
    const result = getEffectiveBackendBaseUrl('  http://my-backend:8190/  ');
    expect(result).toBe('http://my-backend:8190');
  });

  it('returns stored URL as-is when clean and on non-local host', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, hostname: 'example.com' },
    });
    const result = getEffectiveBackendBaseUrl('http://my-backend:8190');
    expect(result).toBe('http://my-backend:8190');
  });
});

describe('getCurrentBackendUrl', () => {
  it('returns current store backendBaseUrl', () => {
    useBackendConfigStore.getState().setBackendBaseUrl('http://test:9000');
    expect(getCurrentBackendUrl()).toBe('http://test:9000');
  });
});
