/**
 * BlastRadiusCalculator — Show impact of proposed changes before execution
 *
 * TASK-AI-005: Blast-Radius Calculator
 * Visualizes affected downstream resources for any mutation.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Shield,
  Zap,
  ChevronRight,
  Box,
  Globe,
  Server,
  Network,
} from 'lucide-react';
import { motion } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AffectedResource {
  kind: string;
  name: string;
  namespace?: string;
  /** How this resource is affected */
  impact: 'direct' | 'downstream' | 'dependent';
  /** Brief description of the impact */
  description?: string;
}

export interface BlastRadiusEstimate {
  /** The action being performed */
  action: string;
  /** Target resource */
  target: {
    kind: string;
    name: string;
    namespace?: string;
  };
  /** Risk level based on resource type and blast radius */
  riskLevel: RiskLevel;
  /** Directly affected resources */
  affectedResources: AffectedResource[];
  /** Summary counts */
  summary: {
    pods: number;
    services: number;
    endpoints: number;
    other: number;
    total: number;
  };
}

// ─── Risk Level Styles ───────────────────────────────────────────────────────

const RISK_STYLES: Record<RiskLevel, { bg: string; text: string; icon: React.ElementType; label: string }> = {
  low: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40',
    text: 'text-emerald-700 dark:text-emerald-400',
    icon: Shield,
    label: 'Low Risk',
  },
  medium: {
    bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/40',
    text: 'text-amber-700 dark:text-amber-400',
    icon: AlertTriangle,
    label: 'Medium Risk',
  },
  high: {
    bg: 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/40',
    text: 'text-orange-700 dark:text-orange-400',
    icon: AlertTriangle,
    label: 'High Risk',
  },
  critical: {
    bg: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/40',
    text: 'text-red-700 dark:text-red-400',
    icon: Zap,
    label: 'Critical Risk',
  },
};

const RESOURCE_ICONS: Record<string, React.ElementType> = {
  Pod: Box,
  Service: Globe,
  Endpoint: Network,
  Node: Server,
};

// ─── Topology Mini Graph ─────────────────────────────────────────────────────

function BlastRadiusMiniGraph({ estimate }: { estimate: BlastRadiusEstimate }) {
  const riskStyle = RISK_STYLES[estimate.riskLevel];

  // Group resources by impact type
  const directResources = estimate.affectedResources.filter(r => r.impact === 'direct');
  const downstreamResources = estimate.affectedResources.filter(r => r.impact === 'downstream');
  const dependentResources = estimate.affectedResources.filter(r => r.impact === 'dependent');

  return (
    <div className="relative py-4">
      {/* Simple flow diagram: dependents → target → downstream */}
      <div className="flex items-center justify-center gap-2 overflow-x-auto">
        {/* Dependent resources */}
        {dependentResources.length > 0 && (
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">Depends on</div>
            <div className="flex flex-col gap-1">
              {dependentResources.slice(0, 3).map((r, i) => (
                <div key={i} className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[11px] font-medium text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40">
                  {r.kind}/{r.name}
                </div>
              ))}
              {dependentResources.length > 3 && (
                <span className="text-[10px] text-slate-400">+{dependentResources.length - 3} more</span>
              )}
            </div>
          </div>
        )}

        {dependentResources.length > 0 && (
          <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
        )}

        {/* Target resource */}
        <div className={cn(
          'px-4 py-2 rounded-xl border-2 text-center shrink-0',
          riskStyle.bg,
          estimate.riskLevel === 'critical' ? 'border-red-400 dark:border-red-600' : 'border-current/20'
        )}>
          <div className={cn('text-xs font-bold', riskStyle.text)}>
            {estimate.action.toUpperCase()}
          </div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
            {estimate.target.kind}/{estimate.target.name}
          </div>
        </div>

        {(directResources.length > 0 || downstreamResources.length > 0) && (
          <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 shrink-0" />
        )}

        {/* Affected resources */}
        {(directResources.length > 0 || downstreamResources.length > 0) && (
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">Affected</div>
            <div className="flex flex-col gap-1">
              {[...directResources, ...downstreamResources].slice(0, 4).map((r, i) => {
                const Icon = RESOURCE_ICONS[r.kind] || Box;
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border',
                      r.impact === 'direct'
                        ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200/60 dark:border-red-800/40'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/40'
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {r.name}
                  </div>
                );
              })}
              {[...directResources, ...downstreamResources].length > 4 && (
                <span className="text-[10px] text-slate-400">+{[...directResources, ...downstreamResources].length - 4} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface BlastRadiusCalculatorProps {
  estimate: BlastRadiusEstimate;
  /** Show/hide the mini topology graph */
  showGraph?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
  className?: string;
}

/**
 * BlastRadiusCalculator — Visualizes the impact of a proposed change.
 *
 * @example
 * <BlastRadiusCalculator
 *   estimate={{
 *     action: 'delete',
 *     target: { kind: 'Deployment', name: 'nginx', namespace: 'production' },
 *     riskLevel: 'high',
 *     affectedResources: [...],
 *     summary: { pods: 3, services: 1, endpoints: 2, other: 0, total: 6 },
 *   }}
 * />
 */
export function BlastRadiusCalculator({
  estimate,
  showGraph = true,
  compact = false,
  className,
}: BlastRadiusCalculatorProps) {
  const riskStyle = RISK_STYLES[estimate.riskLevel];
  const RiskIcon = riskStyle.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border',
        riskStyle.bg,
        compact ? 'p-3' : 'p-4',
        className
      )}
    >
      {/* Risk Level Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RiskIcon className={cn('h-4 w-4', riskStyle.text)} />
          <span className={cn('text-sm font-semibold', riskStyle.text)}>
            {riskStyle.label}
          </span>
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Blast Radius
        </span>
      </div>

      {/* Summary */}
      <div className={cn(
        'flex items-center gap-4 text-sm',
        compact ? 'mb-2' : 'mb-3'
      )}>
        <span className="font-medium text-slate-900 dark:text-slate-100">
          This action affects{' '}
          <span className={cn('font-bold', riskStyle.text)}>
            {estimate.summary.total} resource{estimate.summary.total !== 1 ? 's' : ''}
          </span>
        </span>
      </div>

      {/* Resource Counts */}
      <div className="flex flex-wrap gap-2 mb-3">
        {estimate.summary.pods > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/20 text-xs font-medium text-slate-700 dark:text-slate-300">
            <Box className="h-3 w-3" /> {estimate.summary.pods} pod{estimate.summary.pods !== 1 ? 's' : ''}
          </span>
        )}
        {estimate.summary.services > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/20 text-xs font-medium text-slate-700 dark:text-slate-300">
            <Globe className="h-3 w-3" /> {estimate.summary.services} service{estimate.summary.services !== 1 ? 's' : ''}
          </span>
        )}
        {estimate.summary.endpoints > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/60 dark:bg-black/20 text-xs font-medium text-slate-700 dark:text-slate-300">
            <Network className="h-3 w-3" /> {estimate.summary.endpoints} endpoint{estimate.summary.endpoints !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Mini Topology Graph */}
      {showGraph && !compact && estimate.affectedResources.length > 0 && (
        <BlastRadiusMiniGraph estimate={estimate} />
      )}
    </motion.div>
  );
}

// ─── Utility: Compute risk level from resource type and count ─────────────────

export function computeRiskLevel(
  action: string,
  targetKind: string,
  affectedCount: number
): RiskLevel {
  // Critical: deleting core infrastructure
  if (action === 'delete' && ['Namespace', 'Node', 'PersistentVolume'].includes(targetKind)) {
    return 'critical';
  }

  // High: deleting workloads with many dependents
  if (action === 'delete' && affectedCount > 5) return 'high';
  if (action === 'scale' && affectedCount > 10) return 'high';

  // Medium: modifications with some impact
  if (affectedCount > 2) return 'medium';
  if (action === 'delete') return 'medium';

  // Low: minimal impact
  return 'low';
}
