import { cn } from '@/lib/utils';
import { Filter, EyeOff } from 'lucide-react';

interface FilterIndicatorProps {
  depth: number;
  maxDepth: number;
  viewMode: string;
  selectedNamespaces: string[];
  totalNamespaces: number;
  visibleNodeCount: number;
  totalNodeCount: number;
  truncated?: boolean;
}

export function FilterIndicator({
  depth,
  maxDepth,
  viewMode,
  selectedNamespaces,
  totalNamespaces,
  visibleNodeCount,
  totalNodeCount,
  truncated,
}: FilterIndicatorProps) {
  const filters: string[] = [];

  if (depth < maxDepth) {
    filters.push(`Depth ${depth}/${maxDepth}`);
  }
  if (viewMode !== 'cluster') {
    filters.push(`View: ${viewMode}`);
  }
  if (selectedNamespaces.length > 0 && selectedNamespaces.length < totalNamespaces) {
    filters.push(`${selectedNamespaces.length}/${totalNamespaces} namespaces`);
  }
  if (truncated) {
    filters.push('Truncated');
  }

  const hiddenCount = totalNodeCount - visibleNodeCount;

  if (filters.length === 0 && hiddenCount === 0) return null;

  return (
    <div className={cn(
      "flex items-center gap-2 px-4 py-1.5 text-xs",
      "bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800",
      "text-slate-500 dark:text-slate-400"
    )}>
      <Filter className="h-3 w-3" />
      {filters.map((f, i) => (
        <span key={i} className={cn(
          "px-2 py-0.5 rounded-full",
          "bg-slate-200 dark:bg-slate-700",
          "text-slate-600 dark:text-slate-300"
        )}>
          {f}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className={cn(
          "px-2 py-0.5 rounded-full",
          "bg-blue-100 dark:bg-blue-900/30",
          "text-blue-600 dark:text-blue-400"
        )}>
          <EyeOff className="h-3 w-3 inline mr-1" />
          {hiddenCount} resources hidden
        </span>
      )}
    </div>
  );
}
