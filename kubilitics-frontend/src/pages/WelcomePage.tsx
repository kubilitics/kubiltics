// WelcomePage — zero-kubeconfig fallback landing for onboarding-v2.
//
// Shown when the presence layer reports zero discovered AND zero registered
// clusters. The design target is the operator who just installed Kubilitics
// and is looking at its first screen: the UI should earn trust in the first
// 400ms, not greet them with tutorial-style tiles.
//
// Layout:
//   - Brand wordmark header (matches ClusterPickerPage).
//   - A single-line technical fingerprint strip (backend URL, presence
//     readiness, kubeconfig hint). Monospace, factual, the "this is a real
//     tool" signal.
//   - One direct title — no "Welcome!" fluff.
//   - One PRIMARY action: Add a cluster (opens AddClusterDialog). Everything
//     else is subdued.
//   - Two secondary affordances for deferred flows (local cluster, tour) —
//     honestly labelled "soon" instead of a disabled button + tooltip.
//   - Footer: version + build metadata.
//
// Auto-redirects to /clusters the moment the presence layer reports >= 1
// available cluster (the user added one, or the backend's background
// discovery caught up).
//
// Wired as "/welcome" in App.tsx.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, PlayCircle, Boxes, ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';
import { AddClusterDialog } from '@/components/cluster/AddClusterDialog';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import type { PresenceSnapshot } from '@/types/resilient';

// ── Fingerprint strip ───────────────────────────────────────────────────────
// One line of monospace micro-telemetry. This is the detail that separates
// "POC tile layout" from "SRE actually built this for me". Keep it factual,
// never decorative — if a value isn't known, omit the segment.
interface FingerprintProps {
  backendUrl: string;
  presenceReady: boolean;
  discoveredCount: number;
}

function Fingerprint({ backendUrl, presenceReady, discoveredCount }: FingerprintProps) {
  // Format the backend URL without the protocol prefix — operators scan for
  // host:port, the https:// is noise at this density.
  const hostPart = backendUrl.replace(/^https?:\/\//, '') || 'same-origin';

  const presenceLabel = !presenceReady
    ? 'scanning kubeconfig…'
    : discoveredCount === 0
      ? 'no kubeconfig contexts found'
      : `${discoveredCount} context${discoveredCount === 1 ? '' : 's'} registering`;

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tracking-wide text-muted-foreground/80 uppercase"
      aria-label="System fingerprint"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            presenceReady ? 'bg-[hsl(var(--success))]' : 'bg-amber-500 animate-pulse',
          )}
          aria-hidden="true"
        />
        backend · {hostPart}
      </span>
      <span className="text-muted-foreground/40" aria-hidden>
        ·
      </span>
      <span>{presenceLabel}</span>
      {typeof __VITE_APP_VERSION__ !== 'undefined' && (
        <>
          <span className="text-muted-foreground/40" aria-hidden>
            ·
          </span>
          <span>v{__VITE_APP_VERSION__}</span>
        </>
      )}
    </div>
  );
}

// ── Primary action card ─────────────────────────────────────────────────────
// Full-width button-as-card. This is the only thing on the page that gets
// filled-blue treatment — the entire hierarchy is built around it.
interface PrimaryActionProps {
  onClick: () => void;
  shortcutLabel: string;
}

function PrimaryAction({ onClick, shortcutLabel }: PrimaryActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add a cluster"
      aria-keyshortcuts="Meta+N Control+N"
      data-testid="welcome-primary-add-cluster"
      className={cn(
        'group relative w-full text-left',
        'rounded-2xl border border-border/60 bg-background',
        'shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-3)]',
        'transition-[border-color,box-shadow,transform,background-color] duration-200 ease-out',
        'hover:border-primary/40 hover:-translate-y-px',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:border-primary/60',
      )}
    >
      <div className="flex items-center gap-5 p-5 sm:p-6">
        {/* Filled primary tile — the only saturated color on the page. */}
        <span
          className={cn(
            'shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-xl',
            'bg-primary text-primary-foreground',
            'shadow-[var(--shadow-2)]',
            'group-hover:scale-[1.03] transition-transform duration-200 ease-out',
          )}
          aria-hidden="true"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
              Add a cluster
            </h2>
            <span
              className={cn(
                'hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md',
                'font-mono text-[10px] text-muted-foreground/80 tracking-wide uppercase',
                'border border-border/60 bg-muted/40',
              )}
              aria-hidden="true"
            >
              {shortcutLabel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Upload a kubeconfig, or paste YAML credentials for a remote cluster.
            Multi-context files get an inline context picker.
          </p>
        </div>

        <ArrowRight
          className={cn(
            'hidden sm:block h-5 w-5 shrink-0 text-muted-foreground/60',
            'transition-transform duration-200 ease-out',
            'group-hover:translate-x-0.5 group-hover:text-primary',
          )}
          aria-hidden="true"
        />
      </div>
    </button>
  );
}

// ── Secondary affordances ───────────────────────────────────────────────────
// Two deferred flows, presented honestly. Outlined, muted, "soon" pill
// instead of a disabled button + tooltip — which is what made the old
// WelcomePage feel like a template.
interface SecondaryTileProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'soon' | 'beta';
}

function SecondaryTile({ icon, title, description, status }: SecondaryTileProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-border/60 bg-transparent',
        'p-4 sm:p-5',
        'text-left',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-sm font-medium text-foreground/90">{title}</span>
        <span
          className={cn(
            'ml-auto inline-flex items-center px-1.5 py-0.5 rounded-md',
            'font-mono text-[10px] tracking-wide uppercase',
            status === 'soon'
              ? 'border border-border/60 bg-muted/40 text-muted-foreground/80'
              : 'border border-primary/30 bg-primary/5 text-primary',
          )}
        >
          {status}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function WelcomePage() {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const [addOpen, setAddOpen] = useState(false);

  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const backendBaseUrl = useBackendConfigStore((s) =>
    getEffectiveBackendBaseUrl(s.backendBaseUrl),
  );

  const discoveredCount = useClusterPresenceStore((s) => s.discovered.length);
  const availableCount = useClusterPresenceStore(
    (s) => s.availableClusters().length,
  );
  const isReady = useClusterPresenceStore((s) => s.isReady);

  // Auto-redirect to /clusters the moment anything becomes available — the
  // presence hook's background retry will populate the store if the backend
  // was momentarily unreachable when the user first landed here.
  useEffect(() => {
    if (availableCount > 0) navigate('/clusters', { replace: true });
  }, [availableCount, navigate]);

  // macOS vs other: show ⌘N vs Ctrl+N, and bind the matching shortcut.
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const shortcutLabel = isMac ? '⌘N' : 'Ctrl+N';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hit = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'n';
      if (!hit) return;
      // Don't fight browser shortcuts when a modal input is focused — the
      // dialog handles its own keys. Only open the dialog from the top-level
      // Welcome surface.
      if (addOpen) return;
      e.preventDefault();
      setAddOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMac, addOpen]);

  const refreshSnapshot = useCallback(async () => {
    try {
      const url = `${backendBaseUrl}/api/v1/presence`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const snap: PresenceSnapshot = await res.json();
      applySnapshot(snap);
    } catch {
      // best-effort; presence SSE will catch up.
    }
  }, [backendBaseUrl, applySnapshot]);

  // One orchestrated entry — stagger three sections with a small delay each.
  // Keep the motion tight (180ms, 4px translate). Reduced-motion disables.
  const enter = (delay: number) =>
    prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 4 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.22, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div
      className="page-container min-h-screen flex flex-col"
      role="main"
      aria-label="Welcome"
    >
      {/* Brand header — same pattern as ClusterPickerPage so the transition
          between the two screens feels stable. */}
      <header className="w-full px-6 pt-14 pb-6 flex flex-col items-center gap-3">
        <motion.div
          initial={prefersReducedMotion ? false : { scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        >
          <BrandLogo mark height={64} className="rounded-2xl shadow-[var(--shadow-2)]" />
        </motion.div>
        <span className="text-[15px] font-semibold tracking-[0.18em] text-foreground/90 uppercase">
          Kubilitics
        </span>
      </header>

      {/* Main column — max-w-2xl keeps reading length comfortable on wide
          monitors while still giving the primary card room to breathe. */}
      <div className="flex-1 flex items-start justify-center px-6 pb-12">
        <div className="w-full max-w-2xl flex flex-col gap-10">

          {/* Fingerprint strip + direct title. Grouped so they enter
              together — the operator reads them as one unit. */}
          <motion.section {...enter(0.02)} className="flex flex-col gap-4">
            <Fingerprint
              backendUrl={backendBaseUrl}
              presenceReady={isReady}
              discoveredCount={discoveredCount}
            />
            <div className="flex flex-col gap-2">
              <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-foreground leading-[1.1]">
                Connect a cluster to begin.
              </h1>
              <p className="text-[15px] text-muted-foreground leading-relaxed max-w-xl">
                Kubilitics discovers kubeconfig contexts automatically and
                registers them in place. Point it at one below, or paste
                credentials for a remote cluster — topology, blast radius,
                and the AI assistant come online the moment the control
                plane responds.
              </p>
            </div>
          </motion.section>

          {/* Primary action — the only saturated-color element on the page. */}
          <motion.section {...enter(0.08)}>
            <PrimaryAction
              onClick={() => setAddOpen(true)}
              shortcutLabel={shortcutLabel}
            />
          </motion.section>

          {/* Secondary affordances. Honestly labelled, not disabled-with-
              tooltip. When these flows ship, swap status to 'beta' or make
              them real buttons. */}
          <motion.section {...enter(0.14)} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground/70">
                Also available
              </span>
              <span className="flex-1 h-px bg-border/50" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SecondaryTile
                icon={<Boxes className="h-4 w-4" aria-hidden="true" />}
                title="Local cluster"
                description="Spin up a throwaway kind or k3d cluster on this machine to evaluate Kubilitics without touching production."
                status="soon"
              />
              <SecondaryTile
                icon={<PlayCircle className="h-4 w-4" aria-hidden="true" />}
                title="Guided tour"
                description="Walk through topology, blast-radius simulation, and the AI assistant against a hosted demo cluster — no setup required."
                status="soon"
              />
            </div>
          </motion.section>

          {/* Quiet footer — SREs expect a build stamp and a link to docs. */}
          <motion.footer
            {...enter(0.2)}
            className="pt-4 mt-2 border-t border-border/40 flex items-center justify-between gap-4 text-[11px] font-mono text-muted-foreground/70"
          >
            <span>
              {typeof __VITE_APP_VERSION__ !== 'undefined'
                ? `kubilitics v${__VITE_APP_VERSION__}`
                : 'kubilitics'}
            </span>
            <span className="tracking-wider uppercase">
              Operational intelligence for Kubernetes
            </span>
          </motion.footer>
        </div>
      </div>

      {/* Dialog: preserved. One primary surface → one dialog. */}
      <AddClusterDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          void refreshSnapshot();
          navigate('/clusters');
        }}
      />

      {/* Offscreen link button gives keyboard users a way to reach the
          primary action via Tab even if they don't know ⌘N. (Screen readers
          follow DOM order; PrimaryAction is the first focusable control,
          so this is defensive.) */}
      <div className="sr-only" aria-hidden="true">
        <Button
          type="button"
          onClick={() => setAddOpen(true)}
          aria-label="Add a cluster (keyboard fallback)"
        />
      </div>
    </div>
  );
}

export default WelcomePage;
