/**
 * TracingSetup — One-click dialog wizard for enabling distributed tracing.
 *
 * States: intro → deploying → pick_deployments → done
 */
import { useState, useCallback } from 'react';
import { CheckCircle2, Loader2, Radio, RefreshCw, AlertCircle, Package, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  enableTracing,
  getTracingStatus,
  instrumentDeployments,
  type TracingStatus,
} from '@/services/api/tracing';
import { DeploymentPicker } from './DeploymentPicker';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type SetupState = 'intro' | 'deploying' | 'pick_deployments' | 'done';

interface TracingSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

/* ─── Animation variants ─────────────────────────────────────────────────── */

const fadeSlide = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' },
};

/* ─── Component ──────────────────────────────────────────────────────────── */

export function TracingSetup({ open, onOpenChange, onComplete }: TracingSetupProps) {
  const queryClient = useQueryClient();
  const clusterId = useActiveClusterId();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);

  const [state, setState] = useState<SetupState>('intro');
  const [deployError, setDeployError] = useState<string | null>(null);
  const [tracingStatus, setTracingStatus] = useState<TracingStatus | null>(null);
  const [isInstrumenting, setIsInstrumenting] = useState(false);

  // Reset state when dialog opens/closes
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        // Give dialog time to animate out before resetting
        setTimeout(() => {
          setState('intro');
          setDeployError(null);
          setTracingStatus(null);
          setIsInstrumenting(false);
        }, 300);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  /* ── Step 1: Enable tracing ─────────────────────────────────────────── */

  const handleEnable = useCallback(async () => {
    if (!clusterId) return;
    setState('deploying');
    setDeployError(null);

    try {
      await enableTracing(baseUrl, clusterId);

      // Fetch fresh status so we know which deployments are available
      const status = await getTracingStatus(baseUrl, clusterId);
      setTracingStatus(status);

      // Invalidate cached status so the badge updates
      queryClient.invalidateQueries({ queryKey: ['tracing-status', clusterId] });

      setState('pick_deployments');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to deploy trace agent';
      setDeployError(msg);
    }
  }, [baseUrl, clusterId, queryClient]);

  /* ── Step 2: Instrument deployments ────────────────────────────────── */

  const handleInstrument = useCallback(
    async (selected: Array<{ name: string; namespace: string }>) => {
      if (!clusterId) return;
      setIsInstrumenting(true);
      try {
        const result = await instrumentDeployments(baseUrl, clusterId, { deployments: selected });
        queryClient.invalidateQueries({ queryKey: ['tracing-status', clusterId] });

        if (result.instrumented.length > 0) {
          toast.success(
            `Instrumented ${result.instrumented.length} deployment${result.instrumented.length > 1 ? 's' : ''}${result.restarting ? ' — rolling restart in progress' : ''}`,
          );
        }
        setState('done');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Instrumentation failed';
        toast.error(msg);
      } finally {
        setIsInstrumenting(false);
      }
    },
    [baseUrl, clusterId, queryClient],
  );

  /* ── Step: Skip instrumentation, go straight to done ──────────────── */

  const handleSkip = useCallback(() => {
    setState('done');
  }, []);

  /* ── Step: Finish ───────────────────────────────────────────────────── */

  const handleDone = useCallback(() => {
    handleOpenChange(false);
    onComplete();
  }, [handleOpenChange, onComplete]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <AnimatePresence mode="wait">
          {/* ── Intro ─────────────────────────────────────────────────── */}
          {state === 'intro' && (
            <motion.div key="intro" {...fadeSlide}>
              <DialogHeader className="mb-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Radio className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <DialogTitle>Enable Distributed Tracing</DialogTitle>
                    <DialogDescription className="mt-0.5">
                      One-click setup — no code changes required
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                Kubilitics will deploy a lightweight trace agent into your cluster
                to collect OpenTelemetry traces from your applications.
              </p>

              <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-3 mb-6">
                <h4 className="text-sm font-semibold">What gets installed</h4>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Cpu className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Trace Agent</p>
                      <p className="text-xs text-muted-foreground">
                        Receives and stores traces — 1 pod, ~128 MB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Package className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Instrumentation CRs</p>
                      <p className="text-xs text-muted-foreground">
                        Auto-instruments your apps — no code changes
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={handleEnable}>
                <Radio className="h-4 w-4 mr-2" />
                Enable Tracing
              </Button>
            </motion.div>
          )}

          {/* ── Deploying ─────────────────────────────────────────────── */}
          {state === 'deploying' && (
            <motion.div key="deploying" {...fadeSlide} className="py-4">
              <DialogHeader className="mb-6">
                <DialogTitle>Deploying Trace Agent</DialogTitle>
              </DialogHeader>

              {!deployError ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Deploying trace agent to your cluster…
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                    <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{deployError}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setState('intro');
                        setDeployError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button className="flex-1" onClick={handleEnable}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Pick deployments ──────────────────────────────────────── */}
          {state === 'pick_deployments' && (
            <motion.div key="pick" {...fadeSlide}>
              <DialogHeader className="mb-5">
                <DialogTitle>Instrument Deployments</DialogTitle>
                <DialogDescription>
                  Choose which workloads to auto-instrument with OpenTelemetry.
                </DialogDescription>
              </DialogHeader>

              <DeploymentPicker
                deployments={tracingStatus?.available_deployments ?? []}
                onInstrument={handleInstrument}
                isInstrumenting={isInstrumenting}
              />

              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-3 text-muted-foreground"
                onClick={handleSkip}
                disabled={isInstrumenting}
              >
                Skip for now
              </Button>
            </motion.div>
          )}

          {/* ── Done ──────────────────────────────────────────────────── */}
          {state === 'done' && (
            <motion.div key="done" {...fadeSlide} className="py-4">
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="h-14 w-14 rounded-full bg-[hsl(var(--success))]/10 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-[hsl(var(--success))]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold mb-1">Tracing is Active</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    The trace agent is running. Traces will appear here as your
                    applications handle traffic.
                  </p>
                </div>
                <Button className={cn('mt-2')} onClick={handleDone}>
                  View Traces
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
