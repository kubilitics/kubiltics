/**
 * Unit tests for demoStore.
 *
 * Covers: default, setDemo, reset, localStorage persistence round-trip.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDemoStore } from './demoStore';

const PERSIST_KEY = 'kubilitics.demo.enabled';

describe('demoStore', () => {
  beforeEach(() => {
    localStorage.removeItem(PERSIST_KEY);
    useDemoStore.setState({ isDemo: false });
  });

  it('has correct default value', () => {
    expect(useDemoStore.getState().isDemo).toBe(false);
  });

  it('setDemo(true) updates the flag', () => {
    useDemoStore.getState().setDemo(true);
    expect(useDemoStore.getState().isDemo).toBe(true);
  });

  it('setDemo(false) updates the flag', () => {
    useDemoStore.getState().setDemo(true);
    useDemoStore.getState().setDemo(false);
    expect(useDemoStore.getState().isDemo).toBe(false);
  });

  it('persists isDemo to localStorage', async () => {
    useDemoStore.getState().setDemo(true);
    await new Promise((r) => setTimeout(r, 20));

    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.isDemo).toBe(true);
  });

  it('reset() returns to default', () => {
    useDemoStore.getState().setDemo(true);
    useDemoStore.getState().reset();
    expect(useDemoStore.getState().isDemo).toBe(false);
  });
});
