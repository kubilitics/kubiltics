/**
 * TolerationsList — Unified toleration rendering for Pod detail pages.
 *
 * Displays tolerations in a structured table layout with tooltips for
 * effects and toleration seconds.
 */

import { Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SectionCard } from '../SectionCard';
import { cn } from '@/lib/utils';
import { tolerationsFromSpec, TOLERATION_EFFECT_TOOLTIPS, getTaintEffectColor } from './utils';
import type { K8sToleration } from './types';

export interface TolerationsListProps {
  /** Raw toleration array from pod.spec.tolerations, or pre-converted. */
  tolerations: Array<{
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
    tolerationSeconds?: number;
  }> | K8sToleration[];
  /** Wrap in SectionCard (default: true). */
  showCard?: boolean;
  /** Section title (default: "Tolerations"). */
  title?: string;
  /** Custom className. */
  className?: string;
}

export function TolerationsList({
  tolerations: tolerationsProp,
  showCard = true,
  title = 'Tolerations',
  className,
}: TolerationsListProps) {
  const tolerations: K8sToleration[] = tolerationsFromSpec(tolerationsProp);

  const content = (
    <div className={cn('', className)}>
      {tolerations.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Key</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Operator</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Value</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Effect</th>
                <th className="text-left py-2.5 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Seconds</th>
              </tr>
            </thead>
            <tbody>
              {tolerations.map((t, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-xs break-all">
                    {t.key || <span className="text-muted-foreground italic">*</span>}
                  </td>
                  <td className="py-2.5 px-3 text-xs">
                    <Badge variant="secondary" className="text-xs font-normal">
                      {t.operator ?? 'Equal'}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs">
                    {t.value || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-3">
                    {t.effect ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-xs border cursor-help',
                              getTaintEffectColor(t.effect),
                            )}
                          >
                            {t.effect}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {TOLERATION_EFFECT_TOOLTIPS[t.effect] ?? t.effect}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground text-xs">All effects</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-xs">
                    {t.tolerationSeconds != null ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted decoration-muted-foreground underline-offset-2 font-mono">
                            {t.tolerationSeconds}s
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Pod will be evicted after {t.tolerationSeconds} seconds if the taint is added to the node.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No tolerations defined</p>
      )}
    </div>
  );

  if (!showCard) return content;

  return (
    <SectionCard
      icon={Shield}
      title={title}
      tooltip="Tolerations allow this pod to be scheduled on nodes with matching taints"
    >
      {content}
    </SectionCard>
  );
}
