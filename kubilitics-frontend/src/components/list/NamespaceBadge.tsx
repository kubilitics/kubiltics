import { cn } from '@/lib/utils';

const PALETTE_SIZE = 12;

/** Stable hash for namespace name → index 0..PALETTE_SIZE-1 (djb2). */
function hashNamespace(name: string): number {
  if (!name) return 0;
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h) + name.charCodeAt(i);
  }
  return Math.abs(h) % PALETTE_SIZE;
}

/**
 * 12 color variants: light bg + border + text that work in light and dark mode.
 * Same namespace always gets the same color.
 */
const NAMESPACE_COLORS: string[] = [
  'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-200',
  'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200',
  'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
  'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-200',
  'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-200',
  'border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200',
  'border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-200',
  'border-indigo-300 bg-indigo-100 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200',
  'border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-200',
  'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-700 dark:bg-fuchsia-950/50 dark:text-fuchsia-200',
  'border-lime-300 bg-lime-100 text-lime-800 dark:border-lime-700 dark:bg-lime-950/50 dark:text-lime-200',
  'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-200',
];

export interface NamespaceBadgeProps {
  /** Namespace name; used to pick a stable color from the 12-color palette. */
  namespace: string;
  className?: string;
}

/**
 * Single source for namespace badges: stable color per namespace (hash of name),
 * consistent look across all list and detail pages.
 */
export function NamespaceBadge({ namespace, className }: NamespaceBadgeProps) {
  const index = hashNamespace(namespace ?? '');
  const colorClass = NAMESPACE_COLORS[index];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        colorClass,
        className
      )}
      title={namespace ? `Namespace: ${namespace}` : undefined}
    >
      {namespace ?? '—'}
    </span>
  );
}
