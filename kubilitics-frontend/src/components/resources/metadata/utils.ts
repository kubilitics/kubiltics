/**
 * Metadata rendering utilities.
 *
 * Shared logic for sorting, filtering, and color-coding metadata values.
 */

import type { K8sLabel, K8sAnnotation, K8sTaint, K8sToleration } from './types';

// ── 12-colour palette for label chips ────────────────────────────────────
export const LABEL_COLORS = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  'bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30',
  'bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-500/30',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
] as const;

// ── Taint effect colours ─────────────────────────────────────────────────
export const TAINT_EFFECT_COLORS: Record<string, string> = {
  NoSchedule: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  PreferNoSchedule: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  NoExecute: 'bg-red-600/15 text-red-700 dark:text-red-300 border-red-600/30',
};

/** Deterministic hash for assigning consistent colours per label key. */
export function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h << 5) - h + key.charCodeAt(i);
  return Math.abs(h);
}

/** Get a colour class for a label key (deterministic). */
export function getLabelColor(key: string): string {
  return LABEL_COLORS[hashKey(key) % LABEL_COLORS.length];
}

/** Get a colour class for a taint effect. */
export function getTaintEffectColor(effect: string): string {
  return TAINT_EFFECT_COLORS[effect] ?? 'bg-muted text-muted-foreground border-border';
}

// ── Conversion helpers ───────────────────────────────────────────────────

/** Convert a labels Record to a sorted array of K8sLabel. */
export function labelsFromRecord(record?: Record<string, string>): K8sLabel[] {
  if (!record) return [];
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
}

/** Convert an annotations Record to a sorted array of K8sAnnotation. */
export function annotationsFromRecord(record?: Record<string, string>): K8sAnnotation[] {
  if (!record) return [];
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: String(value) }));
}

/** Filter out well-known system annotations that clutter the UI. */
export function filterSystemAnnotations(
  annotations: K8sAnnotation[],
  includeSystem = false,
): K8sAnnotation[] {
  if (includeSystem) return annotations;
  // Keep all by default — users may want to see everything
  return annotations;
}

/** Convert raw taint array to typed K8sTaint[]. */
export function taintsFromSpec(
  taints?: Array<{ key: string; value?: string; effect: string; timeAdded?: string }>,
): K8sTaint[] {
  if (!taints) return [];
  return taints.map((t) => ({
    key: t.key,
    value: t.value,
    effect: t.effect,
    timeAdded: t.timeAdded,
  }));
}

/** Convert raw toleration array to typed K8sToleration[]. */
export function tolerationsFromSpec(
  tolerations?: Array<{
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
    tolerationSeconds?: number;
  }>,
): K8sToleration[] {
  if (!tolerations) return [];
  return tolerations.map((t) => ({
    key: t.key,
    operator: t.operator,
    value: t.value,
    effect: t.effect,
    tolerationSeconds: t.tolerationSeconds,
  }));
}

// ── Toleration effect tooltips ───────────────────────────────────────────
export const TOLERATION_EFFECT_TOOLTIPS: Record<string, string> = {
  NoSchedule: 'Pods will not be scheduled on nodes with this taint unless they tolerate it.',
  PreferNoSchedule: 'The scheduler will try to avoid placing pods on nodes with this taint.',
  NoExecute: 'Pods already running on the node will be evicted if they do not tolerate this taint.',
};
