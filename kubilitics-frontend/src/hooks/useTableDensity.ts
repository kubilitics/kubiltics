import { useMemo } from 'react';
import { useTableDensityStore, type TableDensity } from '@/stores/tableDensityStore';

interface TableDensityConfig {
  /** Current density setting */
  density: TableDensity;
  /** Row height in pixels */
  rowHeight: number;
  /** Tailwind font-size class */
  fontSizeClass: string;
  /** Tailwind vertical padding class for table cells */
  paddingClass: string;
}

const DENSITY_CONFIG: Record<TableDensity, Omit<TableDensityConfig, 'density'>> = {
  compact: {
    rowHeight: 32,
    fontSizeClass: 'text-xs',
    paddingClass: 'py-1 px-2',
  },
  comfortable: {
    rowHeight: 44,
    fontSizeClass: 'text-sm',
    paddingClass: 'py-2 px-3',
  },
  spacious: {
    rowHeight: 56,
    fontSizeClass: 'text-sm',
    paddingClass: 'py-3.5 px-4',
  },
};

/**
 * Returns the current table density preference along with derived styling values.
 * Use in table components to apply consistent row height, font size, and padding.
 */
export function useTableDensity(): TableDensityConfig {
  const density = useTableDensityStore((s) => s.density);

  return useMemo(
    () => ({
      density,
      ...DENSITY_CONFIG[density],
    }),
    [density]
  );
}
