import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ChevronDown,
  ArrowRight,
  Loader2,
  ExternalLink,
  Clock,
  RotateCcw,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useInvestigateData } from '@/hooks/useInvestigateData';
import { ERROR_KEYWORDS } from '@/lib/rootCauseHeuristic';
import type { Insight } from '@/services/api/eventsIntelligence';
import { useCausalChain } from '@/hooks/useCausalChain';
import { useCausalChainStore } from '@/stores/causalChainStore';

interface InsightsBannerProps {
  insights: Insight[];
  onDismiss: (insightId: string) => void;
  isDismissing?: boolean;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/10 border-red-500/20',
  high: 'bg-amber-500/10 border-amber-500/20',
  medium: 'bg-yellow-500/10 border-yellow-500/20',
  low: 'bg-blue-500/10 border-blue-500/20',
};

const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-amber-600 dark:text-amber-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-blue-600 dark:text-blue-400',
};

const MAX_INLINE_PODS = 3;

function HighlightedSnippet({ text }: { text: string }) {
  const lower = text.toLowerCase();
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;

  const matches: Array<{ start: number; end: number }> = [];
  for (const kw of ERROR_KEYWORDS) {
    let idx = lower.indexOf(kw);
    while (idx !== -1) {
      matches.push({ start: idx, end: idx + kw.length });
      idx = lower.indexOf(kw, idx + 1);
    }
  }
  matches.sort((a, b) => a.start - b.start);

  for (const m of matches) {
    if (m.start < lastIndex) continue;
    if (m.start > lastIndex) {
      parts.push({ text: text.slice(lastIndex, m.start), highlight: false });
    }
    parts.push({ text: text.slice(m.start, m.end), highlight: true });
    lastIndex = m.end;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlight: false });
  }

  return (
    <span className="font-mono text-[11px] text-muted-foreground leading-tight">
      {parts.map((p, i) =>
        p.highlight ? (
          <span key={i} className="text-red-500 dark:text-red-400 font-semibold">{p.text}</span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}

function WhyButton({ insight }: { insight: Insight }) {
  const [enabled, setEnabled] = useState(false);
  const causalChainQuery = useCausalChain(enabled ? insight.insight_id : null);
  const navigate = useNavigate();

  return (
    <button
      onMouseEnter={() => setEnabled(true)}
      onClick={(e) => {
        e.stopPropagation();
        setEnabled(true);
        const chain = causalChainQuery.data;
        if (chain) {
          useCausalChainStore.getState().setActiveChain(chain);
          navigate(
            `/intelligence/${chain.rootCause.kind}/${chain.rootCause.namespace}/${chain.rootCause.name}`
          );
        }
      }}
      className="text-[10px] font-semibold text-amber-500 hover:text-amber-400 bg-amber-500/10 hover:bg-amber-500/15 px-2 py-0.5 rounded transition-colors"
    >
      Why?
    </button>
  );
}

function InvestigatePanel({ insight }: { insight: Insight }) {
  const navigate = useNavigate();
  const { data, isLoading } = useInvestigateData(insight, true);

  if (isLoading) {
    return (
      <div className="space-y-3 pt-3 border-t border-border/30 mt-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!data || data.pods.length === 0) {
    return (
      <div className="pt-3 border-t border-border/30 mt-3">
        <p className="text-xs text-muted-foreground">No affected pods could be identified.</p>
      </div>
    );
  }

  const displayPods = data.pods.slice(0, MAX_INLINE_PODS);
  const remainingCount = data.totalAffected - MAX_INLINE_PODS;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-3 pt-3 border-t border-border/30 mt-3"
    >
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-500/10">
        <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
          Likely cause: {data.rootCause.cause}
        </p>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        {data.startedAgo && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> Started: {data.startedAgo}
          </span>
        )}
        {data.lastRestartAgo && (
          <span className="flex items-center gap-1">
            <RotateCcw className="h-3 w-3" /> Last restart: {data.lastRestartAgo}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border/50 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/30">
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Pod</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Restarts</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Last Error</th>
            </tr>
          </thead>
          <tbody>
            {displayPods.map((pod) => (
              <tr key={`${pod.namespace}/${pod.name}`} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2">
                  {pod.phase !== 'Unknown' ? (
                    <button
                      onClick={() => navigate(`/pods/${pod.namespace}/${pod.name}`)}
                      className="font-mono text-[11px] text-primary hover:underline truncate block max-w-[200px]"
                      title={`${pod.namespace}/${pod.name}`}
                    >
                      {pod.name}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground truncate block max-w-[200px]" title="Pod no longer exists">
                      {pod.name}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">{pod.namespace}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30">
                    {pod.reason}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">
                  {pod.restartCount}
                </td>
                <td className="px-3 py-2 max-w-[250px] truncate">
                  {pod.errorSnippet ? (
                    <HighlightedSnippet text={pod.errorSnippet} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground italic">No logs available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {remainingCount > 0 && (
            <button
              onClick={() => navigate(`/health/issues/${insight.insight_id}`)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              +{remainingCount} more pod{remainingCount > 1 ? 's' : ''} affected
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => navigate(`/health/issues/${insight.insight_id}`)}
        >
          Open full investigation
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    </motion.div>
  );
}

export function InsightsBanner({ insights, onDismiss, isDismissing }: InsightsBannerProps) {
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  if (insights.length === 0) return null;

  const primary = insights[0];
  const severityBg = SEVERITY_STYLES[primary.severity] ?? SEVERITY_STYLES.medium;
  const severityText = SEVERITY_TEXT[primary.severity] ?? SEVERITY_TEXT.medium;
  const isExpanded = expandedInsightId === primary.insight_id;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('rounded-xl border p-4', severityBg)}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn('h-5 w-5 mt-0.5 shrink-0', severityText)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={cn('text-sm font-semibold', severityText)}>{primary.title}</h3>
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-5', severityText)}>
              {primary.severity}
            </Badge>
            <WhyButton insight={primary} />
            {insights.length > 1 && (
              <Badge variant="secondary" className="text-[10px] h-5">
                +{insights.length - 1} more
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{primary.detail}</p>

          <div className="flex items-center gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setExpandedInsightId(isExpanded ? null : primary.insight_id)}
            >
              {isExpanded ? 'Collapse' : 'Investigate'}
              <ArrowRight className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onDismiss(primary.insight_id)}
              disabled={isDismissing}
            >
              {isDismissing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Dismiss'}
            </Button>
            {insights.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setShowMore(!showMore)}
              >
                {showMore ? 'Collapse' : `Show ${insights.length - 1} more`}
                <ChevronDown className={cn('h-3 w-3 transition-transform', showMore && 'rotate-180')} />
              </Button>
            )}
          </div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                className="overflow-hidden"
              >
                <InvestigatePanel insight={primary} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {showMore && insights.length > 1 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mt-3 space-y-2 pl-8"
          >
            {insights.slice(1).map((insight) => {
              const isSecondaryExpanded = expandedInsightId === insight.insight_id;
              return (
                <div key={insight.insight_id} className="border-t border-border/40 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-medium">{insight.title}</p>
                        <WhyButton insight={insight} />
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{insight.detail}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => setExpandedInsightId(isSecondaryExpanded ? null : insight.insight_id)}
                      >
                        {isSecondaryExpanded ? 'Collapse' : 'Investigate'}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => onDismiss(insight.insight_id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isSecondaryExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                        className="overflow-hidden"
                      >
                        <InvestigatePanel insight={insight} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
