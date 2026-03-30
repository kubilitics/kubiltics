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
          <span className="text-slate-400 dark:text-slate-600 ml-1">({hop.edge_type})</span>
        </div>
      ))}
    </div>
  );
}

function ResourceRow({
  resource,
  onResourceClick,
}: {
  resource: AffectedResource;
  onResourceClick: (kind: string, namespace: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasPath = resource.failure_path && resource.failure_path.length > 0;

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
        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
          {resource.namespace}
        </span>
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
            <FailurePath hops={resource.failure_path} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function WaveBreakdown({ waves, onResourceClick }: WaveBreakdownProps) {
  if (waves.length === 0) {
    return (
      <div className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">
        No affected resources detected.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Wave Breakdown
      </h3>
      {waves.map((wave) => {
        const color = getWaveColor(wave.depth);
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
            </div>
            {/* Resources */}
            <div className={cn('rounded-lg border p-1', color.border, color.bg)}>
              {wave.resources.map((resource) => (
                <ResourceRow
                  key={`${resource.kind}/${resource.namespace}/${resource.name}`}
                  resource={resource}
                  onResourceClick={onResourceClick}
                />
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
