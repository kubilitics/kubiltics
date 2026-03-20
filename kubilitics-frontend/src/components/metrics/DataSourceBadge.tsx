/**
 * TASK-OBS-002: DataSourceBadge
 *
 * Shows the active metrics data source: "Prometheus" or "metrics-server".
 * Auto-detects the source on mount and refreshes periodically.
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Radio, RefreshCw, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { detectDataSource, invalidateDataSourceCache, type DataSource } from '@/lib/prometheusClient';

// ─── Props ───────────────────────────────────────────────────────────────────

interface DataSourceBadgeProps {
  className?: string;
  /** Show full label (default) or compact icon-only mode. */
  compact?: boolean;
  /** Refresh interval in ms (default 60s). */
  refreshInterval?: number;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const sourceConfig: Record<DataSource, {
  icon: React.ElementType;
  label: string;
  color: string;
  bg: string;
  dotColor: string;
}> = {
  prometheus: {
    icon: Radio,
    label: 'Prometheus',
    color: 'text-orange-700 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800/40',
    dotColor: 'bg-orange-500',
  },
  'metrics-server': {
    icon: Database,
    label: 'metrics-server',
    color: 'text-blue-700 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/40',
    dotColor: 'bg-blue-500',
  },
  none: {
    icon: AlertCircle,
    label: 'No Source',
    color: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700',
    dotColor: 'bg-slate-400',
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function DataSourceBadge({
  className,
  compact = false,
  refreshInterval = 60_000,
}: DataSourceBadgeProps) {
  const [source, setSource] = useState<DataSource>('none');
  const [detecting, setDetecting] = useState(true);

  const detect = useCallback(async () => {
    setDetecting(true);
    try {
      const result = await detectDataSource();
      setSource(result.source);
    } catch {
      setSource('none');
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    detect();
    const timer = setInterval(detect, refreshInterval);
    return () => clearInterval(timer);
  }, [detect, refreshInterval]);

  const handleRefresh = () => {
    invalidateDataSourceCache();
    detect();
  };

  const cfg = sourceConfig[source];
  const Icon = cfg.icon;

  if (compact) {
    return (
      <button
        onClick={handleRefresh}
        title={`Data source: ${cfg.label}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border px-1.5 py-1 transition-colors',
          cfg.bg,
          className,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dotColor)} />
        <Icon className={cn('h-3 w-3', cfg.color)} />
      </button>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={source}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
      >
        <Badge
          variant="outline"
          className={cn(
            'gap-1.5 text-xs font-medium cursor-pointer transition-colors',
            cfg.bg,
            cfg.color,
            className,
          )}
          onClick={handleRefresh}
          title="Click to refresh data source detection"
        >
          {detecting ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <>
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dotColor)} />
              <Icon className="h-3 w-3 shrink-0" />
            </>
          )}
          {cfg.label}
        </Badge>
      </motion.div>
    </AnimatePresence>
  );
}

export default DataSourceBadge;
