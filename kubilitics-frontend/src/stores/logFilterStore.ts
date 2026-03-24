import { create } from 'zustand';

type LevelFilter = 'all' | 'info' | 'warn' | 'error' | 'debug';

interface LogFilterState {
  searchQuery: string;
  levelFilter: LevelFilter;
  regexMode: boolean;
  inverseFilter: boolean;
  contextLines: number;
  prettifyJson: boolean;
  hideTerminated: boolean;
  setSearchQuery: (q: string) => void;
  setLevelFilter: (l: LevelFilter) => void;
  toggleRegexMode: () => void;
  toggleInverseFilter: () => void;
  setContextLines: (n: number) => void;
  togglePrettifyJson: () => void;
  toggleHideTerminated: () => void;
  resetFilters: () => void;
}

const initialState = {
  searchQuery: '',
  levelFilter: 'all' as LevelFilter,
  regexMode: false,
  inverseFilter: false,
  contextLines: 0,
  prettifyJson: true,
  hideTerminated: false,
};

export const useLogFilterStore = create<LogFilterState>()((set) => ({
  ...initialState,
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLevelFilter: (levelFilter) => set({ levelFilter }),
  toggleRegexMode: () => set((s) => ({ regexMode: !s.regexMode })),
  toggleInverseFilter: () => set((s) => ({ inverseFilter: !s.inverseFilter })),
  setContextLines: (contextLines) => set({ contextLines }),
  togglePrettifyJson: () => set((s) => ({ prettifyJson: !s.prettifyJson })),
  toggleHideTerminated: () => set((s) => ({ hideTerminated: !s.hideTerminated })),
  resetFilters: () => set(initialState),
}));
