import { SearchX, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * P0-004-T04: Resource Not Found with Fuzzy Suggestions
 *
 * When a resource is not found (404), shows:
 * 1. Clear "not found" message
 * 2. Fuzzy-matched suggestions from similar resources
 * 3. Clickable links to each suggestion
 * 4. Option to view last known state for deleted resources
 */

interface ResourceSuggestion {
  name: string;
  namespace?: string;
  kind: string;
  link: string;
  /** 0-1 similarity score for ranking */
  score?: number;
}

interface ResourceNotFoundErrorProps {
  /** The resource kind that was requested */
  kind?: string;
  /** The resource name that was requested */
  name?: string;
  /** The namespace that was checked */
  namespace?: string;
  /** Similar resources found by fuzzy matching */
  suggestions?: ResourceSuggestion[];
  /** When the resource was last seen (for deleted resources) */
  deletedAt?: string;
  /** Callback to view last known state */
  onViewLastKnown?: () => void;
  className?: string;
}

/**
 * Levenshtein distance for fuzzy matching resource names.
 * Returns a value between 0 and max(a.length, b.length).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const d: number[][] = Array.from({ length: la + 1 }, () => Array(lb + 1).fill(0));

  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[la][lb];
}

export function ResourceNotFoundError({
  kind = 'Resource',
  name = 'unknown',
  namespace,
  suggestions = [],
  deletedAt,
  onViewLastKnown,
  className,
}: ResourceNotFoundErrorProps) {
  const topSuggestions = suggestions.slice(0, 3);

  return (
    <div className={cn('rounded-xl border border-border bg-card/50 dark:bg-card/30 p-8 max-w-lg mx-auto text-center', className)}>
      <div className="inline-flex p-4 rounded-2xl bg-muted/50 dark:bg-muted/20 mb-6">
        <SearchX className="h-10 w-10 text-muted-foreground/60" />
      </div>

      <h2 className="text-xl font-bold text-foreground mb-2">{kind} Not Found</h2>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{name}</code>
        {namespace && (
          <>
            {' '}in namespace{' '}
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{namespace}</code>
          </>
        )}{' '}
        {deletedAt ? `was deleted ${deletedAt}` : 'could not be found'}.
      </p>

      {/* Deleted resource — view last known state */}
      {deletedAt && onViewLastKnown && (
        <button
          onClick={onViewLastKnown}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors mb-6"
        >
          View last known state
          <ArrowRight className="h-4 w-4" />
        </button>
      )}

      {/* Fuzzy suggestions */}
      {topSuggestions.length > 0 && (
        <div className="text-left">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Did you mean?
          </p>
          <div className="space-y-2">
            {topSuggestions.map((s) => (
              <Link
                key={`${s.kind}-${s.namespace}-${s.name}`}
                to={s.link}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/60 bg-background hover:bg-muted/40 hover:border-border transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {s.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.kind}
                    {s.namespace && <> · {s.namespace}</>}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
