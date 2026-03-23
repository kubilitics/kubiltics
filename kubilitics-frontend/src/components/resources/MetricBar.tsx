import { parseCpu, parseMemory } from './UsageBar';

interface MetricBarProps {
  value: string;
  kind: 'cpu' | 'memory';
  max?: number;
}

/** Default maximums when no resource limits and no dynamic max provided */
const CPU_FALLBACK = 1000;  // 1 core
const MEM_FALLBACK = 1024;  // 1 Gi

/**
 * MetricBar — Clean, consistent CPU/Memory bar for table cells.
 *
 * 52px colored bar + value text. Color-coded green→amber→orange→red.
 * Hover tooltip shows usage / limit (percentage).
 * No sparklines, no animations beyond smooth transitions.
 */
export function MetricBar({ value, kind, max }: MetricBarProps) {
  const isCpu = kind === 'cpu';
  const val = isCpu ? parseCpu(value) : parseMemory(value);
  const maxVal = max ?? (isCpu ? CPU_FALLBACK : MEM_FALLBACK);
  const hasLimit = max !== undefined;
  const ratio = val !== null && maxVal > 0 ? Math.min(val / maxVal, 1) : 0;
  const pct = Math.round(ratio * 100);

  const barColor = ratio < 0.4
    ? (isCpu ? '#10b981' : '#3b82f6')
    : ratio < 0.7 ? '#f59e0b'
    : ratio < 0.9 ? '#f97316'
    : '#ef4444';

  let display: string;
  if (val === null) {
    display = '-';
  } else if (isCpu) {
    display = val >= 1000 ? `${(val / 1000).toFixed(1)} cores` : `${val.toFixed(1)}m`;
  } else {
    display = val >= 1024 ? `${(val / 1024).toFixed(1)} Gi` : `${val.toFixed(0)} Mi`;
  }

  let limitDisplay: string;
  if (!hasLimit) {
    limitDisplay = 'no limit';
  } else if (isCpu) {
    limitDisplay = maxVal >= 1000 ? `${(maxVal / 1000).toFixed(1)} cores` : `${maxVal}m`;
  } else {
    limitDisplay = maxVal >= 1024 ? `${(maxVal / 1024).toFixed(1)} Gi` : `${maxVal.toFixed(0)} Mi`;
  }

  const tooltip = `${isCpu ? 'CPU' : 'Memory'}: ${display} / ${limitDisplay} (${pct}% used)`;

  return (
    <div className="flex items-center gap-2" title={tooltip}>
      <div className="w-[52px] shrink-0">
        <div className="h-[5px] rounded-full bg-gray-200/80 dark:bg-gray-700/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${Math.max(pct, val !== null && val > 0 ? 4 : 0)}%`,
              background: barColor,
            }}
          />
        </div>
      </div>
      <span className="text-[11px] font-medium tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {display}
      </span>
    </div>
  );
}
