import type { ResizableColumnConfig } from '@/components/ui/resizable-table';

interface EstimateWidthOptions {
  /** Minimum width in pixels (defaults to column minWidth or 80). */
  minPx?: number;
  /** Maximum width in pixels (defaults to 400). */
  maxPx?: number;
  /** Base padding in pixels added regardless of content length (defaults to 48). */
  basePx?: number;
  /** Pixels per character used to approximate text width (defaults to 7). */
  pxPerChar?: number;
}

/**
 * Estimate a sensible column width based on sampled cell values.
 * This is a heuristic that keeps tables compact while avoiding
 * unreadable truncation for common cases.
 */
export function estimateTextColumnWidth(
  values: Array<string | number | null | undefined>,
  options: EstimateWidthOptions = {},
): number {
  const {
    minPx = 80,
    maxPx = 400,
    basePx = 48,
    pxPerChar = 7,
  } = options;

  let maxLen = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = typeof v === 'string' ? v : String(v);
    const len = s.length;
    if (len > maxLen) maxLen = len;
  }

  // Fallback to a modest default when we have no data.
  if (maxLen === 0) {
    return Math.min(Math.max(minPx, 140), maxPx);
  }

  const raw = basePx + pxPerChar * maxLen;
  return Math.min(Math.max(minPx, raw), maxPx);
}

/**
 * Build a ResizableColumnConfig array whose defaultWidth values are
 * derived from actual table data. User-resized widths stored in
 * localStorage (handled by ResizableTableProvider) still take precedence.
 *
 * - T is the row type (e.g. Pod, ConfigMap).
 * - rows: the current items (ideally filtered+sorted) used for sizing.
 * - valueGetters: map from columnId to a function that returns the
 *   value rendered in that column for a given row.
 */
export function buildAutoWidthColumns<T>(
  baseConfig: ResizableColumnConfig[],
  rows: T[],
  valueGetters: Record<string, (row: T) => unknown>,
  options?: { sampleSize?: number; perColumn?: Partial<Record<string, EstimateWidthOptions>> },
): ResizableColumnConfig[] {
  if (!rows.length) return baseConfig;

  const sampleSize = options?.sampleSize ?? 200;
  const sample = rows.slice(0, sampleSize);

  return baseConfig.map((col) => {
    const getter = valueGetters[col.id];
    if (!getter) return col;

    const values: Array<string | number | null | undefined> = [];
    for (const row of sample) {
      try {
        const v = getter(row);
        values.push(v as unknown as string | number | null | undefined);
      } catch {
        // ignore individual row failures
      }
    }

    const perColumnOpts = options?.perColumn?.[col.id];
    const estimated = estimateTextColumnWidth(values, {
      minPx: col.minWidth ?? perColumnOpts?.minPx ?? 80,
      maxPx: perColumnOpts?.maxPx ?? 400,
      basePx: perColumnOpts?.basePx ?? 48,
      pxPerChar: perColumnOpts?.pxPerChar ?? 7,
    });

    return {
      ...col,
      defaultWidth: estimated,
    };
  });
}

