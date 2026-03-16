/**
 * TopologyAIInsights — Panel showing AI-generated topology insights.
 *
 * Features:
 * - Fetches insights from AI endpoint via TanStack Query
 * - Displays categorized insights (security, reliability, performance, cost)
 * - Highlight affected nodes when hovering an insight
 * - Severity indicators (critical, warning, info)
 */
import { memo, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import type { TopologyNode, TopologyEdge } from '@/topology/types/topology';

// ─── Types ──────────────────────────────────────────────────────────────────

export type InsightSeverity = 'critical' | 'warning' | 'info';
export type InsightCategory = 'security' | 'reliability' | 'performance' | 'cost' | 'best-practice';

export interface TopologyInsight {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  affectedNodeIds: string[];
  recommendation?: string;
  learnMoreUrl?: string;
}

export interface TopologyInsightsResponse {
  insights: TopologyInsight[];
  generatedAt: string;
  source: 'llm' | 'heuristic';
}

// ─── API ────────────────────────────────────────────────────────────────────

const API_PREFIX = '/api/v1';

async function fetchTopologyInsights(
  baseUrl: string,
  clusterId: string,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): Promise<TopologyInsightsResponse> {
  const url = `${baseUrl}${API_PREFIX}/clusters/${encodeURIComponent(clusterId)}/topology/ai-insights`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        name: n.name,
        namespace: n.namespace,
        status: n.status,
        labels: n.labels,
      })),
      edges: edges.map((e) => ({
        source: e.source,
        target: e.target,
        relationship_type: e.relationshipType,
      })),
    }),
  });

  if (!res.ok) throw new Error(`Failed to fetch AI insights: ${res.status}`);
  return res.json();
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTopologyInsights(
  clusterId: string | undefined,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  options?: { enabled?: boolean },
) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);

  const enabled = !!(
    isConfigured() &&
    clusterId &&
    nodes.length > 0 &&
    (options?.enabled !== false)
  );

  return useQuery({
    queryKey: ['topology-ai-insights', clusterId ?? '', nodes.length, edges.length],
    queryFn: () => fetchTopologyInsights(baseUrl, clusterId!, nodes, edges),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── Severity / Category Config ─────────────────────────────────────────────

const SEVERITY_CONFIG: Record<InsightSeverity, {
  icon: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
}> = {
  critical: {
    icon: '!',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  warning: {
    icon: '!',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  info: {
    icon: 'i',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
};

const CATEGORY_ICONS: Record<InsightCategory, string> = {
  security: 'shield',
  reliability: 'heart',
  performance: 'zap',
  cost: 'dollar',
  'best-practice': 'star',
};

function CategoryIcon({ category }: { category: InsightCategory }) {
  switch (category) {
    case 'security':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case 'reliability':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
        </svg>
      );
    case 'performance':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case 'cost':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'best-practice':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      );
  }
}

// ─── Insight Card ───────────────────────────────────────────────────────────

interface InsightCardProps {
  insight: TopologyInsight;
  isHighlighted: boolean;
  onHover: (nodeIds: string[] | null) => void;
  onClick?: (insight: TopologyInsight) => void;
}

const InsightCard = memo(function InsightCard({
  insight,
  isHighlighted,
  onHover,
  onClick,
}: InsightCardProps) {
  const severity = SEVERITY_CONFIG[insight.severity];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      onMouseEnter={() => onHover(insight.affectedNodeIds)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick?.(insight)}
      className={`cursor-pointer rounded-lg border p-3 transition-all duration-150 ${
        isHighlighted
          ? `${severity.bg} ${severity.border} ring-2 ring-blue-400/50`
          : `${severity.bg} ${severity.border} hover:shadow-sm`
      }`}
      role="article"
      aria-label={`${insight.severity} ${insight.category} insight: ${insight.title}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 shrink-0 ${severity.text}`}>
          <CategoryIcon category={insight.category} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className={`text-sm font-semibold ${severity.text}`}>
              {insight.title}
            </h4>
            <span className={`inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-bold uppercase ${severity.bg} ${severity.text}`}>
              {insight.severity}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {insight.description}
          </p>
          {insight.recommendation && (
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium">Fix:</span> {insight.recommendation}
            </p>
          )}
          {insight.affectedNodeIds.length > 0 && (
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
              Affects {insight.affectedNodeIds.length} resource{insight.affectedNodeIds.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
});

// ─── Main Panel Component ───────────────────────────────────────────────────

export interface TopologyAIInsightsProps {
  clusterId: string | undefined;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  /** Called when user hovers an insight - highlight affected node IDs on the canvas */
  onHighlightNodes?: (nodeIds: string[] | null) => void;
  /** Called when user clicks an insight */
  onInsightClick?: (insight: TopologyInsight) => void;
  /** Whether the panel is open */
  isOpen?: boolean;
  /** Toggle panel */
  onToggle?: () => void;
}

export const TopologyAIInsights = memo(function TopologyAIInsights({
  clusterId,
  nodes,
  edges,
  onHighlightNodes,
  onInsightClick,
  isOpen = true,
  onToggle,
}: TopologyAIInsightsProps) {
  const { data, isLoading, error, refetch } = useTopologyInsights(
    clusterId,
    nodes,
    edges,
  );

  const [categoryFilter, setCategoryFilter] = useState<InsightCategory | 'all'>('all');
  const [highlightedInsightId, setHighlightedInsightId] = useState<string | null>(null);

  const insights = data?.insights ?? [];

  const filteredInsights = categoryFilter === 'all'
    ? insights
    : insights.filter((i) => i.category === categoryFilter);

  // Sort: critical first, then warning, then info
  const sortedInsights = [...filteredInsights].sort((a, b) => {
    const order: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  const handleHover = useCallback(
    (nodeIds: string[] | null) => {
      setHighlightedInsightId(null);
      onHighlightNodes?.(nodeIds);
    },
    [onHighlightNodes],
  );

  const categoryCounts = insights.reduce(
    (acc, i) => {
      acc[i.category] = (acc[i.category] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const severityCounts = insights.reduce(
    (acc, i) => {
      acc[i.severity] = (acc[i.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<InsightSeverity, number>,
  );

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex h-full w-80 flex-col border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            AI Insights
          </h3>
          {insights.length > 0 && (
            <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
              {insights.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label="Refresh insights"
            title="Refresh"
          >
            <svg className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {onToggle && (
            <button
              onClick={onToggle}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              aria-label="Close insights panel"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Severity summary */}
      {insights.length > 0 && (
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-700">
          {(['critical', 'warning', 'info'] as InsightSeverity[]).map((sev) => {
            const count = severityCounts[sev] ?? 0;
            if (count === 0) return null;
            const cfg = SEVERITY_CONFIG[sev];
            return (
              <div key={sev} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                <span className={`text-[11px] font-medium ${cfg.text}`}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Category filter pills */}
      {insights.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-4 py-2 dark:border-gray-700">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-800'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            All ({insights.length})
          </button>
          {(['security', 'reliability', 'performance', 'cost', 'best-practice'] as InsightCategory[]).map((cat) => {
            const count = categoryCounts[cat] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                  categoryFilter === cat
                    ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-800'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                }`}
              >
                {cat.replace('-', ' ')} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Analyzing topology...</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-950/30">
            <p className="text-sm text-red-600 dark:text-red-400">Failed to load insights</p>
            <p className="mt-1 text-xs text-red-500 dark:text-red-400">{(error as Error).message}</p>
            <button
              onClick={() => refetch()}
              className="mt-2 text-xs font-medium text-red-700 underline hover:no-underline dark:text-red-300"
            >
              Try again
            </button>
          </div>
        ) : sortedInsights.length === 0 ? (
          <div className="py-12 text-center">
            <svg className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {categoryFilter !== 'all' ? 'No insights in this category' : 'No issues detected'}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Your topology looks good
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {sortedInsights.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  isHighlighted={highlightedInsightId === insight.id}
                  onHover={handleHover}
                  onClick={onInsightClick}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer */}
      {data?.generatedAt && (
        <div className="border-t border-gray-100 px-4 py-2 dark:border-gray-700">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Generated {new Date(data.generatedAt).toLocaleTimeString()}
            {data.source === 'llm' && ' via AI'}
            {data.source === 'heuristic' && ' via rules'}
          </p>
        </div>
      )}
    </motion.div>
  );
});

export default TopologyAIInsights;
