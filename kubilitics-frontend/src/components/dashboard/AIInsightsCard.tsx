/**
 * AIInsightsCard — Auto-generated cluster observations on Dashboard
 *
 * TASK-AI-004: AI Dashboard Insights Card
 * Shows 2-3 AI-generated insights, cached for 5 minutes.
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  HardDrive,
  ChevronRight,
  Loader2,
  Settings,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAIStatus } from '@/hooks/useAIStatus';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AIInsight {
  id: string;
  type: 'warning' | 'optimization' | 'info' | 'critical';
  title: string;
  description: string;
  /** Route to navigate to for more details */
  link?: string;
  /** Resource kind this insight relates to */
  resourceKind?: string;
  /** Confidence score 0-1 */
  confidence?: number;
}

interface AIInsightsResponse {
  insights: AIInsight[];
  generated_at: string;
  model: string;
}

// ─── Insight Icons ───────────────────────────────────────────────────────────

const INSIGHT_ICONS: Record<string, React.ElementType> = {
  warning: AlertTriangle,
  optimization: TrendingUp,
  info: Brain,
  critical: Zap,
};

const INSIGHT_COLORS: Record<string, string> = {
  warning: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
  optimization: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
  info: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40',
  critical: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
};

// ─── Hook ────────────────────────────────────────────────────────────────────

function useAIInsights() {
  return useQuery<AIInsightsResponse>({
    queryKey: ['ai-insights'],
    queryFn: async () => {
      const response = await fetch('/api/v1/ai/insights');
      if (!response.ok) {
        throw new Error(`Failed to fetch AI insights: ${response.status}`);
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── Insight Row ─────────────────────────────────────────────────────────────

function InsightRow({ insight }: { insight: AIInsight }) {
  const navigate = useNavigate();
  const Icon = INSIGHT_ICONS[insight.type] || Brain;
  const colorClass = INSIGHT_COLORS[insight.type] || INSIGHT_COLORS.info;

  return (
    <button
      onClick={() => insight.link && navigate(insight.link)}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all duration-200',
        'hover:bg-slate-50 dark:hover:bg-slate-800/50',
        'group',
        insight.link && 'cursor-pointer'
      )}
    >
      <div className={cn('p-1.5 rounded-lg shrink-0', colorClass)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-snug">
          {insight.title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
          {insight.description}
        </p>
      </div>
      {insight.link && (
        <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-primary shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

// ─── Setup CTA ───────────────────────────────────────────────────────────────

function AISetupCTA() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
      <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 dark:from-violet-500/20 dark:to-blue-500/20 mb-4">
        <Sparkles className="h-8 w-8 text-violet-600 dark:text-violet-400" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
        Enable AI for Cluster Insights
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 max-w-[200px]">
        Get automated observations about your cluster health and optimization opportunities.
      </p>
      <button
        onClick={() => navigate('/settings/ai')}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'transition-colors duration-200'
        )}
      >
        <Settings className="h-4 w-4" />
        Configure AI
      </button>
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function InsightsSkeleton() {
  return (
    <div className="space-y-3 p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface AIInsightsCardProps {
  className?: string;
}

/**
 * AIInsightsCard — Dashboard card showing AI-generated cluster observations.
 *
 * @example
 * <AIInsightsCard className="col-span-1" />
 */
export function AIInsightsCard({ className }: AIInsightsCardProps) {
  const aiStatus = useAIStatus();
  const isConfigured = aiStatus.status === 'active';
  const { data, isLoading, error, refetch, isFetching } = useAIInsights();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        'rounded-2xl border border-slate-200/60 dark:border-slate-700/40',
        'bg-white dark:bg-slate-900/60 backdrop-blur-sm',
        'shadow-sm dark:shadow-slate-950/20',
        'overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800/60">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-violet-500/10 to-blue-500/10 dark:from-violet-500/20 dark:to-blue-500/20">
            <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Insights</h3>
          {data?.generated_at && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
              {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {isConfigured && (
          <button
            onClick={handleRefresh}
            disabled={isFetching}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            aria-label="Refresh insights"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-slate-400 dark:text-slate-500', isFetching && 'animate-spin')} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="px-4 py-2">
        {!isConfigured ? (
          <AISetupCTA />
        ) : isLoading ? (
          <InsightsSkeleton />
        ) : error ? (
          <div className="py-6 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto mb-2" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Could not load insights</p>
            <button
              onClick={handleRefresh}
              className="text-xs text-primary hover:text-primary/80 font-medium mt-2"
            >
              Try again
            </button>
          </div>
        ) : data?.insights && data.insights.length > 0 ? (
          <div className="space-y-1">
            {data.insights.slice(0, 3).map((insight) => (
              <InsightRow key={insight.id} insight={insight} />
            ))}
          </div>
        ) : (
          <div className="py-6 text-center">
            <Sparkles className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-500 dark:text-slate-400">No insights available yet</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
