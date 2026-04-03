/**
 * Stat — Label + value + optional delta badge.
 * Matches the prototype's Stat() function used in NamespaceHeatmap hover detail.
 */

interface StatProps {
  label: string;
  value: number | string;
  color?: string;
  delta?: number;
}

export function Stat({ label, value, color, delta }: StatProps) {
  return (
    <div className="text-center">
      <div
        className="text-lg font-bold tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-[#64748b]">
        {label}
      </div>
      {delta !== undefined && delta !== 0 && (
        <div
          className="text-[10px] font-semibold tabular-nums mt-0.5"
          style={{
            color: delta < 0 ? '#ef4444' : '#22c55e',
          }}
        >
          {delta > 0 ? '+' : ''}
          {delta}
        </div>
      )}
    </div>
  );
}
