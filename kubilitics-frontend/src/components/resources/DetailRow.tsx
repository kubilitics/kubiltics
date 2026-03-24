import type { LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface DetailRowProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tooltip?: string | React.ReactNode;
  className?: string;
  /** If true, wrap only the value in the tooltip trigger; otherwise wrap the whole row. */
  tooltipOnValue?: boolean;
  /** If true, show a subtle highlight (e.g. for warnings). */
  highlight?: boolean;
}

/**
 * A single property row with clear visual hierarchy:
 * - Label: uppercase, small, muted — acts as a category label
 * - Value: prominent, bold, dark — the data that matters
 * - Stacked layout within each grid cell for better readability
 */
export function DetailRow({
  label,
  value,
  icon: Icon,
  tooltip,
  className,
  tooltipOnValue = true,
  highlight,
}: DetailRowProps) {
  const labelEl = (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </span>
  );

  const valueEl = (
    <span className={cn(
      'text-sm font-semibold text-foreground break-all',
      highlight && 'text-amber-600 dark:text-amber-400',
    )}>
      {value}
    </span>
  );

  const content = (
    <div className={cn('flex flex-col gap-0.5 py-2 border-b border-border/30 last:border-0', className)}>
      {labelEl}
      {valueEl}
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {tooltipOnValue ? (
            <div className={cn('flex flex-col gap-0.5 py-2 border-b border-border/30 last:border-0', className)}>
              {labelEl}
              <span className={cn(
                'text-sm font-semibold text-foreground break-all cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2',
                highlight && 'text-amber-600 dark:text-amber-400',
              )}>
                {value}
              </span>
            </div>
          ) : (
            <span className="cursor-help block">
              {content}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {typeof tooltip === 'string' ? tooltip : tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
