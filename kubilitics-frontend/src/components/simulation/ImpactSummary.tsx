/**
 * ImpactSummary — Right panel showing simulation results for the What-If page.
 *
 * - Health score delta: before/after with color coding
 * - SPOF delta: before/after count + list of new SPOFs
 * - Affected services count
 * - Empty state when no simulation has been run
 */
import {
  Heart,
  AlertTriangle,
  Server,
  TrendingDown,
  TrendingUp,
  Minus,
  FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SimulationResult } from '@/services/api/simulation';

interface ImpactSummaryProps {
  result: SimulationResult | null;
}

function DeltaIndicator({ before, after, higherIsBetter = true }: { before: number; after: number; higherIsBetter?: boolean }) {
  const rawDelta = after - before;
  // Round to 1 decimal and treat near-zero as zero (floating point noise)
  const delta = Math.abs(rawDelta) < 0.05 ? 0 : Math.round(rawDelta * 10) / 10;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  const degraded = higherIsBetter ? delta < 0 : delta > 0;

  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-slate-500">
        <Minus className="h-3 w-3" />
        No change
      </span>
    );
  }

  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-xs font-semibold",
      improved ? "text-emerald-600 dark:text-emerald-400" : "",
      degraded ? "text-red-600 dark:text-red-400" : "",
    )}>
      {degraded ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {delta > 0 ? '+' : ''}{delta}
    </span>
  );
}

function HealthGauge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400 w-12">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 w-8 text-right">
        {Math.round(value * 10) / 10}
      </span>
    </div>
  );
}

export default function ImpactSummary({ result }: ImpactSummaryProps) {
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12">
        <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
          <FlaskConical className="h-6 w-6 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
          No results yet
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Run a simulation to see impact analysis
        </p>
      </div>
    );
  }

  const healthDelta = result.health_after - result.health_before;
  const healthColor = healthDelta >= 0 ? 'bg-emerald-500' : 'bg-red-500';
  const beforeHealthColor = result.health_before >= 80 ? 'bg-emerald-500' : result.health_before >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const afterHealthColor = result.health_after >= 80 ? 'bg-emerald-500' : result.health_after >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const spofDelta = result.spofs_after - result.spofs_before;

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto">
      {/* Health Score Delta */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Heart className="h-4 w-4 text-rose-500" />
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Health Score</h3>
          </div>
          <DeltaIndicator before={result.health_before} after={result.health_after} higherIsBetter />
        </div>
        <div className="space-y-2">
          <HealthGauge label="Before" value={result.health_before} color={beforeHealthColor} />
          <HealthGauge label="After" value={result.health_after} color={afterHealthColor} />
        </div>
      </div>

      {/* SPOF Delta */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Single Points of Failure
            </h3>
          </div>
          <DeltaIndicator before={result.spofs_before} after={result.spofs_after} higherIsBetter={false} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-slate-500 dark:text-slate-400 text-xs">Before: </span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{result.spofs_before}</span>
          </div>
          <span className="text-slate-300 dark:text-slate-600">-&gt;</span>
          <div>
            <span className="text-slate-500 dark:text-slate-400 text-xs">After: </span>
            <span className={cn(
              "font-semibold",
              spofDelta > 0 ? "text-red-600 dark:text-red-400" : spofDelta < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-700 dark:text-slate-200"
            )}>
              {result.spofs_after}
            </span>
          </div>
        </div>

        {/* New SPOFs list */}
        {result.new_spofs.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
              New SPOFs ({result.new_spofs.length}):
            </p>
            <ul className="space-y-1">
              {result.new_spofs.map((spof) => (
                <li
                  key={spof.key}
                  className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                  <span className="truncate">{spof.kind}/{spof.namespace}/{spof.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Resolved SPOFs */}
        {result.resolved_spofs.length > 0 && (
          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1">
              Resolved SPOFs ({result.resolved_spofs.length}):
            </p>
            <ul className="space-y-1">
              {result.resolved_spofs.map((spof) => (
                <li
                  key={spof.key}
                  className="text-xs text-slate-600 dark:text-slate-400 truncate"
                >
                  {spof.kind}/{spof.namespace}/{spof.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Affected Services */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Server className="h-4 w-4 text-blue-500" />
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Affected Services</h3>
        </div>
        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          {result.affected_services}
        </p>
      </div>

      {/* Summary */}
      {result.summary && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3">
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {result.summary}
          </p>
        </div>
      )}
    </div>
  );
}
