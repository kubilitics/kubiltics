/**
 * Design tokens for the Simulation Visual System.
 * Extracted from the JSX prototype and design spec.
 * Uses Tailwind-compatible hex values.
 */

/* ── Surface & text colors ──────────────────────────────────────── */

export const COLORS = {
  /** Near-black, high contrast base */
  bg: '#0f1117',
  /** Elevated surface */
  card: '#1a1d27',
  /** Interactive hover state */
  cardHover: '#22253a',
  /** Subtle separation */
  border: '#2a2d3a',

  /** Primary text — high contrast */
  text: '#e2e8f0',
  /** Secondary text */
  textMuted: '#94a3b8',
  /** Tertiary text — labels */
  textDim: '#64748b',

  /** Accent / highlight */
  accent: '#8b5cf6',
} as const;

/* ── Severity palette ───────────────────────────────────────────── */

export const SEVERITY_COLORS = {
  critical: '#ef4444',
  criticalBg: '#451a1a',
  high: '#f97316',
  highBg: '#452a1a',
  medium: '#eab308',
  mediumBg: '#3d3a1a',
  low: '#22c55e',
  lowBg: '#1a3a2a',
  info: '#3b82f6',
  infoBg: '#1a2a45',
  safe: '#22c55e',
} as const;

/* ── Status palette ─────────────────────────────────────────────── */

export const STATUS_COLORS = {
  removed: '#ef4444',
  unreachable: '#ef4444',
  degraded: '#eab308',
  added: '#22c55e',
  modified: '#f97316',
} as const;

/* ── Wave colors (impact cascade rings) ─────────────────────────── */

export const WAVE_COLORS = [
  '#ef4444', // Wave 0 — critical red
  '#f97316', // Wave 1 — high orange
  '#eab308', // Wave 2 — medium yellow
  '#3b82f6', // Wave 3+ — info blue
] as const;

/* ── Typography ─────────────────────────────────────────────────── */

export const FONTS = {
  family: "'Inter', system-ui, sans-serif",
  /** Component titles */
  titleSize: 20,
  /** Subtitles */
  subtitleSize: 13,
  /** Data labels */
  labelSize: 12,
  /** Auxiliary / fine print */
  auxSize: 10,
  /** Large hero numbers */
  heroSize: 28,
} as const;

/* ── Component dimensions ───────────────────────────────────────── */

export const SIZES = {
  /** Component container padding */
  containerPad: 24,
  /** Component container border-radius */
  containerRadius: 12,
  /** Ring SVG viewport */
  ringViewBox: 340,
  /** SVG center coordinate */
  ringCenter: 170,
  /** Center origin circle radius */
  ringOriginRadius: 24,
  /** Base ring radius (wave 0) */
  ringBaseRadius: 40,
  /** Distance between rings */
  ringGap: 52,
  /** Selected ring stroke width */
  ringStrokeSelected: 42,
  /** Unselected ring stroke width */
  ringStrokeDefault: 36,
  /** Namespace heatmap min block width */
  heatmapMinW: 80,
  /** Namespace heatmap min block height */
  heatmapMinH: 60,
  /** Namespace heatmap width scale factor */
  heatmapScaleW: 52,
  /** Namespace heatmap height scale factor */
  heatmapScaleH: 42,
  /** Waterfall dimension name column */
  waterfallNameCol: 160,
  /** Waterfall before score column */
  waterfallBeforeCol: 40,
  /** Waterfall delta column */
  waterfallDeltaCol: 60,
  /** Radar chart width */
  radarW: 360,
  /** Radar chart height */
  radarH: 300,
  /** AutoPilot scatter SVG width */
  scatterW: 500,
  /** AutoPilot scatter SVG height */
  scatterH: 300,
  /** AutoPilot dot default radius */
  dotRadius: 8,
  /** AutoPilot dot hover radius */
  dotRadiusHover: 12,
} as const;

/* ── Severity Y positions for the scatter plot ──────────────────── */

export const SEVERITY_Y: Record<string, number> = {
  critical: 20,
  high: 100,
  medium: 180,
  low: 260,
};

/* ── Helper: pick severity color from a string key ──────────────── */

export function severityColor(
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'safe',
): string {
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
}

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';
export type StatusType = 'removed' | 'unreachable' | 'degraded';
