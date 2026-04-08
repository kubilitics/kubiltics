/**
 * TracingSetup -- One-click dialog for enabling distributed tracing.
 *
 * States: intro -> deploying -> done
 *
 * The deployment picker (instrument existing apps) was removed because
 * auto-instrumenting busybox/nginx/http-echo style images does not work.
 * Instead, enabling tracing now deploys a real demo app with built-in
 * OTel SDK that generates live traces automatically.
 */
import { useState, useCallback, useEffect } from 'react';
import { CheckCircle2, Loader2, Radio, RefreshCw, AlertCircle, Cpu, Zap } from 'lucide-react';
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
import { useActiveClusterId } from '@/hooks/useActiveClusterId';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import {
  enableTracing,
  getTracingStatus,
} from '@/services/api/tracing';

/* --- Types ---------------------------------------------------------------- */

type SetupState = 'intro' | 'deploying' | 'done';

interface TracingSetupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

/* --- Animation variants --------------------------------------------------- */

const fadeSlide = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: 'easeOut' },
};

/* --- Component ------------------------------------------------------------ */

export function TracingSetup({ open, onOpenChange, onComplete }: TracingSetupProps) {
  const queryClient = useQueryClient();
  const clusterId = useActiveClusterId();
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);

  const [state, setState] = useState<SetupState>('intro');
  const [deployError, setDeployError] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // When dialog opens, check if tracing is already enabled
  useEffect(() => {
    if (!open || !clusterId) return;
    let cancelled = false;
    setIsCheckingStatus(true);
    getTracingStatus(baseUrl, clusterId)
      .then((status) => {
        if (cancelled) return;
        if (status.enabled) {
          setState('done');
        } else {
          setState('intro');
        }
      })
      .catch(() => {
        if (!cancelled) setState('intro');
      })
      .finally(() => {
        if (!cancelled) setIsCheckingStatus(false);
      });
    return () => { cancelled = true; };
  }, [open, clusterId, baseUrl]);

  // Reset state when dialog closes
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setTimeout(() => {
          setState('intro');
          setDeployError(null);
          setIsCheckingStatus(false);
        }, 300);
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  /* -- Enable tracing ---------------------------------------------------- */

  const handleEnable = useCallback(async () => {
    if (!clusterId) return;
    setState('deploying');
    setDeployError(null);

    try {
      await enableTracing(baseUrl, clusterId);

      // Invalidate cached status so the badge updates
      queryClient.invalidateQueries({ queryKey: ['tracing-status', clusterId] });

      setState('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to deploy trace agent';
      setDeployError(msg);
    }
  }, [baseUrl, clusterId, queryClient]);

  /* -- Finish ------------------------------------------------------------- */

  const handleDone = useCallback(() => {
    handleOpenChange(false);
    onComplete();
  }, [handleOpenChange, onComplete]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <AnimatePresence mode="wait">
          {/* -- Loading status check ---------------------------------------- */}
          {isCheckingStatus && (
            <motion.div key="checking" {...fadeSlide} className="flex flex-col items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">Checking tracing status...</p>
            </motion.div>
          )}

          {/* -- Intro ------------------------------------------------------- */}
          {!isCheckingStatus && state === 'intro' && (
            <motion.div key="intro" {...fadeSlide}>
              <DialogHeader className="mb-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Radio className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <DialogTitle>Enable Distributed Tracing</DialogTitle>
                    <DialogDescription className="mt-0.5">
                      One-click setup with live demo traces
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                Kubilitics will deploy a trace agent and a demo application that
                generates real distributed traces so you can explore the tracing
                UI immediately.
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
                        Receives and stores traces -- 1 pod, ~128 MB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Zap className="h-3.5 w-3.5 text-purple-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Demo Order Service</p>
                      <p className="text-xs text-muted-foreground">
                        Generates real traces with DB and cache spans
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

          {/* -- Deploying --------------------------------------------------- */}
          {!isCheckingStatus && state === 'deploying' && (
            <motion.div key="deploying" {...fadeSlide} className="py-4">
              <DialogHeader className="mb-6">
                <DialogTitle>Deploying Trace Infrastructure</DialogTitle>
              </DialogHeader>

              {!deployError ? (
                <div className="flex flex-col items-center gap-4 py-6">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Deploying trace agent and demo application...
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

          {/* -- Done -------------------------------------------------------- */}
          {!isCheckingStatus && state === 'done' && (
            <motion.div key="done" {...fadeSlide} className="py-4">
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="h-14 w-14 rounded-full bg-[hsl(var(--success))]/10 flex items-center justify-center">
                  <CheckCircle2 className="h-7 w-7 text-[hsl(var(--success))]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold mb-1">Tracing is Active</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    The trace agent and demo app are running. Traces will appear
                    within ~60 seconds as the traffic generator sends requests.
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
