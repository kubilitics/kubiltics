import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ActionItem {
  icon: LucideIcon;
  label: string;
  description: string;
  variant?: 'default' | 'destructive' | 'warning';
  onClick?: () => void;
}

export interface ActionsSectionProps {
  actions: ActionItem[];
}

export function ActionsSection({ actions }: ActionsSectionProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {actions.map((action) => {
        const isDestructive = action.variant === 'destructive';
        const isWarning = action.variant === 'warning';

        const cardClassName = cn(
          'cursor-pointer transition-all duration-200 border',
          isDestructive &&
            'border-destructive/20 hover:border-destructive/50 hover:bg-destructive/5 hover:shadow-sm',
          isWarning &&
            'border-amber-500/20 hover:border-amber-500/40 hover:bg-amber-500/5 hover:shadow-sm dark:border-amber-400/20 dark:hover:border-amber-400/40 dark:hover:bg-amber-400/5',
          !isDestructive &&
            !isWarning &&
            'border-border hover:border-primary/20 hover:bg-accent/50 hover:shadow-md'
        );

        const iconContainerClassName = cn(
          'p-2.5 rounded-xl shrink-0',
          isDestructive && 'bg-destructive/10',
          isWarning && 'bg-amber-500/10 dark:bg-amber-400/10',
          !isDestructive && !isWarning && 'bg-primary/5'
        );

        const iconClassName = cn(
          'h-5 w-5',
          isDestructive && 'text-destructive',
          isWarning && 'text-amber-700 dark:text-amber-400',
          !isDestructive && !isWarning && 'text-foreground'
        );

        const labelClassName = cn(
          'font-medium',
          isDestructive && 'text-destructive font-semibold',
          isWarning && 'text-amber-700 dark:text-amber-400',
          !isDestructive && !isWarning && 'text-foreground'
        );

        const descriptionClassName = cn(
          'text-sm',
          isDestructive && 'text-destructive/80',
          isWarning && 'text-amber-600/90 dark:text-amber-400/90',
          !isDestructive && !isWarning && 'text-muted-foreground'
        );

        return (
          <Card key={action.label} className={cardClassName} onClick={action.onClick}>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className={iconContainerClassName}>
                  <action.icon className={iconClassName} />
                </div>
                <div className="min-w-0">
                  <p className={labelClassName}>{action.label}</p>
                  <p className={descriptionClassName}>{action.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
