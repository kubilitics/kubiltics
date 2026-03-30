/**
 * SimulationControls — Action bar for blast radius failure simulation.
 *
 * Shows "Simulate Failure" when idle, progress bar + wave counter during simulation,
 * plus utility buttons for fit-view and PNG export.
 */
import { Zap, X, Maximize2, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SimulationControlsProps {
  onSimulate: () => void;
  onClear: () => void;
  onFitView: () => void;
  onExport: () => void;
  isSimulating: boolean;
  currentWave: number;
  totalWaves: number;
}

const btnSecondary = cn(
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
  'border border-slate-200 dark:border-slate-700',
  'text-slate-600 dark:text-slate-300',
  'bg-white dark:bg-slate-800',
  'hover:bg-slate-50 dark:hover:bg-slate-700',
  'transition-colors',
);

export function SimulationControls({
  onSimulate,
  onClear,
  onFitView,
  onExport,
  isSimulating,
  currentWave,
  totalWaves,
}: SimulationControlsProps) {
  const progress = totalWaves > 0 ? ((currentWave + 1) / totalWaves) * 100 : 0;

  return (
    <motion.div
      className="flex items-center justify-between gap-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {!isSimulating ? (
          <button
            type="button"
            onClick={onSimulate}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold',
              'bg-red-600 text-white shadow-sm',
              'hover:bg-red-700 active:bg-red-800',
              'dark:bg-red-600 dark:hover:bg-red-700',
              'transition-colors',
            )}
          >
            <Zap className="h-4 w-4" />
            Simulate Failure
          </button>
        ) : (
          <>
            {/* Progress bar + wave counter */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex-1 max-w-xs">
                <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-red-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              </div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                Wave {currentWave + 1} of {totalWaves}
              </span>
            </div>
            <button
              type="button"
              onClick={onClear}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
                'border border-slate-300 dark:border-slate-600',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-50 dark:hover:bg-slate-800',
                'transition-colors',
              )}
            >
              <X className="h-3.5 w-3.5" />
              Clear Simulation
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={onFitView} className={btnSecondary} title="Fit view">
          <Maximize2 className="h-3.5 w-3.5" />
          Fit View
        </button>
        <button type="button" onClick={onExport} className={btnSecondary} title="Export PNG">
          <Download className="h-3.5 w-3.5" />
          Export PNG
        </button>
      </div>
    </motion.div>
  );
}
