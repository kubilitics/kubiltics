import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** Resolved theme based on system preference when theme is 'system' */
  resolvedTheme: 'light' | 'dark';
  setResolvedTheme: (resolved: 'light' | 'dark') => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      resolvedTheme: 'light',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => {
          const current = state.theme === 'system' ? state.resolvedTheme : state.theme;
          return { theme: current === 'light' ? 'dark' : 'light' };
        }),
      setResolvedTheme: (resolved) => set({ resolvedTheme: resolved }),
    }),
    {
      name: 'kubilitics-theme',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);
