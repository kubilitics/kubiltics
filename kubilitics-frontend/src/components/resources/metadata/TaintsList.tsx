/**
 * TaintsList — Unified taint rendering for Node detail pages.
 *
 * Displays taints as structured chips with key, optional value, and
 * colour-coded effect badge (NoSchedule, PreferNoSchedule, NoExecute).
 */

import { Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SectionCard } from '../SectionCard';
import { cn } from '@/lib/utils';
import { getTaintEffectColor, taintsFromSpec } from './utils';
import type { K8sTaint } from './types';

const TAINT_EFFECT_DESCRIPTIONS: Record<string, string> = {
  NoSchedule: 'Pods that do not tolerate this taint will never be scheduled on this node.',
  PreferNoSchedule: 'The scheduler will try to avoid placing pods that do not tolerate this taint on this node, but it is not guaranteed.',
  NoExecute: 'Pods that do not tolerate this taint will be evicted from the node if they are already running.',
};

export interface TaintsListProps {
  /** Raw taint array from node.spec.taints, or pre-converted K8sTaint[]. */
  taints: Array<{ key: string; value?: string; effect: string; timeAdded?: string }> | K8sTaint[];
  /** Wrap in SectionCard (default: true). */
  showCard?: boolean;
  /** Section title (default: "Taints"). */
  title?: string;
  /** Custom className. */
  className?: string;
}

export function TaintsList({
  taints: taintsProp,
  showCard = true,
  title = 'Taints',
  className,
}: TaintsListProps) {
  const taints: K8sTaint[] = taintsFromSpec(taintsProp);

  const content = (
    <div className={cn('space-y-2', className)}>
      {taints.length > 0 ? (
        taints.map((taint, i) => (
          <div
            key={`${taint.key}-${taint.effect}-${i}`}
            className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 flex-wrap"
          >
            {/* Key */}
            <Badge
              variant="outline"
              className="font-mono text-xs border bg-background max-w-[200px] truncate"
            >
              {taint.key}
            </Badge>

            {/* = Value (optional) */}
            {taint.value && (
              <>
                <span className="text-sm text-muted-foreground">=</span>
                <Badge
                  variant="secondary"
                  className="font-mono text-xs max-w-[160px] truncate"
                >
                  {taint.value}
                </Badge>
              </>
            )}

            {/* Effect — colour-coded with tooltip */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-xs ml-auto border cursor-help font-medium',
                    getTaintEffectColor(taint.effect),
                  )}
                >
                  {taint.effect}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {TAINT_EFFECT_DESCRIPTIONS[taint.effect] ?? taint.effect}
              </TooltipContent>
            </Tooltip>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground text-sm">No taints configured</p>
      )}
    </div>
  );

  if (!showCard) return content;

  return (
    <SectionCard
      icon={Shield}
      title={title}
      tooltip="Taints prevent pods from being scheduled on this node unless they have matching tolerations"
    >
      {content}
    </SectionCard>
  );
}
