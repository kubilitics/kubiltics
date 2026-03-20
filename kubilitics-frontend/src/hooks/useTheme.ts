/**
 * useTheme — Ergonomic hook for theme management.
 *
 * Wraps the Zustand themeStore and ThemeProvider logic into a single
 * consumer-friendly hook. Components that just need to read or toggle
 * the theme should use this instead of importing the store directly.
 *
 * Features:
 * - Reads persisted preference from localStorage (via themeStore)
 * - Falls back to OS-level prefers-color-scheme
 * - Provides toggle(), setTheme(), and resolved effective theme
 * - Watches system preference changes in real-time
 * - Updates document.documentElement.classList ('dark' / 'light')
 *
 * TASK-CORE-003: Complete Dark Mode
 */
import { useEffect, useCallback, useSyncExternalStore } from 'react';
import { useThemeStore, type Theme } from '@/stores/themeStore';

/* ─── System preference media query (singleton) ─── */
const DARK_MQ = '(prefers-color-scheme: dark)';

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(DARK_MQ).matches ? 'dark' : 'light';
}

/**
 * Subscribe to OS-level color-scheme changes.
 * Used by useSyncExternalStore to re-render when the OS theme flips.
 */
function subscribeToSystemTheme(callback: () => void): () => void {
  const mq = window.matchMedia(DARK_MQ);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

export interface UseThemeReturn {
  /** User-selected theme preference: 'light' | 'dark' | 'system' */
  theme: Theme;
  /** The actually-applied theme after resolving 'system' */
  effectiveTheme: 'light' | 'dark';
  /** Whether dark mode is currently active */
  isDark: boolean;
  /** Set an explicit theme preference */
  setTheme: (theme: Theme) => void;
  /** Cycle: light -> dark -> system -> light */
  cycleTheme: () => void;
  /** Quick toggle between light and dark (skips system) */
  toggle: () => void;
  /** Current OS preference regardless of user choice */
  systemPreference: 'light' | 'dark';
}

export function useTheme(): UseThemeReturn {
  const { theme, setTheme, toggleTheme, resolvedTheme, setResolvedTheme } =
    useThemeStore();

  // Keep resolvedTheme in sync with OS preference via useSyncExternalStore
  const systemPreference = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemPreference,
    // Server snapshot
    () => 'light' as const
  );

  // Push system preference into the store whenever it changes
  useEffect(() => {
    setResolvedTheme(systemPreference);
  }, [systemPreference, setResolvedTheme]);

  const effectiveTheme: 'light' | 'dark' =
    theme === 'system' ? resolvedTheme : theme;

  // Apply class to documentElement
  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    root.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  const toggle = useCallback(() => {
    toggleTheme();
  }, [toggleTheme]);

  const cycleTheme = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  }, [theme, setTheme]);

  return {
    theme,
    effectiveTheme,
    isDark: effectiveTheme === 'dark',
    setTheme,
    cycleTheme,
    toggle,
    systemPreference,
  };
}
