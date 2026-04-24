// WelcomePage — zero-kubeconfig fallback landing for onboarding-v2.
//
// Shown when the presence layer reports zero discovered clusters. Offers
// three paths forward:
//   1. Create a local cluster (kind/k3d) — disabled in this phase, the
//      backing flow ships in a follow-up.
//   2. Add an existing cluster — opens the AddClusterDialog in-place
//      (no routing to /connect).
//   3. Take the tour — demo mode, deferred.
//
// Wired as "/welcome" in App.tsx (Phase 7: unconditional).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, PlayCircle, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AddClusterDialog } from '@/components/cluster/AddClusterDialog';
import { useClusterPresenceStore } from '@/stores/clusterPresenceStore';
import { getEffectiveBackendBaseUrl, useBackendConfigStore } from '@/stores/backendConfigStore';
import type { PresenceSnapshot } from '@/types/resilient';

interface CtaProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledTooltip?: string;
}

function Cta({
  icon,
  title,
  description,
  buttonLabel,
  onClick,
  disabled,
  disabledTooltip,
}: CtaProps) {
  const button = (
    <Button
      type="button"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      aria-label={buttonLabel}
      className="w-full"
    >
      {buttonLabel}
    </Button>
  );

  return (
    <Card className="border-none soft-shadow glass-panel p-6 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      {disabled && disabledTooltip ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Wrap in span so tooltip still fires on disabled button */}
              <span className="inline-block w-full">{button}</span>
            </TooltipTrigger>
            <TooltipContent>{disabledTooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
    </Card>
  );
}

export function WelcomePage() {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const applySnapshot = useClusterPresenceStore((s) => s.applySnapshot);
  const backendBaseUrl = useBackendConfigStore((s) => getEffectiveBackendBaseUrl(s.backendBaseUrl));
  // Auto-redirect to /clusters once any become available — the presence
  // hook's background retry will populate the store if the backend was
  // temporarily unreachable when we first landed here.
  const availableCount = useClusterPresenceStore(
    (s) => s.availableClusters().length,
  );
  useEffect(() => {
    if (availableCount > 0) navigate('/clusters', { replace: true });
  }, [availableCount, navigate]);

  const refreshSnapshot = useCallback(async () => {
    try {
      const url = `${backendBaseUrl}/api/v1/presence`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const snap: PresenceSnapshot = await res.json();
      applySnapshot(snap);
    } catch {
      // best-effort
    }
  }, [backendBaseUrl, applySnapshot]);

  return (
    <div
      className="page-container"
      role="main"
      aria-label="Welcome"
    >
      <div className="page-inner p-6 gap-6 flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/40"
        >
          <div className="flex items-center gap-4">
            <motion.img
              src="/brand/logo-mark-rounded.png"
              alt="Kubilitics"
              className="h-14 w-14 rounded-2xl shadow-sm"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
            />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Welcome to Kubilitics
              </h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                Let’s get you connected to a cluster.
                <Badge variant="secondary" className="font-normal">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5" />
                  Live
                </Badge>
              </p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Cta
            icon={<Sparkles className="h-5 w-5" aria-hidden />}
            title="Create a local cluster"
            description="Spin up a throwaway kind or k3d cluster on this machine to explore Kubilitics without touching production."
            buttonLabel="Create a local cluster"
            disabled
            disabledTooltip="Coming soon"
          />
          <Cta
            icon={<Plus className="h-5 w-5" aria-hidden />}
            title="Add an existing cluster"
            description="Point Kubilitics at a kubeconfig context or paste credentials for a remote cluster."
            buttonLabel="Add an existing cluster"
            onClick={() => setAddOpen(true)}
          />
          <Cta
            icon={<PlayCircle className="h-5 w-5" aria-hidden />}
            title="Take the tour"
            description="Walk through Kubilitics against a live demo cluster — no setup required."
            buttonLabel="Take the tour"
            disabled
            disabledTooltip="Coming soon"
          />
        </div>

        <AddClusterDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            void refreshSnapshot();
            // Once a cluster is added, the picker page becomes useful.
            navigate('/clusters');
          }}
        />
      </div>
    </div>
  );
}

export default WelcomePage;
