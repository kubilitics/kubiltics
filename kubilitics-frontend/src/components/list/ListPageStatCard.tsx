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
    ? 'text-xs font-medium text-foreground'
    : 'text-sm font-medium text-foreground';

  return (
    <Card
      className={cn(
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:border-primary/40 hover:shadow-sm',
        selected && 'ring-2 ring-primary border-primary/30 shadow-sm',
        className
      )}
      onClick={onClick}
    >
      <CardContent className={size === 'sm' ? 'p-4' : 'pt-4'}>
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className={cn(labelClass, 'truncate')}>{label}</p>
            <div className={cn('text-2xl font-bold tabular-nums', valueClassName)}>{value}</div>
          </div>
          {Icon && <Icon className={cn('h-8 w-8 shrink-0 opacity-50', size === 'sm' && 'h-6 w-6', iconColor)} aria-hidden />}
        </div>
      </CardContent>
    </Card>
  );
}
