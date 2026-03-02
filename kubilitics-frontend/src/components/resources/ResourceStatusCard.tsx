import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface ResourceStatusCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'muted';
  variant?: 'default' | 'bordered';
}

const iconColorClasses: Record<string, string> = {
  primary: 'text-primary',
  success: 'text-[hsl(var(--success))]',
  warning: 'text-[hsl(var(--warning))]',
  error: 'text-[hsl(var(--error))]',
  info: 'text-[hsl(var(--info))]',
  muted: 'text-muted-foreground',
};

/** Detect long technical strings (UUIDs, hashes, IPs, qualified names) that need monospace + truncation */
function isTechnicalValue(v: string | number): boolean {
  if (typeof v !== 'string') return false;
  // UUID pattern, long hex, qualified k8s names, or just long strings with dashes/dots
  return /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(v) ||   // UUID prefix
    /^pvc-|^pv-|^vol-/.test(v) ||                    // volume-style prefixes
    (v.length > 24 && /[-.]/.test(v));                // long qualified names
}

export function ResourceStatusCard({
  label,
  value,
  icon: Icon,
  iconColor = 'primary',
  variant = 'default',
}: ResourceStatusCardProps) {
  const valueRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const strValue = String(value);
  const isTechnical = isTechnicalValue(value);

  useEffect(() => {
    const el = valueRef.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [value]);

  const valueEl = (
    <p
      ref={valueRef}
      className={cn(
        'text-xl font-semibold tracking-tight text-foreground truncate',
        isTechnical ? 'font-mono text-base' : 'tabular-nums'
      )}
    >
      {value}
    </p>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-center justify-between gap-3 p-4 rounded-xl bg-card transition-colors h-full',
        variant === 'bordered' && 'border border-border hover:border-primary/30 hover:shadow-sm',
        'focus-within:ring-2 focus-within:ring-primary/20'
      )}
    >
      <div className="space-y-1 min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
        {isTruncated ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm font-mono text-xs break-all">
                {strValue}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          valueEl
        )}
      </div>
      <Icon className={cn('h-7 w-7 shrink-0 opacity-60', iconColorClasses[iconColor])} aria-hidden />
    </motion.div>
  );
}

export interface ResourceStatusCardsProps {
  cards: ResourceStatusCardProps[];
}

/**
 * Adaptive grid for resource status cards.
 *
 * Chooses column count so rows fill as evenly as possible:
 *  - 1-3 cards → that many columns
 *  - 4 cards   → 4 columns (single row)
 *  - 5 cards   → 5 columns on xl, 3 on lg (wraps 3+2)
 *  - 6 cards   → 3 columns (two even rows)
 *  - 7 cards   → 4 columns on xl (4+3), 3 on lg (3+3+1→handled)
 *  - 8+ cards  → 4 columns
 */
function getGridClasses(count: number): string {
  switch (count) {
    case 1: return 'grid-cols-1';
    case 2: return 'grid-cols-2';
    case 3: return 'grid-cols-2 lg:grid-cols-3';
    case 4: return 'grid-cols-2 lg:grid-cols-4';
    case 5: return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';
    case 6: return 'grid-cols-2 lg:grid-cols-3';
    case 7: return 'grid-cols-2 lg:grid-cols-4';
    case 8: return 'grid-cols-2 lg:grid-cols-4';
    case 9: return 'grid-cols-2 lg:grid-cols-3';
    case 10: return 'grid-cols-2 lg:grid-cols-5';
    default: return 'grid-cols-2 lg:grid-cols-4';
  }
}

export function ResourceStatusCards({ cards }: ResourceStatusCardsProps) {
  return (
    <div className={cn(
      'grid gap-3 rounded-xl border border-border/50 bg-muted/20 p-3',
      getGridClasses(cards.length)
    )}>
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: index * 0.05 }}
          className="min-w-0"
        >
          <ResourceStatusCard {...card} variant="bordered" />
        </motion.div>
      ))}
    </div>
  );
}
