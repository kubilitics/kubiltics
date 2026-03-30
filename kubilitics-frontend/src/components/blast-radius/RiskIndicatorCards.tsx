/**
 * RiskIndicatorCards — 4-card grid showing key blast radius metrics.
 *
 * SPOF status, blast radius %, fan-in/fan-out, cross-namespace count.
 * Each card has staggered Framer Motion entry.
 */
import { motion } from 'framer-motion';
import { AlertTriangle, Shield, ArrowDownRight, ArrowUpRight, Globe, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const LEVEL_BADGE_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
};

export interface RiskIndicatorCardsProps {
  isSPOF: boolean;
  blastRadiusPercent: number;
  criticalityLevel: 'critical' | 'high' | 'medium' | 'low';
  fanIn: number;
  fanOut: number;
  affectedNamespaces: number;
  replicaCount: number;
}

const cardBase = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4';

export function RiskIndicatorCards({
  isSPOF,
  blastRadiusPercent,
  criticalityLevel,
  fanIn,
  fanOut,
  affectedNamespaces,
  replicaCount,
}: RiskIndicatorCardsProps) {
  const cards = [
    // SPOF
    {
      label: 'Single Point of Failure',
      content: (
        <div className="flex items-center gap-2">
          {isSPOF ? (
            <>
              <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
              <span className="text-lg font-bold text-red-600 dark:text-red-400">Yes</span>
              <AlertTriangle className="h-4 w-4 text-red-500 ml-auto" />
            </>
          ) : (
            <>
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">No</span>
              <Shield className="h-4 w-4 text-emerald-500 ml-auto" />
            </>
          )}
        </div>
      ),
      sublabel: replicaCount === 1 ? '1 replica' : `${replicaCount} replicas`,
    },
    // Blast Radius %
    {
      label: 'Blast Radius',
      content: (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {blastRadiusPercent}%
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              LEVEL_BADGE_COLORS[criticalityLevel] ?? LEVEL_BADGE_COLORS.low,
            )}
          >
            {criticalityLevel.charAt(0).toUpperCase() + criticalityLevel.slice(1)}
          </span>
        </div>
      ),
      sublabel: 'of cluster resources',
    },
    // Fan-in / Fan-out
    {
      label: 'Fan-in / Fan-out',
      content: (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <ArrowDownRight className="h-4 w-4 text-blue-500" />
            <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{fanIn}</span>
          </span>
          <span className="text-slate-300 dark:text-slate-600">/</span>
          <span className="flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4 text-orange-500" />
            <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{fanOut}</span>
          </span>
        </div>
      ),
      sublabel: 'dependencies in / out',
    },
    // Cross-namespace
    {
      label: 'Cross-Namespace',
      content: (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {affectedNamespaces}
          </span>
          {affectedNamespaces > 1 ? (
            <Globe className="h-4 w-4 text-violet-500 ml-auto" />
          ) : (
            <Activity className="h-4 w-4 text-slate-400 ml-auto" />
          )}
        </div>
      ),
      sublabel: affectedNamespaces === 1 ? 'namespace affected' : 'namespaces affected',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          className={cardBase}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
            {card.label}
          </p>
          {card.content}
          <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
            {card.sublabel}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
