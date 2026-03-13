import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableEmptyStateProps {
  /** Resource-specific icon (e.g. from KubernetesIcons or lucide-react) */
  icon: ReactNode;
  /** Title, e.g. "No Deployments found" */
  title: string;
  /** Optional subtitle for context, e.g. "No deployments in this namespace" or "Clear filters to see resources" */
  subtitle?: ReactNode;
  /** Show "Clear filters" button when user has active search/filters */
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** When creation is supported: label for the create button, e.g. "Create Deployment" */
  createLabel?: string;
  /** When creation is supported: opens ResourceCreator or create flow */
  onCreate?: () => void;
  className?: string;
}

/**
 * Standard empty state for list page tables. Use when the table has no rows to display.
 * Shows resource icon, title, optional subtitle, optional "Clear filters", and optional "Create" button.
 * Apple-level UX with slide-up animation, accessible semantics, and prominent actions.
 */
export function TableEmptyState({
  icon,
  title,
  subtitle,
  hasActiveFilters,
  onClearFilters,
  createLabel,
  onCreate,
  className,
}: TableEmptyStateProps) {
  const ariaLabel = hasActiveFilters
    ? `${title}. Clear filters to see resources`
    : title;

  return (
    <div
      className={cn('empty-state animate-slide-up', className)}
      role="status"
      aria-label={ariaLabel}
    >
      <div className="empty-state-icon [&>svg]:h-8 [&>svg]:w-8 [&>svg]:opacity-70 text-muted-foreground">
        {icon}
      </div>
      <div className="space-y-2">
        <h3 className="empty-state-title">{title}</h3>
        {subtitle && <p className="empty-state-description">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
        {hasActiveFilters && onClearFilters && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 press-effect"
            onClick={onClearFilters}
            aria-label="Clear active filters"
          >
            Clear filters
          </Button>
        )}
        {createLabel && onCreate && (
          <Button
            size="sm"
            className="gap-2 press-effect"
            onClick={onCreate}
            aria-label={`Create new ${createLabel.toLowerCase()}`}
          >
            <Plus className="h-4 w-4" />
            {createLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
