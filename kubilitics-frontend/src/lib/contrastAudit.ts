/**
 * WCAG 2.1 AA Contrast Audit Utilities
 *
 * Provides functions for:
 *   - Computing relative luminance per WCAG 2.1
 *   - Computing contrast ratio between two colors
 *   - Auditing common color combinations against AA thresholds
 *   - Generating structured audit reports
 */

// ─── Color Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a hex color string (#RGB, #RRGGBB, or #RRGGBBAA) into [r, g, b]
 * where each component is 0-255.
 */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, '');

  // Handle shorthand (#RGB)
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  // Handle #RRGGBBAA (ignore alpha)
  if (h.length === 8) {
    h = h.slice(0, 6);
  }

  const num = parseInt(h, 16);
  if (isNaN(num)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

/**
 * Convert an sRGB component (0-255) to its linear value.
 */
function sRGBtoLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// ─── WCAG Luminance & Contrast ──────────────────────────────────────────────

/**
 * Compute relative luminance per WCAG 2.1 definition.
 * Input: [r, g, b] where each is 0-255.
 * Output: luminance value between 0 (darkest) and 1 (lightest).
 */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(sRGBtoLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute the contrast ratio between two colors.
 * Per WCAG 2.1: ratio = (L1 + 0.05) / (L2 + 0.05)
 * where L1 is the lighter luminance and L2 is the darker.
 *
 * @returns Contrast ratio >= 1 (1:1 means identical, 21:1 is max).
 */
export function contrastRatio(
  color1: [number, number, number],
  color2: [number, number, number],
): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Compute contrast ratio from hex strings.
 */
export function contrastRatioHex(hex1: string, hex2: string): number {
  return contrastRatio(parseHex(hex1), parseHex(hex2));
}

// ─── WCAG AA Thresholds ─────────────────────────────────────────────────────

/** WCAG 2.1 AA requires 4.5:1 for normal text. */
export const WCAG_AA_NORMAL_TEXT = 4.5;

/** WCAG 2.1 AA requires 3:1 for large text (>=18pt or >=14pt bold). */
export const WCAG_AA_LARGE_TEXT = 3.0;

/** WCAG 2.1 AAA requires 7:1 for normal text. */
export const WCAG_AAA_NORMAL_TEXT = 7.0;

/** WCAG 2.1 AAA requires 4.5:1 for large text. */
export const WCAG_AAA_LARGE_TEXT = 4.5;

/** WCAG 2.1 AA requires 3:1 for UI components and graphical objects. */
export const WCAG_AA_UI_COMPONENT = 3.0;

// ─── WCAG Level Determination ───────────────────────────────────────────────

export type WCAGLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

/**
 * Determine the highest WCAG level a contrast ratio satisfies for normal text.
 */
export function getWCAGLevel(ratio: number): WCAGLevel {
  if (ratio >= WCAG_AAA_NORMAL_TEXT) return 'AAA';
  if (ratio >= WCAG_AA_NORMAL_TEXT) return 'AA';
  if (ratio >= WCAG_AA_LARGE_TEXT) return 'AA-large';
  return 'fail';
}

// ─── Audit Types ────────────────────────────────────────────────────────────

export type AuditStatus = 'pass' | 'warning' | 'fail';

export interface AuditResult {
  foreground: string;
  background: string;
  contrastRatio: number;
  wcagLevel: WCAGLevel;
  status: AuditStatus;
  elementDescription: string;
  normalTextPasses: boolean;
  largeTextPasses: boolean;
  uiComponentPasses: boolean;
}

export interface AuditReport {
  timestamp: string;
  totalChecks: number;
  passes: AuditResult[];
  warnings: AuditResult[];
  failures: AuditResult[];
  summary: {
    passRate: number;
    worstRatio: number;
    bestRatio: number;
    avgRatio: number;
  };
}

// ─── Audit Function ─────────────────────────────────────────────────────────

export interface ColorCombination {
  foreground: string;
  background: string;
  elementDescription: string;
}

/**
 * Audit a set of color combinations against WCAG 2.1 AA thresholds.
 * Returns a structured report with failures, warnings, and passes.
 */
export function auditColorCombinations(
  combinations: ColorCombination[],
): AuditReport {
  const results: AuditResult[] = combinations.map((combo) => {
    const ratio = contrastRatioHex(combo.foreground, combo.background);
    const wcagLevel = getWCAGLevel(ratio);
    const normalTextPasses = ratio >= WCAG_AA_NORMAL_TEXT;
    const largeTextPasses = ratio >= WCAG_AA_LARGE_TEXT;
    const uiComponentPasses = ratio >= WCAG_AA_UI_COMPONENT;

    let status: AuditStatus;
    if (normalTextPasses) {
      status = 'pass';
    } else if (largeTextPasses) {
      status = 'warning'; // Passes for large text only
    } else {
      status = 'fail';
    }

    return {
      foreground: combo.foreground,
      background: combo.background,
      contrastRatio: Math.round(ratio * 100) / 100,
      wcagLevel,
      status,
      elementDescription: combo.elementDescription,
      normalTextPasses,
      largeTextPasses,
      uiComponentPasses,
    };
  });

  const passes = results.filter((r) => r.status === 'pass');
  const warnings = results.filter((r) => r.status === 'warning');
  const failures = results.filter((r) => r.status === 'fail');
  const ratios = results.map((r) => r.contrastRatio);

  return {
    timestamp: new Date().toISOString(),
    totalChecks: results.length,
    passes,
    warnings,
    failures,
    summary: {
      passRate:
        results.length > 0
          ? Math.round((passes.length / results.length) * 100)
          : 0,
      worstRatio: Math.min(...ratios),
      bestRatio: Math.max(...ratios),
      avgRatio:
        ratios.length > 0
          ? Math.round(
              (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100,
            ) / 100
          : 0,
    },
  };
}

/**
 * Quick check: does a foreground/background hex pair pass WCAG AA for normal text?
 */
export function passesWCAGAA(
  foreground: string,
  background: string,
): boolean {
  return contrastRatioHex(foreground, background) >= WCAG_AA_NORMAL_TEXT;
}

/**
 * Suggest a lighter or darker variant of a color to meet a target contrast ratio
 * against a given background.
 */
export function suggestAccessibleColor(
  foreground: string,
  background: string,
  targetRatio: number = WCAG_AA_NORMAL_TEXT,
): string {
  const bgRGB = parseHex(background);
  const bgLum = relativeLuminance(bgRGB);

  // Determine if we need a lighter or darker foreground
  const fgRGB = parseHex(foreground);
  const fgLum = relativeLuminance(fgRGB);
  const needsLighter = fgLum > bgLum;

  // Binary search for an accessible shade
  let lo = 0;
  let hi = 255;

  for (let i = 0; i < 20; i++) {
    const mid = Math.round((lo + hi) / 2);
    const testRGB: [number, number, number] = needsLighter
      ? [
          Math.min(255, fgRGB[0] + mid),
          Math.min(255, fgRGB[1] + mid),
          Math.min(255, fgRGB[2] + mid),
        ]
      : [
          Math.max(0, fgRGB[0] - mid),
          Math.max(0, fgRGB[1] - mid),
          Math.max(0, fgRGB[2] - mid),
        ];

    const ratio = contrastRatio(testRGB, bgRGB);

    if (ratio >= targetRatio) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  const finalOffset = hi;
  const finalRGB: [number, number, number] = needsLighter
    ? [
        Math.min(255, fgRGB[0] + finalOffset),
        Math.min(255, fgRGB[1] + finalOffset),
        Math.min(255, fgRGB[2] + finalOffset),
      ]
    : [
        Math.max(0, fgRGB[0] - finalOffset),
        Math.max(0, fgRGB[1] - finalOffset),
        Math.max(0, fgRGB[2] - finalOffset),
      ];

  return `#${finalRGB.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
