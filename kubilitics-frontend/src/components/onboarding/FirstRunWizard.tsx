/**
 * FirstRunWizard — 4-step guided onboarding for first-time users.
 *
 * Steps:
 *   1. Welcome — Brand intro with logo + tagline
 *   2. Connect Cluster — Auto-detect kubeconfigs, select context, verify connection
 *   3. Quick Tour — Feature highlights (Dashboard, Topology, Compare, Terminal)
 *   4. Ready — Confirmation + "Open Dashboard" CTA
 *
 * Shows as a full-screen overlay on first launch.
 * Saves completion to onboardingStore so it never shows again.
 * Skippable via "Skip" link at any step.
 */
import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  LayoutDashboard,
  Network,
  GitCompareArrows,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Server,
  Zap,
  Rocket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useClusterStore } from '@/stores/clusterStore';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { BrandLogo } from '@/components/BrandLogo';
import { isTauri } from '@/lib/tauri';
import { discoverClusters, type BackendCluster } from '@/services/backendApiClient';
import { backendClusterToCluster } from '@/lib/backendClusterAdapter';
import { useQueryClient } from '@tanstack/react-query';
import { useClustersFromBackend } from '@/hooks/useClustersFromBackend';

/* ── Step definitions ───────────────────────────────────────── */

const STEPS = ['welcome', 'connect', 'tour', 'ready'] as const;
type Step = (typeof STEPS)[number];

/* ── Shared animation config ────────────────────────────────── */

const ease = [0.23, 1, 0.32, 1] as const;

const stepTransition = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -24 },
  transition: { duration: 0.4, ease },
};

/* ── Root component ─────────────────────────────────────────── */

export function FirstRunWizard() {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const completeFirstRun = useOnboardingStore((s) => s.completeFirstRun);
  const completeWelcome = useOnboardingStore((s) => s.completeWelcome);
  const setAppMode = useClusterStore((s) => s.setAppMode);
  const stepIndex = STEPS.indexOf(currentStep);

  const handleComplete = useCallback(() => {
    setAppMode('desktop');
    completeWelcome();
    completeFirstRun();
    // After wizard completes, the OnboardingGate unmounts this component and
    // the Router mounts. ClusterConnect will check for activeCluster and redirect
    // to dashboard automatically — no navigation needed here.
  }, [setAppMode, completeWelcome, completeFirstRun]);

  const handleNext = useCallback(() => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    } else {
      handleComplete();
    }
  }, [stepIndex, handleComplete]);

  const handleSkip = useCallback(() => {
    handleComplete();
  }, [handleComplete]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background overflow-hidden">
      {/* Background ambient mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] bg-primary/[0.06] rounded-full blur-[140px] animate-pulse"
          style={{ animationDuration: '8s' }}
        />
        <div
          className="absolute bottom-[-15%] right-[-10%] w-[60%] h-[60%] bg-[hsl(var(--cosmic-purple))]/[0.06] rounded-full blur-[140px] animate-pulse"
          style={{ animationDuration: '10s', animationDelay: '2s' }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-2xl px-8">
        <AnimatePresence mode="wait">
          {currentStep === 'welcome' && (
            <WelcomeStep key="welcome" onNext={handleNext} onSkip={handleSkip} />
          )}
          {currentStep === 'connect' && (
            <ConnectClusterStep key="connect" onNext={handleNext} onSkip={handleSkip} />
          )}
          {currentStep === 'tour' && (
            <QuickTourStep key="tour" onNext={handleNext} onSkip={handleSkip} />
          )}
          {currentStep === 'ready' && (
            <ReadyStep key="ready" onComplete={handleComplete} />
          )}
        </AnimatePresence>

        {/* Progress dots */}
        <motion.div
          className="flex items-center justify-center gap-2 mt-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {STEPS.map((step, i) => (
            <button
              key={step}
              onClick={() => i <= stepIndex && setCurrentStep(STEPS[i])}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                i === stepIndex
                  ? 'w-8 bg-primary'
                  : i < stepIndex
                    ? 'w-2 bg-primary/50 cursor-pointer hover:bg-primary/70'
                    : 'w-2 bg-muted-foreground/20'
              )}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}

/* ── Step 1: Welcome ────────────────────────────────────────── */

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <motion.div {...stepTransition} className="text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease }}
        className="mb-8 flex justify-center"
      >
        <BrandLogo mark height={96} className="drop-shadow-[0_20px_40px_hsl(var(--primary)/0.3)]" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-3xl font-bold tracking-tighter text-foreground mb-4"
      >
        Welcome to Kubilitics
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="text-lg text-muted-foreground font-medium mb-2"
      >
        Kubernetes, Made Human
      </motion.p>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="text-sm text-muted-foreground/70 mb-12 max-w-md mx-auto leading-relaxed"
      >
        The desktop Kubernetes operating system with topology visualization,
        intelligent investigation, and offline-first experience.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="flex items-center justify-center gap-4"
      >
        <Button
          variant="ghost"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip
        </Button>
        <Button
          size="lg"
          onClick={onNext}
          className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
        >
          Get Started
          <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </motion.div>
  );
}

/* ── Step 2: Connect Cluster ────────────────────────────────── */

type ConnectionStatus = 'idle' | 'detecting' | 'detected' | 'connecting' | 'connected' | 'error';

interface DiscoveredContext {
  id: string;
  name: string;
  context: string;
}

function ConnectClusterStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [discovered, setDiscovered] = useState<DiscoveredContext[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const backendBaseUrl = getEffectiveBackendBaseUrl(storedUrl);
  const isBackendConfigured = useBackendConfigStore((s) => s.isBackendConfigured());
  const hasBackend = isBackendConfigured || isTauri();

  const { setDemo, setClusters, setActiveCluster } = useClusterStore();
  const setCurrentClusterId = useBackendConfigStore((s) => s.setCurrentClusterId);
  const queryClient = useQueryClient();
  const clustersFromBackend = useClustersFromBackend();

  // Auto-detect on mount
  useEffect(() => {
    if (!hasBackend) return;
    handleAutoDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAutoDetect = useCallback(async () => {
    if (!hasBackend) {
      setErrorMsg('Backend not available. Start the Kubilitics backend first.');
      setStatus('error');
      return;
    }
    setStatus('detecting');
    setErrorMsg('');
    try {
      const results = await discoverClusters(backendBaseUrl);
      if (results.length === 0) {
        // Try getting existing clusters
        await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
        await clustersFromBackend.refetch();
        const existing = clustersFromBackend.data;
        if (existing && existing.length > 0) {
          const mapped = existing.map((c) => ({ id: c.id, name: c.name, context: c.context }));
          setDiscovered(mapped);
          setSelectedId(mapped[0].id);
          setStatus('detected');
        } else {
          setDiscovered([]);
          setStatus('detected');
        }
      } else {
        await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
        await clustersFromBackend.refetch();
        const mapped = results.map((c) => ({ id: c.id, name: c.name, context: c.context }));
        setDiscovered(mapped);
        setSelectedId(mapped[0].id);
        setStatus('detected');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to detect clusters');
      setStatus('error');
    }
  }, [hasBackend, backendBaseUrl, queryClient, clustersFromBackend]);

  const handleConnect = useCallback(async () => {
    if (!selectedId) return;
    setStatus('connecting');
    try {
      // Refetch to get the full cluster objects
      await queryClient.invalidateQueries({ queryKey: ['backend', 'clusters'] });
      const { data } = await clustersFromBackend.refetch();
      const allBackend = data ?? [];
      const target = allBackend.find((c: BackendCluster) => c.id === selectedId);
      if (target) {
        const cluster = backendClusterToCluster(target);
        setCurrentClusterId(target.id);
        const allClusters = allBackend.map(backendClusterToCluster);
        setClusters(allClusters);
        setActiveCluster(cluster);
        setDemo(false);
      }
      setStatus('connected');
      // Brief delay to show checkmark before advancing
      setTimeout(onNext, 800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Connection failed');
      setStatus('error');
    }
  }, [selectedId, queryClient, clustersFromBackend, setCurrentClusterId, setClusters, setActiveCluster, setDemo, onNext]);

  return (
    <motion.div {...stepTransition}>
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease }}
          className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 mb-5"
        >
          <Server className="h-7 w-7 text-primary" />
        </motion.div>
        <h2 className="text-xl font-bold tracking-tight text-foreground mb-2">
          Connect Your Cluster
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          We'll scan <code className="font-mono text-xs bg-muted/80 px-1.5 py-0.5 rounded">~/.kube/config</code> to
          find your Kubernetes contexts.
        </p>
      </div>

      {/* Status-based content */}
      <div className="space-y-4">
        {/* Detecting state */}
        {status === 'detecting' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3 py-8"
          >
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Scanning for kubeconfig contexts...</p>
          </motion.div>
        )}

        {/* Detected contexts */}
        {(status === 'detected' || status === 'connecting' || status === 'connected') && discovered.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {discovered.length} context{discovered.length > 1 ? 's' : ''} found
            </p>
            <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1">
              {discovered.map((ctx) => {
                const selected = selectedId === ctx.id;
                return (
                  <button
                    key={ctx.id}
                    type="button"
                    onClick={() => status === 'detected' && setSelectedId(ctx.id)}
                    disabled={status !== 'detected'}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl text-left text-sm transition-all',
                      selected
                        ? 'bg-primary/10 border border-primary/30 shadow-sm'
                        : 'bg-card/50 border border-border hover:bg-card hover:border-border/80',
                      status !== 'detected' && 'opacity-70 cursor-default'
                    )}
                  >
                    <div className={cn(
                      'h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0',
                      selected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                    )}>
                      {selected && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{ctx.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{ctx.context}</p>
                    </div>
                    {selected && status === 'connected' && (
                      <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))] shrink-0" />
                    )}
                    {selected && status === 'connecting' && (
                      <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* No contexts found */}
        {status === 'detected' && discovered.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6"
          >
            <AlertCircle className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No kubeconfig contexts found</p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              You can add a cluster later from Settings.
            </p>
          </motion.div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6"
          >
            <AlertCircle className="h-8 w-8 text-destructive/60 mx-auto mb-3" />
            <p className="text-sm text-destructive/80 mb-3">{errorMsg}</p>
            <Button variant="outline" size="sm" onClick={handleAutoDetect}>
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </motion.div>
        )}

        {/* Idle — no backend */}
        {status === 'idle' && !hasBackend && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6"
          >
            <AlertCircle className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Backend is starting up. You can skip this step and connect later.
            </p>
          </motion.div>
        )}
      </div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex items-center justify-center gap-4 mt-8"
      >
        <Button
          variant="ghost"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip
        </Button>
        {status === 'detected' && discovered.length > 0 && (
          <Button
            size="lg"
            onClick={handleConnect}
            disabled={!selectedId}
            className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
          >
            Connect
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {(status === 'detected' && discovered.length === 0) && (
          <Button
            size="lg"
            onClick={onNext}
            className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {(status === 'error' || (status === 'idle' && !hasBackend)) && (
          <Button
            size="lg"
            onClick={onNext}
            variant="outline"
            className="gap-2 px-8 rounded-2xl h-12 font-semibold"
          >
            Continue Without Cluster
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ── Step 3: Quick Tour ─────────────────────────────────────── */

interface FeatureHighlight {
  icon: React.ElementType;
  title: string;
  description: string;
  gradient: string;
  iconColor: string;
}

const features: FeatureHighlight[] = [
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    description: 'See your cluster health at a glance with real-time metrics, pod status, and resource usage.',
    gradient: 'from-primary/10 via-primary/5 to-transparent',
    iconColor: 'text-primary',
  },
  {
    icon: Network,
    title: 'Topology',
    description: 'Visualize resource relationships across 50+ Kubernetes types as an interactive, zoomable graph.',
    gradient: 'from-[hsl(var(--cosmic-purple))]/10 via-[hsl(var(--cosmic-purple))]/5 to-transparent',
    iconColor: 'text-[hsl(var(--cosmic-purple))]',
  },
  {
    icon: GitCompareArrows,
    title: 'Compare',
    description: 'Diff resource configs across namespaces, clusters, or time to catch drift instantly.',
    gradient: 'from-[hsl(var(--warning))]/10 via-[hsl(var(--warning))]/5 to-transparent',
    iconColor: 'text-[hsl(var(--warning))]',
  },
  {
    icon: Terminal,
    title: 'Terminal',
    description: 'Execute commands directly in pods with a built-in terminal. No kubectl context switching.',
    gradient: 'from-[hsl(var(--success))]/10 via-[hsl(var(--success))]/5 to-transparent',
    iconColor: 'text-[hsl(var(--success))]',
  },
];

function QuickTourStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <motion.div {...stepTransition}>
      <div className="text-center mb-8">
        <h2 className="text-xl font-bold tracking-tight text-foreground mb-2">
          A Quick Tour
        </h2>
        <p className="text-sm text-muted-foreground">
          Four powerful features at your fingertips.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {features.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + 0.1 * i, duration: 0.4, ease }}
            className={cn(
              'flex flex-col gap-3 p-5 rounded-2xl border border-border bg-card/50',
              'hover:bg-card hover:border-border/80 hover:shadow-sm transition-all duration-300'
            )}
          >
            <div
              className={cn(
                'p-2.5 rounded-xl bg-gradient-to-br w-fit',
                feature.gradient
              )}
            >
              <feature.icon className={cn('h-5 w-5', feature.iconColor)} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-sm mb-1">{feature.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex items-center justify-center gap-4 mt-8"
      >
        <Button
          variant="ghost"
          onClick={onSkip}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip
        </Button>
        <Button
          size="lg"
          onClick={onNext}
          className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
        >
          Almost Done
          <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </motion.div>
  );
}

/* ── Step 4: Ready ──────────────────────────────────────────── */

function ReadyStep({ onComplete }: { onComplete: () => void }) {
  return (
    <motion.div {...stepTransition} className="text-center">
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease, type: 'spring', stiffness: 200, damping: 15 }}
        className="inline-flex items-center justify-center h-20 w-20 rounded-3xl bg-[hsl(var(--success))]/10 mb-6"
      >
        <Rocket className="h-10 w-10 text-[hsl(var(--success))]" />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="text-2xl font-bold tracking-tight text-foreground mb-3"
      >
        You're All Set!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="text-sm text-muted-foreground mb-10 max-w-sm mx-auto leading-relaxed"
      >
        Your workspace is ready. Explore your cluster, visualize topology, and manage resources
        — all from one place.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
      >
        <Button
          size="lg"
          onClick={onComplete}
          className="gap-2 px-10 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl h-12 font-semibold shadow-lg shadow-primary/20"
        >
          Open Dashboard
          <ArrowRight className="h-4 w-4" />
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default FirstRunWizard;
