// WelcomePage — zero-kubeconfig fallback landing for onboarding-v2.
//
// Shown when the presence layer reports zero discovered clusters. Offers
// three paths forward:
//   1. Create a local cluster (kind/k3d) — disabled in this phase, the
//      backing flow ships in a follow-up.
//   2. Add an existing cluster — routes to the legacy /connect flow which
//      remains live throughout Phase 5.
//   3. Take the tour — demo mode, deferred.
//
// Wired as "/welcome" in App.tsx (Phase 7: unconditional).
import { useNavigate } from 'react-router-dom';
import { Rocket, Plus, PlayCircle, Sparkles } from 'lucide-react';

import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

  return (
    <div
      className="page-container"
      role="main"
      aria-label="Welcome"
    >
      <div className="page-inner p-6 gap-6 flex flex-col">
        <SectionOverviewHeader
          title="Welcome to Kubilitics"
          description="Let’s get you connected to a cluster."
          icon={Rocket}
        />

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
            onClick={() => navigate('/connect')}
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
      </div>
    </div>
  );
}

export default WelcomePage;
