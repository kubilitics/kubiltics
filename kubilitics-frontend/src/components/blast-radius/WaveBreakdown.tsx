/**
 * WaveBreakdown — Affected resources grouped by wave depth.
 *
 * Wave 1 = direct impact (red), Wave 2+ = transitive (orange).
 * Each resource is clickable with an expandable failure path.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlastWave, AffectedResource, PathHop } from '@/services/api/types';

export interface WaveBreakdownProps {
  waves: BlastWave[];
  /** The namespace of the target resource — used to highlight cross-namespace resources */
  targetNamespace?: string;
  onResourceClick: (kind: string, namespace: string, name: string) => void;
}

const WAVE_COLORS: Record<number, { dot: string; border: string; bg: string }> = {
  1: {
    dot: 'bg-red-500',
    border: 'border-red-200 dark:border-red-800',
    bg: 'bg-red-50 dark:bg-red-950/30',
  },
};

const DEFAULT_WAVE_COLOR = {
  dot: 'bg-orange-500',
  border: 'border-orange-200 dark:border-orange-800',
  bg: 'bg-orange-50 dark:bg-orange-950/30',
};

function getWaveColor(depth: number) {
  return WAVE_COLORS[depth] ?? DEFAULT_WAVE_COLOR;
}

function FailurePath({ hops }: { hops: PathHop[] }) {
  if (hops.length === 0) return null;
  return (
    <div className="mt-2 ml-4 space-y-1">
      {hops.map((hop, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono">
            {hop.from.kind}/{hop.from.name}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" />
          <span className="font-mono">
            {hop.to.kind}/{hop.to.name}
          </span>
          <span className="text-slate-400 dark:text-slate-600 ml-1">({hop.edgeType})</span>
        </div>
      ))}
    </div>
  );
}

function ResourceRow({
  resource,
  isCrossNamespace,
  onResourceClick,
}: {
  resource: AffectedResource;
  isCrossNamespace: boolean;
  onResourceClick: (kind: string, namespace: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPath = resource.failurePath && resource.failurePath.length > 0;

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => {
          if (hasPath) {
            setExpanded((prev) => !prev);
          } else {
            onResourceClick(resource.kind, resource.namespace, resource.name);
          }
        }}
        className={cn(
          'w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
          'hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors',
          isCrossNamespace && 'border-l-2 border-amber-400 dark:border-amber-500',
        )}
      >
        {hasPath && (
          <span className="shrink-0 text-slate-400">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        )}
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase w-20 shrink-0 truncate">
          {resource.kind}
        </span>
        <span
          className="text-slate-700 dark:text-slate-300 truncate flex-1 cursor-pointer hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onResourceClick(resource.kind, resource.namespace, resource.name);
          }}
        >
          {resource.name}
        </span>
        {isCrossNamespace ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            {resource.namespace}
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
            {resource.namespace}
          </span>
        )}
      </button>
      <AnimatePresence>
        {expanded && hasPath && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <FailurePath hops={resource.failurePath} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function WaveBreakdown({ waves, targetNamespace, onResourceClick }: WaveBreakdownProps) {
  if (!waves || waves.length === 0) {
    return (
      <div className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">
        No affected resources detected.
      </div>
    );
  }

  // Count unique cross-namespace namespaces across all waves
  const crossNsSet = new Set<string>();
  for (const wave of waves) {
    for (const res of wave.resources) {
      if (targetNamespace && res.namespace !== targetNamespace) {
        crossNsSet.add(res.namespace);
      }
    }
  }
  const crossNsCount = crossNsSet.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Wave Breakdown
        </h3>
        {crossNsCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            {crossNsCount} cross-namespace{crossNsCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {waves.map((wave) => {
        const color = getWaveColor(wave.depth);
        // Group resources: same-namespace first, then by cross-namespace grouped by ns
        const sameNs = wave.resources.filter(
          (r) => !targetNamespace || r.namespace === targetNamespace,
        );
        const crossNs = wave.resources.filter(
          (r) => !!targetNamespace && r.namespace !== targetNamespace,
        );
        // Group cross-namespace resources by namespace
        const crossNsByNs = new Map<string, AffectedResource[]>();
        for (const r of crossNs) {
          if (!crossNsByNs.has(r.namespace)) crossNsByNs.set(r.namespace, []);
          crossNsByNs.get(r.namespace)!.push(r);
        }

        return (
          <motion.div
            key={wave.depth}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: wave.depth * 0.08, duration: 0.25 }}
          >
            {/* Wave header */}
            <div className={cn('flex items-center gap-2 mb-1.5 px-1')}>
              <span className={cn('h-2 w-2 rounded-full shrink-0', color.dot)} />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                Wave {wave.depth}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                ({wave.resources.length} resource{wave.resources.length !== 1 ? 's' : ''})
              </span>
              {crossNs.length > 0 && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                  {crossNs.length} cross-ns
                </span>
              )}
            </div>
            {/* Resources — same namespace */}
            <div className={cn('rounded-lg border p-1', color.border, color.bg)}>
              {sameNs.map((resource) => (
                <ResourceRow
                  key={`${resource.kind}/${resource.namespace}/${resource.name}`}
                  resource={resource}
                  isCrossNamespace={false}
                  onResourceClick={onResourceClick}
                />
              ))}
              {/* Cross-namespace resources grouped by namespace */}
              {Array.from(crossNsByNs.entries()).map(([ns, resources]) => (
                <div key={`cross-ns-${ns}`} className="mt-1">
                  <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                    {ns}
                    <span className="text-amber-500/60 dark:text-amber-500/40 font-normal normal-case">
                      (external namespace)
                    </span>
                  </div>
                  {resources.map((resource) => (
                    <ResourceRow
                      key={`${resource.kind}/${resource.namespace}/${resource.name}`}
                      resource={resource}
                      isCrossNamespace={true}
                      onResourceClick={onResourceClick}
                    />
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
