/**
 * LabelList — Unified label rendering component.
 *
 * Renders Kubernetes labels as colorful, deterministically-coloured chips.
 * Must be used on ALL resource detail pages — no inline label rendering.
 */

import { useState, useMemo } from 'react';
import { Tags, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SectionCard } from '../SectionCard';
import { cn } from '@/lib/utils';
import { getLabelColor, labelsFromRecord } from './utils';
import type { K8sLabel } from './types';

export interface LabelListProps {
  /** Labels as a Record (straight from metadata.labels) or pre-converted array. */
  labels: Record<string, string> | K8sLabel[];
  /** Maximum labels to show before "show more" (default: unlimited). */
  maxVisible?: number;
  /** Wrap in a SectionCard (default: true). Set false when embedding inside another card. */
  showCard?: boolean;
  /** Section title (default: "Labels"). */
  title?: string;
  /** Custom className for the outer wrapper. */
  className?: string;
  /** Copy all labels to clipboard button (default: true). */
  showCopyAll?: boolean;
}

export function LabelList({
  labels: labelsProp,
  maxVisible,
  showCard = true,
  title = 'Labels',
  className,
  showCopyAll = true,
}: LabelListProps) {
  const entries: K8sLabel[] = useMemo(() => {
    if (Array.isArray(labelsProp)) return [...labelsProp].sort((a, b) => a.key.localeCompare(b.key));
    return labelsFromRecord(labelsProp);
  }, [labelsProp]);

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const visibleEntries = maxVisible && !expanded ? entries.slice(0, maxVisible) : entries;
  const hasMore = maxVisible ? entries.length > maxVisible : false;
  const hiddenCount = hasMore ? entries.length - maxVisible! : 0;

  const handleCopyAll = () => {
    const text = entries.map((l) => `${l.key}=${l.value}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const content = (
    <div className={cn('space-y-3', className)}>
      {entries.length > 0 ? (
        <>
          <div className="flex flex-wrap gap-2">
            {visibleEntries.map(({ key, value }) => (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono text-xs border cursor-default select-text max-w-[320px] truncate',
                      getLabelColor(key),
                    )}
                  >
                    <span className="truncate">
                      {key}={value}
                    </span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm font-mono text-xs break-all">
                  <p className="font-semibold">{key}</p>
                  <p className="text-muted-foreground">{value}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {hasMore && !expanded && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setExpanded(true)}
              >
                <ChevronDown className="h-3 w-3" />
                +{hiddenCount} more
              </Button>
            )}
            {hasMore && expanded && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setExpanded(false)}
              >
                <ChevronUp className="h-3 w-3" />
                Show less
              </Button>
            )}
          </div>
          {showCopyAll && entries.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-2 text-muted-foreground"
              onClick={handleCopyAll}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy all'}
            </Button>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No labels defined</p>
      )}
    </div>
  );

  if (!showCard) return content;

  return (
    <SectionCard
      icon={Tags}
      title={title}
      tooltip={`Kubernetes labels (${entries.length})`}
    >
      {content}
    </SectionCard>
  );
}
