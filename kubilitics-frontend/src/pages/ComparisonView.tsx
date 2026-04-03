/**
 * ComparisonView -- Side-by-side cluster comparison page.
 *
 * Route: /fleet/xray/compare
 *
 * Lets users pick two clusters, shows side-by-side health gauges,
 * dimension comparison table, and structural differences list.
 */
import { useState } from 'react';
import {
  ArrowLeftRight,
  AlertTriangle,
  Info,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useXRayDashboard, useXRayComparison } from '@/hooks/useFleetXray';
import { useFleetXrayStore } from '@/stores/fleetXrayStore';
import type { XRayCluster, StructuralDiff } from '@/services/api/fleetXray';

// ── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function HealthGauge({ score, label }: { score: number; label: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/20"
          strokeWidth="8"
        />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="currentColor"
          className={healthColor(score)}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text
          x="50" y="50"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-xl font-bold"
          fontSize="20"
        >
          {score}
        </text>
      </svg>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function ClusterSelector({
  clusters,
  value,
  onChange,
  label,
}: {
  clusters: XRayCluster[];
  value: string | null;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <select
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select cluster...</option>
        {clusters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function DiffSeverityBadge({ severity }: { severity: StructuralDiff['severity'] }) {
  const classes = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  };
  return (
    <span className={cn('text-[10px] font-bold uppercase px-1.5 py-0.5 rounded', classes[severity])}>
      {severity}
    </span>
  );
}

// ── Dimension Row ────────────────────────────────────────────────────────────

function DimensionRow({
  label,
  valueA,
  valueB,
  format,
}: {
  label: string;
  valueA: number;
  valueB: number;
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => String(v));
  const diff = valueA - valueB;
  return (
    <tr className="border-b border-border/30">
      <td className="p-3 font-medium">{label}</td>
      <td className="p-3 text-right tabular-nums">{fmt(valueA)}</td>
      <td className="p-3 text-right tabular-nums">{fmt(valueB)}</td>
      <td className="p-3 text-right tabular-nums">
        <span
          className={cn(
            diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-muted-foreground',
          )}
        >
          {diff > 0 ? '+' : ''}{fmt(diff)}
        </span>
      </td>
    </tr>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ComparisonView() {
  const dashboardQuery = useXRayDashboard();
  const clusters = dashboardQuery.data?.clusters ?? [];

  const selectedA = useFleetXrayStore((s) => s.selectedClusters[0]);
  const selectedB = useFleetXrayStore((s) => s.selectedClusters[1]);
  const setA = useFleetXrayStore((s) => s.setSelectedClusterA);
  const setB = useFleetXrayStore((s) => s.setSelectedClusterB);

  const comparisonQuery = useXRayComparison(selectedA, selectedB);
  const comparison = comparisonQuery.data;

  const [expandedDiff, setExpandedDiff] = useState<number | null>(null);

  const pct = (v: number) => `${v.toFixed(1)}%`;

  if (dashboardQuery.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cluster Comparison</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Side-by-side structural health comparison between two clusters
        </p>
      </div>

      {/* Cluster selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <ClusterSelector clusters={clusters} value={selectedA} onChange={setA} label="Cluster A" />
        <ClusterSelector clusters={clusters} value={selectedB} onChange={setB} label="Cluster B" />
      </div>

      {/* Loading state while fetching comparison */}
      {comparisonQuery.isLoading && selectedA && selectedB && (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      )}

      {/* Error state */}
      {comparisonQuery.isError && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Failed to load comparison data.
          </p>
        </div>
      )}

      {/* Comparison results */}
      {comparison && (
        <>
          {/* Side-by-side gauges */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-around">
                <HealthGauge
                  score={comparison.cluster_a.dimensions.health_score}
                  label={comparison.cluster_a.name}
                />
                <ArrowLeftRight className="h-6 w-6 text-muted-foreground" />
                <HealthGauge
                  score={comparison.cluster_b.dimensions.health_score}
                  label={comparison.cluster_b.name}
                />
              </div>
            </CardContent>
          </Card>

          {/* Dimension comparison table */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="p-3 text-left font-medium text-muted-foreground">Dimension</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">{comparison.cluster_a.name}</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">{comparison.cluster_b.name}</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    <DimensionRow label="Health Score" valueA={comparison.cluster_a.dimensions.health_score} valueB={comparison.cluster_b.dimensions.health_score} />
                    <DimensionRow label="SPOFs" valueA={comparison.cluster_a.dimensions.spof_count} valueB={comparison.cluster_b.dimensions.spof_count} />
                    <DimensionRow label="PDB Coverage" valueA={comparison.cluster_a.dimensions.pdb_coverage} valueB={comparison.cluster_b.dimensions.pdb_coverage} format={pct} />
                    <DimensionRow label="HPA Coverage" valueA={comparison.cluster_a.dimensions.hpa_coverage} valueB={comparison.cluster_b.dimensions.hpa_coverage} format={pct} />
                    <DimensionRow label="NetPol Coverage" valueA={comparison.cluster_a.dimensions.netpol_coverage} valueB={comparison.cluster_b.dimensions.netpol_coverage} format={pct} />
                    <DimensionRow label="Avg Blast Radius" valueA={comparison.cluster_a.dimensions.blast_radius_avg} valueB={comparison.cluster_b.dimensions.blast_radius_avg} format={pct} />
                    <DimensionRow label="Cross-NS Dependencies" valueA={comparison.cluster_a.dimensions.cross_ns_deps} valueB={comparison.cluster_b.dimensions.cross_ns_deps} />
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Structural differences */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold mb-3">
                Structural Differences ({comparison.structural_diffs?.length ?? 0})
              </h3>
              {(!comparison.structural_diffs || comparison.structural_diffs.length === 0) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Info className="h-4 w-4" />
                  No structural differences found.
                </div>
              )}
              {comparison.structural_diffs?.map((diff, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-full text-left rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-colors p-3"
                  onClick={() => setExpandedDiff(expandedDiff === i ? null : i)}
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        expandedDiff === i && 'rotate-90',
                      )}
                    />
                    <DiffSeverityBadge severity={diff.severity} />
                    <span className="text-sm font-medium">{diff.category}</span>
                  </div>
                  {expandedDiff === i && (
                    <div className="mt-2 ml-6 space-y-1 text-xs text-muted-foreground">
                      <p>{diff.description}</p>
                      <div className="grid grid-cols-2 gap-4 mt-2">
                        <div>
                          <span className="font-medium text-foreground">Cluster A: </span>
                          {diff.cluster_a_value}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Cluster B: </span>
                          {diff.cluster_b_value}
                        </div>
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty state when no clusters selected */}
      {!selectedA && !selectedB && !comparisonQuery.isLoading && (
        <div className="rounded-xl border border-dashed border-border/60 p-12 text-center">
          <ArrowLeftRight className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Select two clusters above to compare their structural health.
          </p>
        </div>
      )}
    </div>
  );
}
