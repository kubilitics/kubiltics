import { useEffect, useRef, useCallback, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyboardShortcut {
  /** Unique identifier, e.g. "go-dashboard" */
  id: string;
  /** Human-readable keys, e.g. "g d" or "?" */
  keys: string;
  /** Description shown in the help overlay */
  description: string;
  /** Handler invoked when the shortcut fires */
  handler: () => void;
  /** Optional group label (e.g. "Navigation", "General") */
  group?: string;
}

// ---------------------------------------------------------------------------
// Registry (module-level singleton — shared across all hook instances)
// ---------------------------------------------------------------------------

type Listener = () => void;

let shortcuts: KeyboardShortcut[] = [];
const listeners = new Set<Listener>();

function emitChange() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): KeyboardShortcut[] {
  return shortcuts;
}

function registerShortcut(shortcut: KeyboardShortcut) {
  // Prevent duplicate registrations
  if (shortcuts.some((s) => s.id === shortcut.id)) return;
  shortcuts = [...shortcuts, shortcut];
  emitChange();
}

function unregisterShortcut(id: string) {
  const next = shortcuts.filter((s) => s.id !== id);
  if (next.length !== shortcuts.length) {
    shortcuts = next;
    emitChange();
  }
}

// ---------------------------------------------------------------------------
// Sequence detection state
// ---------------------------------------------------------------------------

let pendingPrefix: string | null = null;
let prefixTimer: ReturnType<typeof setTimeout> | null = null;
const SEQUENCE_TIMEOUT = 800; // ms to wait for the second key

function clearPrefix() {
  pendingPrefix = null;
  if (prefixTimer) {
    clearTimeout(prefixTimer);
    prefixTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Global keydown listener (attached once)
// ---------------------------------------------------------------------------

let globalListenerAttached = false;

function isInputTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable ||
    !!el.closest('[data-shell-panel]') ||
    !!el.closest('.xterm')
  );
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (isInputTarget(e)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const key = e.key;
  const current = getSnapshot();

  // --- Two-key sequence handling (e.g. "g d") ---
  if (pendingPrefix) {
    const combo = `${pendingPrefix} ${key}`;
    const match = current.find((s) => s.keys === combo);
    clearPrefix();
    if (match) {
      e.preventDefault();
      match.handler();
      return;
    }
    // No match — fall through to single-key check
  }

  // Check if this key starts a sequence
  const startsSequence = current.some((s) => {
    const parts = s.keys.split(' ');
    return parts.length === 2 && parts[0] === key;
  });

  if (startsSequence) {
    pendingPrefix = key;
    prefixTimer = setTimeout(clearPrefix, SEQUENCE_TIMEOUT);
    return;
  }

  // --- Single-key shortcuts (e.g. "?") ---
  const match = current.find((s) => s.keys === key && !s.keys.includes(' '));
  if (match) {
    e.preventDefault();
    match.handler();
  }
}

function ensureGlobalListener() {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  window.addEventListener('keydown', handleGlobalKeyDown);
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

/**
 * Central keyboard shortcut registry.
 *
 * Use `register` / `unregister` to manage shortcuts, or pass an array of
 * shortcuts to auto-register on mount and auto-unregister on unmount.
 *
 * All registered shortcuts are available via `shortcuts` (reactive).
 *
 * Built-in shortcuts (register them in your top-level layout):
 * - `?`   — help overlay
 * - `g d` — go to dashboard
 * - `g t` — go to topology
 */
export function useKeyboardShortcuts(autoRegister?: KeyboardShortcut[]) {
  const registered = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Ensure the global keydown listener is active
  useEffect(ensureGlobalListener, []);

  // Auto-register / unregister
  const autoRef = useRef(autoRegister);
  autoRef.current = autoRegister;

  useEffect(() => {
    const items = autoRef.current;
    if (!items || items.length === 0) return;
    items.forEach(registerShortcut);
    return () => {
      items.forEach((s) => unregisterShortcut(s.id));
    };
    // We intentionally depend on the stringified ids so a new array with different
    // items triggers re-registration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRegister?.map((s) => s.id).join(',')]);

  const register = useCallback((s: KeyboardShortcut) => registerShortcut(s), []);
  const unregister = useCallback((id: string) => unregisterShortcut(id), []);

  return {
    /** All currently registered shortcuts (reactive). */
    shortcuts: registered,
    /** Register a new shortcut at runtime. */
    register,
    /** Unregister a shortcut by id. */
    unregister,
  } as const;
}

// Export registry helpers for imperative use outside React
export { registerShortcut, unregisterShortcut, getSnapshot as getShortcuts };
