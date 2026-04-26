import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Capture the registered listener so the test can fire fake events.
const registered: Array<(event: { payload: unknown }) => void> = [];
const unlistenSpy = vi.fn();

// Mock @tauri-apps/api/event. The dynamic import inside the hook will
// resolve to this mock; non-Tauri paths short-circuit before the import.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    if (event === 'brain-status') registered.push(cb);
    return unlistenSpy;
  }),
}));

const invalidateSpy = vi.fn(async () => {});
vi.mock('./useInvalidateAI', () => ({
  useInvalidateAI: () => invalidateSpy,
}));

import { useBrainStatusListener } from './useBrainStatusListener';

beforeEach(() => {
  registered.length = 0;
  unlistenSpy.mockClear();
  invalidateSpy.mockClear();
});

describe('useBrainStatusListener', () => {
  it('fires invalidateAI when a brain-status event arrives (Tauri)', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    try {
      renderHook(() => useBrainStatusListener());
      await waitFor(() => expect(registered.length).toBe(1));

      await act(async () => {
        registered[0]({ payload: { status: 'ready', message: 'AI engine ready' } });
        await new Promise((r) => setTimeout(r, 5));
      });

      expect(invalidateSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });

  it('is a no-op outside Tauri (no listener registered, no error)', async () => {
    expect((window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__).toBeUndefined();

    renderHook(() => useBrainStatusListener());
    await new Promise((r) => setTimeout(r, 20));

    expect(registered.length).toBe(0);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('cleans up the listener on unmount', async () => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    try {
      const { unmount } = renderHook(() => useBrainStatusListener());
      await waitFor(() => expect(registered.length).toBe(1));
      unmount();
      await new Promise((r) => setTimeout(r, 5));
      expect(unlistenSpy).toHaveBeenCalled();
    } finally {
      delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    }
  });
});
