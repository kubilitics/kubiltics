import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

export type TableDensity = 'compact' | 'comfortable' | 'spacious';

interface TableDensityState {
  density: TableDensity;
  setDensity: (density: TableDensity) => void;
}

export const useTableDensityStore = create<TableDensityState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      setDensity: (density) => set({ density }),
    }),
    {
      name: 'kubilitics-table-density',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);
