import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

/**
 * ThemeProvider — applies 'dark' class to <html> based on user preference.
 *
 * Why not next-themes? Tauri's WKWebView doesn't support it reliably.
 * This is a minimal, Zustand-powered replacement that:
 *   1. Listens to `prefers-color-scheme` media query for 'system' mode
 *   2. Adds/removes the 'dark' class on <html> (Tailwind darkMode: ['class'])
 *   3. Adds a brief transition class for smooth theme switching
 *   4. Persists preference in localStorage via Zustand persist
 *
 * Renders nothing — purely a side-effect component.
 */
export function ThemeProvider() {
  const theme = useThemeStore((s) => s.theme);
  const setResolvedTheme = useThemeStore((s) => s.setResolvedTheme);

  // Listen to system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const systemDark = 'matches' in e ? e.matches : (e as MediaQueryList).matches;
      setResolvedTheme(systemDark ? 'dark' : 'light');
    };

    // Set initial value
    handleChange(mediaQuery);

    // Listen for changes
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [setResolvedTheme]);

  // Apply dark class to <html>
  useEffect(() => {
    const root = document.documentElement;
    const resolvedTheme = useThemeStore.getState().resolvedTheme;
    const isDark =
      theme === 'dark' || (theme === 'system' && resolvedTheme === 'dark');

    // Add transition class for smooth switch
    root.classList.add('theme-transitioning');

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Remove transition class after animation completes
    const timer = setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 250);

    return () => clearTimeout(timer);
  }, [theme]);

  // Also react to resolvedTheme changes (when system preference changes)
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  useEffect(() => {
    if (theme !== 'system') return;
    const root = document.documentElement;
    root.classList.add('theme-transitioning');

    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    const timer = setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 250);

    return () => clearTimeout(timer);
  }, [theme, resolvedTheme]);

  return null;
}
