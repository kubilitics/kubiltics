/**
 * AnnotationList — Unified annotation rendering component.
 *
 * Renders annotations in a table/card layout with expand/collapse for long
 * values and copy-to-clipboard per entry. Must be used on ALL resource detail
 * pages — no inline annotation rendering.
 */

import { useState, useMemo } from 'react';
import { FileText, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SectionCard } from '../SectionCard';
import { cn } from '@/lib/utils';
import { annotationsFromRecord } from './utils';
import type { K8sAnnotation } from './types';

/** Max chars before truncation in collapsed mode. */
const TRUNCATE_LEN = 100;

export interface AnnotationListProps {
  /** Annotations as a Record (from metadata.annotations) or pre-converted array. */
  annotations: Record<string, string> | K8sAnnotation[];
  /** Wrap in a SectionCard (default: true). */
  showCard?: boolean;
  /** Section title (default: "Annotations"). */
  title?: string;
  /** Max entries to show initially (default: unlimited). */
  maxVisible?: number;
  /** Custom className. */
  className?: string;
}

export function AnnotationList({
  annotations: annotationsProp,
  showCard = true,
  title = 'Annotations',
  maxVisible,
  className,
}: AnnotationListProps) {
  const entries: K8sAnnotation[] = useMemo(() => {
    if (Array.isArray(annotationsProp)) return [...annotationsProp].sort((a, b) => a.key.localeCompare(b.key));
    return annotationsFromRecord(annotationsProp);
  }, [annotationsProp]);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visibleEntries = maxVisible && !showAll ? entries.slice(0, maxVisible) : entries;
  const hasMore = maxVisible ? entries.length > maxVisible : false;

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(`${key}: ${value}`);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const content = (
    <div className={cn('space-y-2', className)}>
      {entries.length > 0 ? (
        <>
          {visibleEntries.map(({ key, value }) => {
            const isLong = value.length > TRUNCATE_LEN;
            const isExpanded = expandedKeys.has(key);
            const displayVal = isLong && !isExpanded ? `${value.slice(0, TRUNCATE_LEN)}…` : value;
            const isCopied = copiedKey === key;

            return (
              <div
                key={key}
                className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-muted-foreground text-xs break-all min-w-0">
                    {key}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleCopy(key, value)}
                      >
                        {isCopied ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">Copy annotation</TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-xs break-all whitespace-pre-wrap min-w-0">
                    {displayVal}
                  </p>
                  {isLong && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-6 text-xs gap-1"
                      onClick={() => toggleExpand(key)}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3 w-3" /> Collapse
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3 w-3" /> Expand
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 w-full"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Show fewer
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> Show all ({entries.length})
                </>
              )}
            </Button>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No annotations defined</p>
      )}
    </div>
  );

  if (!showCard) return content;

  return (
    <SectionCard
      icon={FileText}
      title={title}
      tooltip={`Key-value annotations (${entries.length})`}
    >
      {content}
    </SectionCard>
  );
}
