/**
 * /clusters/:clusterId/setup/observability
 *
 * Three-zone page (Hero / ComponentFlowRail / DiagnosticsPanel) with:
 * - 960px max width (focused setup flow)
 * - State-varying headline copy
 * - Stagger entry animation (50ms per zone, 8px rise + fade)
 * - Polls status every 3s (installing) or 30s (all ready)
 * - Diagnostics always fetched; DiagnosticsPanel handles its own auto-expand
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Activity, ChevronLeft, RefreshCw, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getTracingStatus, getTracingDiagnostics } from '@/services/api/observability';
import type { TracingStatusResponse } from '@/services/api/observability';
import { InstallCommandBlock } from '@/components/observability/InstallCommandBlock';
import { ComponentFlowRail } from '@/components/observability/ComponentFlowRail';
import { DiagnosticsPanel } from '@/components/observability/DiagnosticsPanel';

// ─── Headline copy varies by state (per visual design spec) ─────────────────

function getHeadline(status: TracingStatusResponse): string {
  if (status.all_ready) return `Tracing is live on ${status.cluster_name}`;
  const anyInstalling = status.components.some((c) => c.status === 'installing');
  if (anyInstalling) return `We're watching your cluster — this usually takes 2-3 minutes`;
  return `Start tracing for ${status.cluster_name}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SetupObservability() {
  const { clusterId } = useParams<{ clusterId: string }>();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const reduceMotion = useReducedMotion();

  const [pollInterval, setPollInterval] = useState(3_000);

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['tracing-status', clusterId],
    queryFn: () => getTracingStatus(baseUrl, clusterId!),
    enabled: !!clusterId && isBackendConfigured,
    refetchInterval: pollInterval,
    staleTime: 1_000,
  });

  useEffect(() => {
    setPollInterval(status?.all_ready ? 30_000 : 3_000);
  }, [status?.all_ready]);

  // Diagnostics always fetched — the panel handles its own auto-expand-on-failure logic
  const { data: diagnostics, refetch: refetchDiagnostics } = useQuery({
    queryKey: ['tracing-diagnostics', clusterId],
    queryFn: () => getTracingDiagnostics(baseUrl, clusterId!),
    enabled: !!clusterId && isBackendConfigured,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const handleRefresh = () => {
    refetchStatus();
    refetchDiagnostics();
  };

  if (statusLoading || !status) return <SetupSkeleton />;

  const headline = getHeadline(status);

  // Motion variants — respect prefers-reduced-motion
  const zoneVariants = reduceMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } };

  const staggerContainer = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.05 } },
  };

  const zoneTransition = { duration: 0.2, ease: 'easeOut' };

  return (
    <div className="page-container">
      <div className="page-inner p-6 gap-8 flex flex-col max-w-[960px]">
        {/* Back link */}
        <Link
          to={`/dashboard?cluster=${clusterId}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to dashboard
        </Link>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="flex flex-col gap-8"
        >
          {/* ─── Zone 1: Hero ──────────────────────────────────────────── */}
          <motion.div variants={zoneVariants} transition={zoneTransition}>
            <Card className="border-none soft-shadow glass-panel">
              <CardContent className="p-6 space-y-4">
                {/* Header row: headline + refresh */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">
                      {headline}
                    </h1>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleRefresh}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </Button>
                </div>

                {/* Cluster name */}
                <p className="text-sm text-muted-foreground">
                  Cluster:{' '}
                  <span className="font-mono text-foreground">{status.cluster_name}</span>
                </p>

                {/* Traces / Metrics / Logs tab strip — Metrics & Logs disabled (roadmap signal) */}
                <div className="flex items-center gap-1 border-b border-border/40 -mx-6 px-6">
                  <button className="text-sm font-medium px-3 py-2 border-b-2 border-primary text-foreground">
                    Traces
                  </button>
                  <button
                    disabled
                    className="text-sm font-medium px-3 py-2 text-muted-foreground/50 cursor-not-allowed"
                  >
                    Metrics{' '}
                    <span className="text-[9px] uppercase tracking-wider ml-1">soon</span>
                  </button>
                  <button
                    disabled
                    className="text-sm font-medium px-3 py-2 text-muted-foreground/50 cursor-not-allowed"
                  >
                    Logs{' '}
                    <span className="text-[9px] uppercase tracking-wider ml-1">soon</span>
                  </button>
                </div>

                {/* Install command block — dimmed when already installed */}
                <div>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Run this in your terminal
                  </h2>
                  <InstallCommandBlock commands={status.install} dimmed={status.all_ready} />
                  {!status.all_ready && (
                    <p className="text-xs text-muted-foreground mt-2">
                      This page updates automatically. After running the command, status flips to
                      ready within ~60 seconds.
                    </p>
                  )}
                  {status.all_ready && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      Installation complete — tracing is live on this cluster
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ─── Zone 2: Component flow rail ───────────────────────────── */}
          <motion.div variants={zoneVariants} transition={zoneTransition}>
            <ComponentFlowRail components={status.components} />
          </motion.div>

          {/* ─── Zone 3: Diagnostics (always rendered — panel handles collapse) */}
          {diagnostics && (
            <motion.div variants={zoneVariants} transition={zoneTransition}>
              <DiagnosticsPanel data={diagnostics} />
            </motion.div>
          )}

          {/* Uninstall disclosure — only visible when all ready */}
          {status.all_ready && (
            <motion.details
              variants={zoneVariants}
              transition={zoneTransition}
              className="group text-xs text-muted-foreground"
            >
              <summary className="cursor-pointer hover:text-foreground transition-colors w-fit select-none">
                Uninstall
              </summary>
              <pre className="font-mono text-[11.5px] leading-[1.6] bg-muted/40 border border-border/40 rounded p-3 mt-2 text-muted-foreground select-all">
{`helm uninstall kubilitics-otel -n kubilitics-system
kubectl delete namespace kubilitics-system`}
              </pre>
            </motion.details>
          )}
        </motion.div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function SetupSkeleton() {
  return (
    <div className="page-container">
      <div className="page-inner p-6 gap-6 flex flex-col max-w-[960px]">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-60" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
