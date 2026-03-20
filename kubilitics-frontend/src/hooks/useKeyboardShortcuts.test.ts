import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to reset module state between tests since the registry is a singleton
let useKeyboardShortcuts: typeof import('./useKeyboardShortcuts').useKeyboardShortcuts;
let registerShortcut: typeof import('./useKeyboardShortcuts').registerShortcut;
let unregisterShortcut: typeof import('./useKeyboardShortcuts').unregisterShortcut;
let getShortcuts: typeof import('./useKeyboardShortcuts').getShortcuts;

describe('useKeyboardShortcuts', () => {
  beforeEach(async () => {
    // Re-import fresh module to reset singleton state
    vi.resetModules();
    const mod = await import('./useKeyboardShortcuts');
    useKeyboardShortcuts = mod.useKeyboardShortcuts;
    registerShortcut = mod.registerShortcut;
    unregisterShortcut = mod.unregisterShortcut;
    getShortcuts = mod.getShortcuts;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with an empty registry', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    expect(result.current.shortcuts).toEqual([]);
  });

  it('registers and exposes shortcuts', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useKeyboardShortcuts());

    act(() => {
      result.current.register({
        id: 'test-shortcut',
        keys: '?',
        description: 'Show help',
        handler,
      });
    });

    expect(result.current.shortcuts).toHaveLength(1);
    expect(result.current.shortcuts[0].id).toBe('test-shortcut');
  });

  it('unregisters shortcuts', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useKeyboardShortcuts());

    act(() => {
      result.current.register({
        id: 'to-remove',
        keys: 'x',
        description: 'Temp',
        handler,
      });
    });
    expect(result.current.shortcuts).toHaveLength(1);

    act(() => {
      result.current.unregister('to-remove');
    });
    expect(result.current.shortcuts).toHaveLength(0);
  });

  it('prevents duplicate registrations', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useKeyboardShortcuts());

    act(() => {
      result.current.register({ id: 'dup', keys: '?', description: 'A', handler });
      result.current.register({ id: 'dup', keys: '?', description: 'B', handler });
    });

    expect(result.current.shortcuts).toHaveLength(1);
    expect(result.current.shortcuts[0].description).toBe('A');
  });

  it('auto-registers shortcuts on mount and unregisters on unmount', () => {
    const handler = vi.fn();
    const shortcuts = [
      { id: 'auto-1', keys: '?', description: 'Help', handler },
      { id: 'auto-2', keys: 'g d', description: 'Go dashboard', handler },
    ];

    const { unmount } = renderHook(() => useKeyboardShortcuts(shortcuts));
    expect(getShortcuts()).toHaveLength(2);

    unmount();
    expect(getShortcuts()).toHaveLength(0);
  });

  it('fires single-key shortcut on keydown', () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { id: 'help', keys: '?', description: 'Help', handler },
      ]),
    );

    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires two-key sequence shortcut (g d)', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { id: 'go-dash', keys: 'g d', description: 'Dashboard', handler },
      ]),
    );

    // Press 'g'
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', bubbles: true }),
    );
    // Press 'd' within timeout
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', bubbles: true }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not fire sequence after timeout', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { id: 'go-topo', keys: 'g t', description: 'Topology', handler },
      ]),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', bubbles: true }),
    );
    // Exceed the 800ms timeout
    vi.advanceTimersByTime(900);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ignores shortcuts when an input is focused', () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { id: 'help', keys: '?', description: 'Help', handler },
      ]),
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: '?',
      bubbles: true,
      cancelable: true,
    });
    // Dispatch from input — handler should not fire
    input.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('ignores shortcuts with modifier keys', () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { id: 'help', keys: '?', description: 'Help', handler },
      ]),
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '?',
        metaKey: true,
        bubbles: true,
      }),
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '?',
        ctrlKey: true,
        bubbles: true,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('exposes imperative register/unregister helpers', () => {
    registerShortcut({ id: 'imp', keys: 'x', description: 'Imperative', handler: vi.fn() });
    expect(getShortcuts()).toHaveLength(1);

    unregisterShortcut('imp');
    expect(getShortcuts()).toHaveLength(0);
  });
});
