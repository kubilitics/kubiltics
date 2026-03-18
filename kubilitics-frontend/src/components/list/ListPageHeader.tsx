import { RefreshCw, Loader2, Plus, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DataFreshnessIndicator } from './DataFreshnessIndicator';

export interface ListPageHeaderProps {
  /** Resource icon (e.g. from KubernetesIcons), rendered in a rounded container */
  icon: React.ReactNode;
  /** Page title (e.g. "Deployments", "ConfigMaps") */
  title: string;
  /** Live resource count shown as a badge next to the title */
  resourceCount: number;
  /** Optional subtitle (e.g. "across 5 namespaces", "Cluster-scoped") */
  subtitle?: string;
  /** When true, appends "Demo mode" / "Connect cluster" hint to subtitle */
  demoMode?: boolean;
  /** Refetch in progress – Refresh button shows spinner */
  isLoading?: boolean;
  /** Called when Refresh is clicked */
  onRefresh: () => void;
  /** Create button label (e.g. "Create Deployment"). Omit or empty to hide Create. */
  createLabel?: string | null;
  /** Called when Create is clicked */
  onCreate?: () => void;
  /** Actions between Export/Delete and Refresh (e.g. ResourceExportDropdown, Delete selected button) */
  actions?: React.ReactNode;
  /** Optional Columns visibility dropdown (right of Refresh, left of Create) */
  columnsDropdown?: React.ReactNode;
  /** Optional extra content on the left (e.g. "N selected" + Clear when items selected) */
  leftExtra?: React.ReactNode;
  /** PERF Area 5: Optional data freshness indicator node (e.g. DataFreshnessIndicator) */
  freshness?: React.ReactNode;
  /** PERF Area 5: Timestamp (ms) of last data update — auto-renders freshness indicator */
  dataUpdatedAt?: number;
  className?: string;
}

/**
 * Standard list page header: icon, title, live resource count badge,
 * Refresh (with loading spinner), and optional Create button.
 * Use `actions` for Export dropdown and Delete selected.
 */
export function ListPageHeader({
  icon,
  title,
  resourceCount,
  subtitle,
  demoMode,
  isLoading = false,
  onRefresh,
  createLabel,
  onCreate,
  actions,
  columnsDropdown,
  leftExtra,
  freshness,
  dataUpdatedAt,
  className,
}: ListPageHeaderProps) {
  // Render freshness: prefer explicit freshness node, fall back to auto from dataUpdatedAt
  const freshnessNode = freshness ?? (dataUpdatedAt ? <DataFreshnessIndicator dataUpdatedAt={dataUpdatedAt} /> : null);

  return (
    <div className={cn('flex items-center justify-between flex-wrap gap-4 elevation-1', className)}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {resourceCount}
            </Badge>
          </div>
          {(subtitle != null || demoMode) && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {subtitle}
              {demoMode && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                  <WifiOff className="h-3 w-3" /> Connect cluster
                </span>
              )}
            </p>
          )}
        </div>
        {leftExtra != null && leftExtra}
        {freshnessNode != null && freshnessNode}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 press-effect"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        {columnsDropdown}
        {createLabel && onCreate && (
          <Button className="gap-2 press-effect" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            {createLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
