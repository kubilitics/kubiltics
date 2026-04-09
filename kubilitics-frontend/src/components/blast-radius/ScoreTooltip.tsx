import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ScoringFactor } from '@/services/api/types';

interface ScoreTooltipProps {
  title: string;
  score: number;
  factors: ScoringFactor[];
  onViewDetails: () => void;
  children: React.ReactNode;
}

export function ScoreTooltip({ title, score, factors, onViewDetails, children }: ScoreTooltipProps) {
  const displayFactors = factors.slice(0, 4);
  const remaining = factors.length - displayFactors.length;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="bottom" className="w-[280px] p-3" sideOffset={8}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
            <span className="text-sm font-bold">{score}</span>
          </div>
          <div className="border-t border-border pt-2 space-y-1.5">
            {displayFactors.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={cn(
                  'font-mono w-8 text-right shrink-0',
                  f.effect > 0 ? 'text-green-500' : f.effect < 0 ? 'text-red-400' : 'text-muted-foreground'
                )}>
                  {f.effect > 0 ? '+' : ''}{Math.round(f.effect)}
                </span>
                <span className="text-muted-foreground truncate">{f.note}</span>
              </div>
            ))}
            {remaining > 0 && (
              <div className="text-xs text-muted-foreground">+{remaining} more</div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
            className="mt-2 text-xs text-primary hover:underline"
          >
            View details →
          </button>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
