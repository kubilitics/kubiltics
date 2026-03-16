/**
 * RTL (Right-to-Left) Support Utilities
 *
 * Provides:
 *   - RTL detection based on document lang attribute and locale
 *   - Direction-aware CSS class generation
 *   - Logical property helpers (margin-inline-start vs margin-left)
 *   - Utility for flipping directional values
 */

// ─── RTL Language Detection ─────────────────────────────────────────────────

/**
 * Known RTL language codes (ISO 639-1 or BCP 47 tags).
 */
export const RTL_LANGUAGES = new Set([
  'ar',    // Arabic
  'he',    // Hebrew
  'fa',    // Persian/Farsi
  'ur',    // Urdu
  'ps',    // Pashto
  'sd',    // Sindhi
  'yi',    // Yiddish
  'ku',    // Kurdish (Sorani)
  'ckb',   // Central Kurdish
  'dv',    // Divehi/Maldivian
  'ug',    // Uyghur
  'arc',   // Aramaic
  'syr',   // Syriac
]);

/**
 * Detect if a locale/language code is RTL.
 * Handles full BCP 47 tags (e.g. "ar-SA", "he-IL") by checking the primary subtag.
 */
export function isRTLLanguage(lang: string): boolean {
  const primary = lang.split('-')[0].toLowerCase();
  return RTL_LANGUAGES.has(primary);
}

/**
 * Detect the current document direction by checking:
 *   1. The `dir` attribute on <html> or <body>
 *   2. The `lang` attribute on <html>
 *   3. The CSS computed direction of the body
 *
 * Returns 'rtl' or 'ltr'.
 */
export function detectDirection(): 'rtl' | 'ltr' {
  if (typeof document === 'undefined') return 'ltr';

  // 1. Check explicit dir attribute
  const htmlDir = document.documentElement.getAttribute('dir');
  if (htmlDir === 'rtl' || htmlDir === 'ltr') return htmlDir;

  const bodyDir = document.body?.getAttribute('dir');
  if (bodyDir === 'rtl' || bodyDir === 'ltr') return bodyDir;

  // 2. Check lang attribute
  const lang = document.documentElement.getAttribute('lang');
  if (lang && isRTLLanguage(lang)) return 'rtl';

  // 3. Check computed style
  if (document.body) {
    const computed = getComputedStyle(document.body).direction;
    if (computed === 'rtl') return 'rtl';
  }

  return 'ltr';
}

/**
 * Set the document direction explicitly.
 * Updates the `dir` attribute on <html>.
 */
export function setDirection(dir: 'rtl' | 'ltr'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('dir', dir);
}

// ─── Direction-Aware CSS Class Generator ────────────────────────────────────

export type Direction = 'rtl' | 'ltr';

/**
 * Generate direction-aware CSS classes. Maps physical directional classes
 * to their logical equivalents based on the current direction.
 *
 * @example
 * ```ts
 * const cls = directionClass('ltr', { start: 'ml-4', end: 'mr-4' });
 * // Returns 'ml-4 mr-4' for LTR
 * // Returns 'mr-4 ml-4' for RTL (swapped)
 * ```
 */
export function directionClass(
  dir: Direction,
  classes: { start: string; end: string },
): string {
  if (dir === 'rtl') {
    return `${classes.end} ${classes.start}`;
  }
  return `${classes.start} ${classes.end}`;
}

/**
 * Map physical Tailwind classes to their RTL-aware equivalents.
 * Uses Tailwind's `rtl:` prefix when available.
 */
export function rtlAwareClass(
  ltrClass: string,
  rtlClass: string,
): string {
  return `${ltrClass} rtl:${rtlClass}`;
}

/**
 * Generate a Tailwind class string that uses logical properties for spacing.
 * Converts physical directions (left/right) to logical (start/end).
 */
export function logicalSpacing(
  property: 'margin' | 'padding',
  side: 'start' | 'end' | 'inline',
  value: string,
): string {
  const prefix = property === 'margin' ? 'm' : 'p';

  switch (side) {
    case 'start':
      return `${prefix}s-${value}`;
    case 'end':
      return `${prefix}e-${value}`;
    case 'inline':
      return `${prefix}s-${value} ${prefix}e-${value}`;
  }
}

// ─── Logical Property Helpers ───────────────────────────────────────────────

/**
 * CSS logical property equivalents for common physical properties.
 * These work natively in modern browsers without JS transformation.
 */
export const LOGICAL_PROPERTIES = {
  // Margin
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',

  // Padding
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',

  // Border
  'border-left': 'border-inline-start',
  'border-right': 'border-inline-end',
  'border-left-width': 'border-inline-start-width',
  'border-right-width': 'border-inline-end-width',
  'border-left-color': 'border-inline-start-color',
  'border-right-color': 'border-inline-end-color',

  // Positioning
  'left': 'inset-inline-start',
  'right': 'inset-inline-end',

  // Border radius
  'border-top-left-radius': 'border-start-start-radius',
  'border-top-right-radius': 'border-start-end-radius',
  'border-bottom-left-radius': 'border-end-start-radius',
  'border-bottom-right-radius': 'border-end-end-radius',

  // Text alignment
  'text-align: left': 'text-align: start',
  'text-align: right': 'text-align: end',
} as const;

/**
 * Convert a physical CSS property to its logical equivalent.
 * Returns the original property if no logical equivalent exists.
 */
export function toLogicalProperty(physicalProperty: string): string {
  return (
    LOGICAL_PROPERTIES[physicalProperty as keyof typeof LOGICAL_PROPERTIES] ??
    physicalProperty
  );
}

/**
 * Tailwind CSS class mapping: physical → logical.
 * Use these in components instead of directional classes.
 */
export const TAILWIND_LOGICAL_MAP: Record<string, string> = {
  // Margin
  'ml-': 'ms-',
  'mr-': 'me-',
  // Padding
  'pl-': 'ps-',
  'pr-': 'pe-',
  // Border
  'border-l-': 'border-s-',
  'border-r-': 'border-e-',
  // Border radius
  'rounded-l-': 'rounded-s-',
  'rounded-r-': 'rounded-e-',
  'rounded-tl-': 'rounded-ss-',
  'rounded-tr-': 'rounded-se-',
  'rounded-bl-': 'rounded-es-',
  'rounded-br-': 'rounded-ee-',
  // Position
  'left-': 'start-',
  'right-': 'end-',
  // Text alignment
  'text-left': 'text-start',
  'text-right': 'text-end',
  // Scroll
  'scroll-ml-': 'scroll-ms-',
  'scroll-mr-': 'scroll-me-',
  'scroll-pl-': 'scroll-ps-',
  'scroll-pr-': 'scroll-pe-',
};

/**
 * Convert a physical Tailwind class to its logical equivalent.
 * E.g., "ml-4" → "ms-4", "pl-2" → "ps-2"
 */
export function toLogicalTailwind(physicalClass: string): string {
  for (const [physical, logical] of Object.entries(TAILWIND_LOGICAL_MAP)) {
    if (physicalClass.startsWith(physical)) {
      return physicalClass.replace(physical, logical);
    }
    if (physicalClass === physical.replace('-', '')) {
      return logical.replace('-', '');
    }
  }
  return physicalClass;
}

/**
 * Flip a transform value for RTL (e.g., translateX(10px) → translateX(-10px)).
 */
export function flipTransformX(value: number, dir: Direction): number {
  return dir === 'rtl' ? -value : value;
}
