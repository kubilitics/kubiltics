/**
 * TimeRangeSelector — Dashboard time range picker
 *
 * Enables temporal analysis by allowing users to select a time window
 * for all Dashboard widgets (metrics, events, pod distribution).
 *
 * TASK-UX-005: Dashboard Time Range Selector
 */

/* eslint-disable react-refresh/only-export-components */
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Clock, ChevronDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Time Range Types ────────────────────────────────────────────────────────

export type TimeRangePreset = '15m' | '1h' | '6h' | '24h' | '7d' | 'custom';

export interface TimeRange {
  preset: TimeRangePreset;
  /** Start time in ISO format (only used for 'custom') */
  startTime?: string;
  /** End time in ISO format (only used for 'custom') */
  endTime?: string;
}

export interface TimeRangeState {
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
}

// ─── Time Range Store (persists across tab switches) ─────────────────────────

export const useTimeRangeStore = create<TimeRangeState>()(
  persist(
    (set) => ({
      timeRange: { preset: '1h' },
      setTimeRange: (range) => set({ timeRange: range }),
    }),
    {
      name: 'kubilitics-dashboard-time-range',
    }
  )
);

// ─── Preset Labels ───────────────────────────────────────────────────────────

const PRESET_OPTIONS: Array<{ value: TimeRangePreset; label: string; shortLabel: string }> = [
  { value: '15m', label: 'Last 15 minutes', shortLabel: '15m' },
  { value: '1h', label: 'Last 1 hour', shortLabel: '1h' },
  { value: '6h', label: 'Last 6 hours', shortLabel: '6h' },
  { value: '24h', label: 'Last 24 hours', shortLabel: '24h' },
  { value: '7d', label: 'Last 7 days', shortLabel: '7d' },
];

// ─── Utility: Get time range boundaries ──────────────────────────────────────

export function getTimeRangeBounds(range: TimeRange): { start: Date; end: Date } {
  const end = new Date();

  if (range.preset === 'custom' && range.startTime && range.endTime) {
    return { start: new Date(range.startTime), end: new Date(range.endTime) };
  }

  const durations: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  const duration = durations[range.preset] ?? durations['1h'];
  const start = new Date(end.getTime() - duration);

  return { start, end };
}

/**
 * Get the granularity for PromQL queries based on time range
 */
export function getStepForRange(range: TimeRange): string {
  switch (range.preset) {
    case '15m': return '15s';
    case '1h': return '1m';
    case '6h': return '5m';
    case '24h': return '15m';
    case '7d': return '1h';
    default: return '1m';
  }
}

// ─── Trend Arrow Component ───────────────────────────────────────────────────

export type TrendDirection = 'up' | 'down' | 'flat';

export function TrendArrow({
  direction,
  value,
  className,
}: {
  direction: TrendDirection;
  value?: string;
  className?: string;
}) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;
  const colorClass = direction === 'up'
    ? 'text-emerald-600 dark:text-emerald-400'
    : direction === 'down'
      ? 'text-red-600 dark:text-red-400'
      : 'text-slate-400 dark:text-slate-500';

  return (
    <span className={cn('inline-flex items-center gap-1', colorClass, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {value && <span className="text-xs font-medium">{value}</span>}
    </span>
  );
}

// ─── TimeRangeSelector Component ─────────────────────────────────────────────

export function TimeRangeSelector({ className }: { className?: string }) {
  const { timeRange, setTimeRange } = useTimeRangeStore();
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = PRESET_OPTIONS.find((opt) => opt.value === timeRange.preset);

  const handleSelect = useCallback(
    (preset: TimeRangePreset) => {
      setTimeRange({ preset });
      setIsOpen(false);
    },
    [setTimeRange]
  );

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium',
          'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
          'text-slate-700 dark:text-slate-300',
          'hover:bg-slate-50 dark:hover:bg-slate-700/60',
          'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40',
          'transition-all duration-200 shadow-sm'
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Time range: ${selectedOption?.label ?? 'Custom'}`}
      >
        <Clock className="h-4 w-4 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <span>{selectedOption?.shortLabel ?? 'Custom'}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-slate-400 dark:text-slate-500 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <>
          {/* Backdrop to close dropdown */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          <div
            className={cn(
              'absolute right-0 top-full mt-1 z-50 min-w-[180px]',
              'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
              'rounded-xl shadow-lg dark:shadow-slate-900/50',
              'py-1 overflow-hidden'
            )}
            role="listbox"
            aria-label="Select time range"
          >
            {PRESET_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors',
                  timeRange.preset === option.value
                    ? 'bg-primary/5 dark:bg-primary/10 text-primary font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                )}
                role="option"
                aria-selected={timeRange.preset === option.value}
              >
                <span>{option.label}</span>
                {timeRange.preset === option.value && (
                  <span className="text-primary text-xs font-bold">&#x2713;</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── useTimeRange Hook ───────────────────────────────────────────────────────

/**
 * Hook to access time range state and computed bounds.
 * Use this in Dashboard widgets to respect the selected time range.
 */
export function useTimeRange() {
  const { timeRange, setTimeRange } = useTimeRangeStore();
  const { start, end } = getTimeRangeBounds(timeRange);
  const step = getStepForRange(timeRange);

  return {
    timeRange,
    setTimeRange,
    start,
    end,
    step,
    /** Duration in milliseconds */
    durationMs: end.getTime() - start.getTime(),
    /** PromQL-compatible range string */
    promRange: timeRange.preset === 'custom' ? '1h' : timeRange.preset,
  };
}
