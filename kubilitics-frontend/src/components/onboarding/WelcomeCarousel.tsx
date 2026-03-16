/**
 * WelcomeCarousel — 3-screen onboarding flow for first-time users.
 *
 * Screens:
 *   1. "Meet Kubilitics" — Brand intro with logo + feature highlights
 *   2. "See Your Cluster" — Topology/dashboard preview illustration
 *   3. "Choose Mode" — Desktop vs In-Cluster selection
 *
 * Features:
 * - Framer Motion slide transitions (AnimatePresence + directional slide)
 * - Progress dots with animated active indicator
 * - Skip button to bypass remaining screens
 * - Stores completion in localStorage via onboardingStore (won't show again)
 * - Full dark mode support
 *
 * @module WelcomeCarousel
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Network,
  Brain,
  Monitor,
  Cloud,
  ChevronRight,
  Layers,
  Shield,
  BarChart3,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { BrandLogo } from '@/components/BrandLogo';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CarouselScreen {
  /** Unique key for AnimatePresence. */
  readonly id: string;
  /** Screen title. */
  readonly title: string;
  /** Screen description (1-2 sentences). */
  readonly description: string;
  /** Illustration component rendered in the hero area. */
  readonly Illustration: React.FC<{ className?: string }>;
  /** CTA button label. */
  readonly ctaLabel: string;
}

interface WelcomeCarouselProps {
  /** Called when the user completes or skips the carousel. */
  onComplete?: () => void;
  /** Custom class name for the outer container. */
  className?: string;
}

// ─── Animation Variants ─────────────────────────────────────────────────────

const slideVariants: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  }),
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  }),
};

// ─── Illustrations ──────────────────────────────────────────────────────────

/** Screen 1: Brand intro illustration with animated feature icons. */
function MeetIllustration({ className }: { className?: string }) {
  const features = [
    { Icon: Network, label: 'Topology', color: 'text-blue-500 dark:text-blue-400' },
    { Icon: Brain, label: 'AI Assist', color: 'text-purple-500 dark:text-purple-400' },
    { Icon: Shield, label: 'Security', color: 'text-emerald-500 dark:text-emerald-400' },
    { Icon: BarChart3, label: 'Analytics', color: 'text-amber-500 dark:text-amber-400' },
  ];

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <BrandLogo mark height={80} className="rounded-2xl shadow-lg" />
      </motion.div>
      <div className="flex items-center gap-4">
        {features.map(({ Icon, label, color }, i) => (
          <motion.div
            key={label}
            custom={i}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="flex flex-col items-center gap-2"
          >
            <div
              className={cn(
                'h-14 w-14 rounded-2xl flex items-center justify-center',
                'bg-slate-100 dark:bg-slate-800/60',
                'border border-slate-200/50 dark:border-slate-700/50',
                'shadow-sm',
              )}
            >
              <Icon className={cn('h-6 w-6', color)} />
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Screen 2: Cluster visualization preview illustration. */
function ClusterIllustration({ className }: { className?: string }) {
  const nodes = [
    { label: 'Node 1', x: 60, y: 20 },
    { label: 'Node 2', x: 180, y: 20 },
    { label: 'Pod A', x: 30, y: 100 },
    { label: 'Pod B', x: 120, y: 100 },
    { label: 'Pod C', x: 210, y: 100 },
    { label: 'Svc', x: 120, y: 170 },
  ];

  const edges = [
    [0, 2], [0, 3], [1, 3], [1, 4], [5, 2], [5, 3], [5, 4],
  ];

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <motion.svg
        viewBox="0 0 270 210"
        className="w-64 h-48"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Edges */}
        {edges.map(([from, to], i) => (
          <motion.line
            key={`edge-${i}`}
            x1={nodes[from].x + 20}
            y1={nodes[from].y + 15}
            x2={nodes[to].x + 20}
            y2={nodes[to].y + 15}
            className="stroke-slate-300 dark:stroke-slate-600"
            strokeWidth={1.5}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.6 }}
            transition={{ delay: 0.3 + i * 0.08, duration: 0.4 }}
          />
        ))}
        {/* Nodes */}
        {nodes.map((node, i) => (
          <motion.g
            key={node.label}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 + i * 0.1, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <rect
              x={node.x}
              y={node.y}
              width={40}
              height={30}
              rx={8}
              className={cn(
                i < 2
                  ? 'fill-blue-100 dark:fill-blue-900/40 stroke-blue-300 dark:stroke-blue-700'
                  : i < 5
                    ? 'fill-emerald-100 dark:fill-emerald-900/40 stroke-emerald-300 dark:stroke-emerald-700'
                    : 'fill-amber-100 dark:fill-amber-900/40 stroke-amber-300 dark:stroke-amber-700',
              )}
              strokeWidth={1.5}
            />
            <text
              x={node.x + 20}
              y={node.y + 19}
              textAnchor="middle"
              className="fill-slate-700 dark:fill-slate-200 text-[8px] font-semibold"
            >
              {node.label}
            </text>
          </motion.g>
        ))}
      </motion.svg>
    </div>
  );
}

/** Screen 3: Mode selection illustration with Desktop vs Cloud icons. */
function ModeIllustration({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-8', className)}>
      <motion.div
        initial={{ x: -30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-3"
      >
        <div
          className={cn(
            'h-20 w-20 rounded-2xl flex items-center justify-center',
            'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30',
            'border border-blue-200/60 dark:border-blue-800/50',
            'shadow-md',
          )}
        >
          <Monitor className="h-9 w-9 text-blue-600 dark:text-blue-400" />
        </div>
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Desktop</span>
        <span className="text-[11px] text-muted-foreground text-center max-w-[100px]">
          Local kubeconfig
        </span>
      </motion.div>

      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.3, duration: 0.3 }}
        className="text-muted-foreground"
      >
        <Layers className="h-5 w-5" />
      </motion.div>

      <motion.div
        initial={{ x: 30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-3"
      >
        <div
          className={cn(
            'h-20 w-20 rounded-2xl flex items-center justify-center',
            'bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30',
            'border border-purple-200/60 dark:border-purple-800/50',
            'shadow-md',
          )}
        >
          <Cloud className="h-9 w-9 text-purple-600 dark:text-purple-400" />
        </div>
        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">In-Cluster</span>
        <span className="text-[11px] text-muted-foreground text-center max-w-[100px]">
          Service account
        </span>
      </motion.div>
    </div>
  );
}

// ─── Screen Data ────────────────────────────────────────────────────────────

const SCREENS: CarouselScreen[] = [
  {
    id: 'meet',
    title: 'Meet Kubilitics',
    description:
      'A production-grade Kubernetes dashboard with topology visualization, AI-powered investigation, and real-time observability — all from your desktop.',
    Illustration: MeetIllustration,
    ctaLabel: 'Next',
  },
  {
    id: 'cluster',
    title: 'See Your Cluster',
    description:
      'Explore every resource relationship across 50+ Kubernetes types rendered as an interactive, zoomable topology graph with real-time updates.',
    Illustration: ClusterIllustration,
    ctaLabel: 'Next',
  },
  {
    id: 'mode',
    title: 'Choose Your Mode',
    description:
      'Run Kubilitics as a desktop app with your local kubeconfig, or deploy it in-cluster with service account access. Pick what fits your workflow.',
    Illustration: ModeIllustration,
    ctaLabel: 'Get Started',
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * WelcomeCarousel — full-screen onboarding carousel.
 *
 * Renders a 3-screen guided tour and stores completion in the onboarding
 * Zustand store (persisted to localStorage). Once completed, the carousel
 * won't show again unless the user resets onboarding from Settings.
 *
 * @example
 * ```tsx
 * const { hasCompletedWelcome } = useOnboardingStore();
 *
 * if (!hasCompletedWelcome) {
 *   return <WelcomeCarousel onComplete={() => navigate('/mode')} />;
 * }
 * ```
 */
export function WelcomeCarousel({ onComplete, className }: WelcomeCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const completeWelcome = useOnboardingStore((s) => s.completeWelcome);

  const screen = SCREENS[currentIndex];
  const isLastScreen = currentIndex === SCREENS.length - 1;

  /** Advance to the next screen or complete the flow. */
  const handleNext = useCallback(() => {
    if (isLastScreen) {
      completeWelcome();
      onComplete?.();
    } else {
      setDirection(1);
      setCurrentIndex((prev) => prev + 1);
    }
  }, [isLastScreen, completeWelcome, onComplete]);

  /** Skip the entire flow. */
  const handleSkip = useCallback(() => {
    completeWelcome();
    onComplete?.();
  }, [completeWelcome, onComplete]);

  /** Navigate to a specific screen via progress dots. */
  const handleDotClick = useCallback(
    (index: number) => {
      setDirection(index > currentIndex ? 1 : -1);
      setCurrentIndex(index);
    },
    [currentIndex],
  );

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center',
        'bg-gradient-to-b from-slate-50 via-white to-blue-50/30',
        'dark:from-[hsl(228,14%,7%)] dark:via-[hsl(228,14%,9%)] dark:to-[hsl(228,14%,11%)]',
        className,
      )}
      role="dialog"
      aria-label="Welcome to Kubilitics"
      aria-modal="true"
    >
      {/* Ambient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/20 dark:bg-blue-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-200/20 dark:bg-indigo-900/20 rounded-full blur-[120px]" />
      </div>

      {/* Card */}
      <div
        className={cn(
          'relative z-10 w-full max-w-lg mx-4',
          'bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl',
          'rounded-3xl border border-slate-200/50 dark:border-slate-700/50',
          'shadow-2xl dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]',
          'overflow-hidden',
        )}
      >
        {/* Skip button */}
        {!isLastScreen && (
          <button
            onClick={handleSkip}
            className={cn(
              'absolute top-5 right-5 z-20',
              'text-xs font-semibold text-muted-foreground',
              'hover:text-foreground transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 rounded-lg px-2 py-1',
            )}
            aria-label="Skip onboarding"
          >
            Skip
          </button>
        )}

        {/* Animated content area */}
        <div className="relative min-h-[420px] flex flex-col">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={screen.id}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex flex-col items-center px-8 pt-10 pb-6 flex-1"
            >
              {/* Illustration */}
              <div className="h-48 flex items-center justify-center mb-6">
                <screen.Illustration className="w-full" />
              </div>

              {/* Title */}
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.4 }}
                className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-center"
              >
                {screen.title}
              </motion.h2>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
                className="mt-3 text-sm text-muted-foreground text-center leading-relaxed max-w-sm"
              >
                {screen.description}
              </motion.p>
            </motion.div>
          </AnimatePresence>

          {/* Bottom bar: dots + CTA */}
          <div className="px-8 pb-8 flex items-center justify-between">
            {/* Progress dots */}
            <div className="flex items-center gap-2" role="tablist" aria-label="Carousel progress">
              {SCREENS.map((s, i) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={i === currentIndex}
                  aria-label={`Go to screen ${i + 1}: ${s.title}`}
                  onClick={() => handleDotClick(i)}
                  className={cn(
                    'relative h-2 rounded-full transition-all duration-300',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2',
                    i === currentIndex
                      ? 'w-6 bg-primary'
                      : 'w-2 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500',
                  )}
                />
              ))}
            </div>

            {/* CTA button */}
            <Button
              onClick={handleNext}
              size="default"
              className={cn(
                'rounded-xl gap-2 font-semibold shadow-md',
                'hover:shadow-lg hover:translate-y-[-1px] transition-all duration-200',
              )}
            >
              {screen.ctaLabel}
              {isLastScreen ? (
                <Zap className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomeCarousel;
