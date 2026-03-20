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
}

/**
 * A single property row: label (and optional icon) on the left, value on the right.
 * When tooltip is set, the value (or row) is wrapped in a Tooltip so every property can be insightful.
 */
export function DetailRow({
  label,
  value,
  icon: Icon,
  tooltip,
  className,
  tooltipOnValue = true,
}: DetailRowProps) {
  const content = (
    <div className={cn('flex items-center justify-between gap-4 text-sm', className)}>
      <span className="flex items-center gap-2 text-muted-foreground shrink-0">
        {Icon && <Icon className="h-4 w-4" />}
        {label}
      </span>
      <span className="font-medium text-right break-all min-w-0">{value}</span>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {tooltipOnValue ? (
            <div className={cn('flex items-center justify-between gap-4 text-sm', className)}>
              <span className="flex items-center gap-2 text-muted-foreground shrink-0">
                {Icon && <Icon className="h-4 w-4" />}
                {label}
              </span>
              <span className="font-medium text-right break-all min-w-0 cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2">
                {value}
              </span>
            </div>
          ) : (
            <span className="cursor-help block [&>*]:underline [&>*]:decoration-dotted [&>*]:decoration-muted-foreground [&>*]:underline-offset-2">
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
