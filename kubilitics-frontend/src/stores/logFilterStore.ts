/**
 * logFilterStore — persists log viewer filter state across navigation.
 *
 * Stores: search query, level filter, regex mode, inverse-filter mode,
 * context lines, prettify-JSON mode, and hide-terminated-containers flag.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

interface LogFilterState {
  searchQuery: string;
  selectedLevel: string | null;
  useRegex: boolean;
  inverseFilter: boolean;
  contextLines: number;
  prettifyJson: boolean;
  hideTerminated: boolean;

  setSearchQuery: (q: string) => void;
  setSelectedLevel: (level: string | null) => void;
  setUseRegex: (v: boolean) => void;
  setInverseFilter: (v: boolean) => void;
  setContextLines: (n: number) => void;
  setPrettifyJson: (v: boolean) => void;
  setHideTerminated: (v: boolean) => void;
  reset: () => void;
}

const DEFAULTS = {
  searchQuery: '',
  selectedLevel: null as string | null,
  useRegex: false,
  inverseFilter: false,
  contextLines: 0,
  prettifyJson: false,
  hideTerminated: false,
};

export const useLogFilterStore = create<LogFilterState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSelectedLevel: (selectedLevel) => set({ selectedLevel }),
      setUseRegex: (useRegex) => set({ useRegex }),
      setInverseFilter: (inverseFilter) => set({ inverseFilter }),
      setContextLines: (contextLines) => set({ contextLines }),
      setPrettifyJson: (prettifyJson) => set({ prettifyJson }),
      setHideTerminated: (hideTerminated) => set({ hideTerminated }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: 'kubilitics-log-filters',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);
