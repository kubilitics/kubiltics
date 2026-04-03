/**
 * DRReadinessView -- Disaster Recovery readiness assessment page.
 *
 * Route: /fleet/xray/dr
 *
 * Primary/backup cluster selectors, readiness score gauge (0-100),
 * coverage breakdown, parity score, and recommendations.
 */
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Info,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useXRayDashboard, useXRayDRAssessment } from '@/hooks/useFleetXray';
import { useFleetXrayStore } from '@/stores/fleetXrayStore';
import type { XRayCluster, DRRecommendation, DRCoverageItem } from '@/services/api/fleetXray';

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function ReadinessGauge({ score }: { score: number }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/20"
          strokeWidth="10"
        />
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke="currentColor"
          className={scoreColor(score)}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
        />
        <text
          x="70" y="65"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-bold"
          fontSize="28"
        >
          {score}
        </text>
        <text
          x="70" y="88"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-muted-foreground"
          fontSize="11"
        >
          Readiness
        </text>
      </svg>
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

function RecSeverityIcon({ severity }: { severity: DRRecommendation['severity'] }) {
  if (severity === 'critical') return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
}

function CoverageBar({ percent }: { percent: number }) {
  const barColor =
    percent >= 80
      ? 'bg-emerald-500'
      : percent >= 50
        ? 'bg-amber-500'
        : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 rounded-full bg-muted/30 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-medium w-10 text-right">{percent.toFixed(0)}%</span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DRReadinessView() {
  const dashboardQuery = useXRayDashboard();
  const clusters = dashboardQuery.data?.clusters ?? [];

  const primaryId = useFleetXrayStore((s) => s.drPrimaryId);
  const backupId = useFleetXrayStore((s) => s.drBackupId);
  const setPrimaryId = useFleetXrayStore((s) => s.setDRPrimaryId);
  const setBackupId = useFleetXrayStore((s) => s.setDRBackupId);

  const drQuery = useXRayDRAssessment(primaryId, backupId);
  const assessment = drQuery.data;

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
        <h1 className="text-2xl font-bold tracking-tight">DR Readiness</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assess disaster recovery readiness between primary and backup clusters
        </p>
      </div>

      {/* Cluster selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
        <ClusterSelector clusters={clusters} value={primaryId} onChange={setPrimaryId} label="Primary Cluster" />
        <ClusterSelector
          clusters={clusters.filter((c) => c.id !== primaryId)}
          value={backupId}
          onChange={setBackupId}
          label="Backup Cluster"
        />
      </div>

      {/* Loading */}
      {drQuery.isLoading && primaryId && backupId && (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      )}

      {/* Error */}
      {drQuery.isError && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-3" />
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            Failed to load DR assessment.
          </p>
        </div>
      )}

      {/* Assessment results */}
      {assessment && (
        <>
          {/* Readiness overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-0 shadow-sm md:col-span-1">
              <CardContent className="p-6 flex flex-col items-center justify-center">
                <ReadinessGauge score={assessment.readiness_score} />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm md:col-span-2">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-medium">{assessment.primary_name}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{assessment.backup_name}</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Parity Score</span>
                    <p className={cn('text-2xl font-bold tabular-nums', scoreColor(assessment.parity_score))}>
                      {assessment.parity_score}%
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Recommendations</span>
                    <p className="text-2xl font-bold tabular-nums">
                      {assessment.recommendations?.length ?? 0}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Coverage breakdown */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="p-4 border-b border-border/50">
                <h3 className="text-sm font-semibold">Resource Coverage</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="p-3 text-left font-medium text-muted-foreground">Resource Kind</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Primary</th>
                      <th className="p-3 text-right font-medium text-muted-foreground">Backup</th>
                      <th className="p-3 font-medium text-muted-foreground w-48">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!assessment.coverage || assessment.coverage.length === 0) && (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-muted-foreground">
                          No coverage data available.
                        </td>
                      </tr>
                    )}
                    {assessment.coverage?.map((item: DRCoverageItem) => (
                      <tr key={item.resource_kind} className="border-b border-border/30">
                        <td className="p-3 font-medium">{item.resource_kind}</td>
                        <td className="p-3 text-right tabular-nums">{item.primary_count}</td>
                        <td className="p-3 text-right tabular-nums">{item.backup_count}</td>
                        <td className="p-3">
                          <CoverageBar percent={item.coverage_percent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">
                Recommendations ({assessment.recommendations?.length ?? 0})
              </h3>
              {(!assessment.recommendations || assessment.recommendations.length === 0) && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 py-2">
                  <CheckCircle2 className="h-4 w-4" />
                  No issues found. DR setup looks healthy.
                </div>
              )}
              {assessment.recommendations?.map((rec: DRRecommendation, i: number) => (
                <div
                  key={i}
                  className="flex gap-3 rounded-lg border border-border/50 p-3"
                >
                  <RecSeverityIcon severity={rec.severity} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{rec.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{rec.detail}</p>
                    <span className="text-[10px] text-muted-foreground">{rec.category}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty state */}
      {!primaryId && !backupId && !drQuery.isLoading && (
        <div className="rounded-xl border border-dashed border-border/60 p-12 text-center">
          <ShieldAlert className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Select a primary and backup cluster above to assess DR readiness.
          </p>
        </div>
      )}
    </div>
  );
}
