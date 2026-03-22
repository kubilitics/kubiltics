import { ReactNode } from 'react';
import { Info, LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Shared section card for resource detail pages. All detail section blocks
 * (Pod overview, Conditions, Containers, Events, Metrics, etc.) should use
 * this for a unified premium look.
 */
export interface SectionCardProps {
  /** Leading icon in header */
  icon: LucideIcon;
  /** Section title (e.g. "RUNTIME", "CONFIGURATION") */
  title: string;
  /** Optional tooltip content; when set, shows (i) icon that triggers tooltip */
  tooltip?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ icon: Icon, title, tooltip, children, className }: SectionCardProps) {
  // Generate a unique id for the title for accessibility
  const titleId = `section-card-title-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div
      role="region"
      aria-labelledby={titleId}
      className={cn(
        'rounded-xl border border-border/50 overflow-hidden bg-card',
        'shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)]',
        'transition-all duration-200',
        'hover:border-border/70 hover:-translate-y-[1px]',
        className
      )}
      style={{ transitionTimingFunction: "var(--ease-default)" }}
    >
      <div className="px-5 py-3.5 bg-gradient-to-r from-muted/30 via-muted/10 to-transparent border-b border-border/40 flex items-center gap-2.5">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 shadow-sm">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <h4 id={titleId} className="text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/80">
          {title}
        </h4>
        {tooltip != null && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
                <Info className="h-3.5 w-3.5" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
