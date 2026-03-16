/**
 * ContainerMetricsSelector — Per-container metrics view for multi-container pods
 *
 * TASK-OBS-008: Container-Level Metrics
 * Debug init containers, sidecars, and multi-container pods.
 */

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Box, ChevronDown, Cpu, HardDrive } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContainerMetrics {
  name: string;
  /** 'init', 'sidecar', or 'app' */
  type: 'init' | 'sidecar' | 'app';
  status: 'running' | 'waiting' | 'terminated';
  cpu: {
    usage: number;      // millicores
    request: number;
    limit: number;
    percent: number;
  };
  memory: {
    usage: number;      // bytes
    request: number;
    limit: number;
    percent: number;
  };
  restartCount: number;
}

export interface ContainerMetricsSelectorProps {
  containers: ContainerMetrics[];
  selectedContainer?: string;
  onSelect: (containerName: string) => void;
  className?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'Ki', 'Mi', 'Gi'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatMillicores(mc: number): string {
  if (mc >= 1000) return `${(mc / 1000).toFixed(1)} cores`;
  return `${mc}m`;
}

// ─── Usage Bar ───────────────────────────────────────────────────────────────

function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percent, 100)}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={cn('h-full rounded-full', color)}
      />
    </div>
  );
}

// ─── Container Card ──────────────────────────────────────────────────────────

function ContainerCard({
  container,
  isSelected,
  onSelect,
}: {
  container: ContainerMetrics;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const statusColor = container.status === 'running'
    ? 'bg-emerald-500'
    : container.status === 'waiting'
      ? 'bg-amber-500'
      : 'bg-slate-400';

  const typeBadge = container.type === 'init'
    ? { label: 'Init', class: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400' }
    : container.type === 'sidecar'
      ? { label: 'Sidecar', class: 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400' }
      : null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full p-3 rounded-xl border transition-all duration-200 text-left',
        isSelected
          ? 'border-primary bg-primary/5 dark:bg-primary/10 shadow-sm'
          : 'border-slate-200 dark:border-slate-700 hover:border-primary/40 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('h-2 w-2 rounded-full shrink-0', statusColor)} />
        <Box className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
          {container.name}
        </span>
        {typeBadge && (
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', typeBadge.class)}>
            {typeBadge.label}
          </span>
        )}
        {container.restartCount > 0 && (
          <span className="text-[10px] font-bold text-red-600 dark:text-red-400 shrink-0">
            {container.restartCount} restart{container.restartCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {/* CPU */}
        <div className="flex items-center gap-2">
          <Cpu className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
          <div className="flex-1">
            <UsageBar
              percent={container.cpu.percent}
              color={container.cpu.percent > 80 ? 'bg-red-500' : container.cpu.percent > 60 ? 'bg-amber-500' : 'bg-emerald-500'}
            />
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums w-16 text-right">
            {formatMillicores(container.cpu.usage)} / {formatMillicores(container.cpu.limit || container.cpu.request)}
          </span>
        </div>

        {/* Memory */}
        <div className="flex items-center gap-2">
          <HardDrive className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
          <div className="flex-1">
            <UsageBar
              percent={container.memory.percent}
              color={container.memory.percent > 80 ? 'bg-red-500' : container.memory.percent > 60 ? 'bg-amber-500' : 'bg-blue-500'}
            />
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums w-16 text-right">
            {formatBytes(container.memory.usage)} / {formatBytes(container.memory.limit || container.memory.request)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * ContainerMetricsSelector — Dropdown + cards for selecting and viewing
 * per-container CPU/memory metrics in multi-container pods.
 *
 * @example
 * <ContainerMetricsSelector
 *   containers={podContainerMetrics}
 *   selectedContainer={selected}
 *   onSelect={setSelected}
 * />
 */
export function ContainerMetricsSelector({
  containers,
  selectedContainer,
  onSelect,
  className,
}: ContainerMetricsSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Sort: init containers first, then app containers, then sidecars
  const sortedContainers = useMemo(() => {
    const order: Record<string, number> = { init: 0, app: 1, sidecar: 2 };
    return [...containers].sort((a, b) => (order[a.type] ?? 1) - (order[b.type] ?? 1));
  }, [containers]);

  const selected = sortedContainers.find((c) => c.name === selectedContainer) ?? sortedContainers[0];

  if (sortedContainers.length <= 1) {
    // Single container — show metrics directly, no selector needed
    return selected ? (
      <div className={className}>
        <ContainerCard container={selected} isSelected={false} onSelect={() => {}} />
      </div>
    ) : null;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Dropdown selector */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-between w-full px-3 py-2 rounded-xl',
          'bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700',
          'text-sm font-medium text-slate-700 dark:text-slate-300',
          'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors'
        )}
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          <span>{selected?.name ?? 'Select container'}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            ({sortedContainers.length} containers)
          </span>
        </div>
        <ChevronDown className={cn(
          'h-4 w-4 text-slate-400 transition-transform duration-200',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* Container cards */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid gap-2">
              {sortedContainers.map((container) => (
                <ContainerCard
                  key={container.name}
                  container={container}
                  isSelected={container.name === selectedContainer}
                  onSelect={() => {
                    onSelect(container.name);
                    setIsOpen(false);
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected container detail (always visible) */}
      {!isOpen && selected && (
        <ContainerCard container={selected} isSelected={true} onSelect={() => setIsOpen(true)} />
      )}
    </div>
  );
}
