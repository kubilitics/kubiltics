import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

/**
 * ThemeProvider — applies the correct theme class to <html>.
 * Supports light, dark, and system (auto-detect) modes.
 * Listens to OS prefers-color-scheme changes when theme is 'system'.
 */
export function ThemeProvider() {
  const { theme, resolvedTheme, setResolvedTheme } = useThemeStore();

  // Detect system preference and listen for changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const systemPrefersDark = 'matches' in e ? e.matches : false;
      setResolvedTheme(systemPrefersDark ? 'dark' : 'light');
    };

    // Set initial resolved theme from system
    handleChange(mediaQuery);

    // Listen for OS theme changes
    mediaQuery.addEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    return () => {
      mediaQuery.removeEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    };
  }, [setResolvedTheme]);

  // Apply dark/light class to <html> based on theme selection
  useEffect(() => {
    const root = document.documentElement;
    const effectiveTheme = theme === 'system' ? resolvedTheme : theme;

    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }

    // Set color-scheme for native browser elements (scrollbars, form controls)
    root.style.colorScheme = effectiveTheme;
  }, [theme, resolvedTheme]);

  return null;
}
