/**
 * Semantic color tokens for use in JS/TS contexts where Tailwind classes
 * cannot be used (e.g. Recharts props, SVG attributes, inline styles).
 *
 * These map 1:1 to Tailwind palette classes:
 *   K8S_BLUE  → blue-600   (use `text-blue-600`, `bg-blue-600`, etc. in JSX)
 *   TERM_BG   → slate-950  (use `bg-slate-950` in JSX)
 *
 * Design rule: NO inline hex colors in Tailwind classes.
 */

/** Kubernetes brand blue — equivalent to Tailwind `blue-600` */
export const K8S_BLUE = "#2563eb";

/** Terminal / dark background — equivalent to Tailwind `slate-950` */
export const TERM_BG = "#020617";
