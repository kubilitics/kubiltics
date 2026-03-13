import { useEffect } from 'react';

/**
 * ThemeProvider — forces light theme only.
 * Ensures 'dark' class is never on <html>, regardless of system preference.
 */
export function ThemeProvider() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
  }, []);

  return null;
}
