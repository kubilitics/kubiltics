import * as React from 'react';
import { cn } from '@/lib/utils';
import { useTableDensityStore, type TableDensity } from '@/stores/tableDensityStore';

interface DensityOption {
  value: TableDensity;
  label: string;
  /** Number of visible lines in the icon (more lines = denser) */
  lines: number;
  /** Gap between lines in the icon (px) */
  gap: number;
}

const DENSITY_OPTIONS: DensityOption[] = [
  { value: 'compact', label: 'Compact', lines: 4, gap: 2 },
  { value: 'comfortable', label: 'Comfortable', lines: 3, gap: 4 },
  { value: 'spacious', label: 'Spacious', lines: 2, gap: 6 },
];

/** SVG icon depicting horizontal lines with configurable spacing. */
function DensityIcon({ lines, gap, size = 16 }: { lines: number; gap: number; size?: number }) {
  const lineHeight = 2;
  const totalContentHeight = lines * lineHeight + (lines - 1) * gap;
  const startY = (size - totalContentHeight) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {Array.from({ length: lines }, (_, i) => (
        <rect
          key={i}
          x={2}
          y={startY + i * (lineHeight + gap)}
          width={size - 4}
          height={lineHeight}
          rx={1}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

export interface TableDensityToggleProps {
  className?: string;
}

/**
 * Segmented control for switching table row density between compact, comfortable, and spacious.
 * Persists preference to localStorage via the tableDensityStore.
 */
export function TableDensityToggle({ className }: TableDensityToggleProps) {
  const density = useTableDensityStore((s) => s.density);
  const setDensity = useTableDensityStore((s) => s.setDensity);

  return (
    <div
      role="radiogroup"
      aria-label="Table density"
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-muted/50 p-0.5',
        'dark:border-border dark:bg-muted/30',
        className
      )}
    >
      {DENSITY_OPTIONS.map((option) => {
        const isActive = density === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${option.label} density`}
            title={option.label}
            onClick={() => setDensity(option.value)}
            className={cn(
              'inline-flex items-center justify-center rounded-[5px] px-2 py-1.5',
              'text-muted-foreground transition-all duration-150',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              isActive && [
                'bg-background text-foreground shadow-sm',
                'dark:bg-background dark:text-foreground',
              ],
              !isActive && [
                'hover:bg-muted/80',
                'dark:hover:bg-muted/50',
              ]
            )}
          >
            <DensityIcon lines={option.lines} gap={option.gap} />
          </button>
        );
      })}
    </div>
  );
}
