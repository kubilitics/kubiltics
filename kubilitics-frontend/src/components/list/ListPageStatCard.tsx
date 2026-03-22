import { type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ListPageStatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  iconColor?: string;
  valueClassName?: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  /** 'sm' uses smaller label (text-xs); default uses text-sm */
  size?: 'default' | 'sm';
}

/**
 * Reusable stat card for list pages. Label is always dark (font-medium text-foreground)
 * for consistent, accessible UX across all resources.
 */
export function ListPageStatCard({
  label,
  value,
  icon: Icon,
  iconColor = 'text-primary',
  valueClassName,
  selected,
  onClick,
  className,
  size = 'default',
}: ListPageStatCardProps) {
  const labelClass = size === 'sm'
    ? 'text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
    : 'text-xs font-semibold uppercase tracking-wider text-muted-foreground';

  return (
    <Card
      className={cn(
        'relative overflow-hidden group/stat',
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:border-primary/40 hover:shadow-[var(--shadow-2)] hover:-translate-y-0.5',
        selected && 'ring-2 ring-primary/50 border-primary/30 bg-primary/[0.03] shadow-[var(--shadow-2)]',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardContent className={size === 'sm' ? 'p-4' : 'p-5'}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className={cn(labelClass, 'truncate mb-1.5')}>{label}</p>
            <div className={cn('text-2xl font-bold tabular-nums tracking-tight', valueClassName)}>{value}</div>
          </div>
          {Icon && (
            <div className={cn(
              'flex items-center justify-center rounded-xl shrink-0',
              'bg-primary/[0.06] dark:bg-primary/[0.1]',
              size === 'sm' ? 'h-10 w-10' : 'h-12 w-12',
              'transition-colors duration-200',
              'group-hover/stat:bg-primary/[0.1] dark:group-hover/stat:bg-primary/[0.15]',
            )}>
              <Icon className={cn(
                'opacity-80',
                size === 'sm' ? 'h-5 w-5' : 'h-6 w-6',
                iconColor,
                'transition-transform duration-200 group-hover/stat:scale-110',
              )} aria-hidden />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
