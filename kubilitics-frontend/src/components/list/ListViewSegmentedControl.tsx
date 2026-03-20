import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ListViewOption {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface ListViewSegmentedControlProps {
  value: string;
  onChange: (value: string) => void;
  options: ListViewOption[];
  ariaLabel?: string;
  label?: string;
  className?: string;
}

/**
 * Segmented control for list view (e.g. Flat / By Namespace).
 * Selected option uses primary color (ring + bg tint) for clear visibility.
 */
export function ListViewSegmentedControl({
  value,
  onChange,
  options,
  ariaLabel = 'List view',
  label = 'List view',
  className,
}: ListViewSegmentedControlProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {label && (
        <span className="text-sm font-semibold text-foreground tabular-nums">{label}</span>
      )}
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex h-10 items-stretch rounded-lg border border-border bg-muted/40 p-1 shadow-sm ring-1 ring-black/5"
      >
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={cn(
                'inline-flex min-h-[36px] items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-md ring-1 ring-primary/40'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
