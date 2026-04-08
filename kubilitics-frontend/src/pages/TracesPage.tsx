/**
 * TracesPage — Distributed Traces via OpenTelemetry.
 * Two modes: Trace List (filterable table) and Service Map (dependency graph).
 */
import { useCallback, useState } from 'react';
import { GitBranch, List, Network } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { useTracesStore, type TracesMode } from '@/stores/tracesStore';
import { TraceList } from '@/components/traces/TraceList';
import { ServiceMapView } from '@/components/traces/ServiceMapView';
import { TraceDetailPanel } from '@/components/traces/TraceDetailPanel';
import { TracingStatus } from '@/components/traces/TracingStatus';
import { TracingSetup } from '@/components/traces/TracingSetup';
import { ComponentErrorBoundary } from '@/components/ui/component-error-boundary';

/* ─── Mode tabs ──────────────────────────────────────────────────────────── */

const MODES: { value: TracesMode; label: string; icon: typeof List }[] = [
  { value: 'list', label: 'Trace List', icon: List },
  { value: 'map', label: 'Service Map', icon: Network },
];

function ModeTabs({ mode, onChange }: { mode: TracesMode; onChange: (m: TracesMode) => void }) {
  return (
    <div className="flex items-center bg-muted/50 rounded-lg p-0.5">
      {MODES.map((m) => {
        const Icon = m.icon;
        const isActive = mode === m.value;
        return (
          <Button
            key={m.value}
            variant={isActive ? 'default' : 'ghost'}
            size="sm"
            className={cn(
              'h-8 text-xs gap-1.5 rounded-md transition-all',
              isActive
                ? 'shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(m.value)}
          >
            <Icon className="h-3.5 w-3.5" />
            {m.label}
          </Button>
        );
      })}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */

export default function TracesPage() {
  const store = useTracesStore();
  const queryClient = useQueryClient();
  const [setupOpen, setSetupOpen] = useState(false);

  const handleSync = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['traces'] });
  }, [queryClient]);

  return (
    <PageLayout label="Distributed Traces">
      <SectionOverviewHeader
        title="Distributed Traces"
        description="Application-level request traces via OpenTelemetry."
        icon={GitBranch}
        iconClassName="from-purple-500/20 to-purple-500/5 text-purple-500 border-purple-500/10"
        onSync={handleSync}
        extraActions={
          <div className="flex items-center gap-2">
            <TracingStatus onSetupClick={() => setSetupOpen(true)} />
            <ModeTabs mode={store.mode} onChange={store.setMode} />
          </div>
        }
      />

      <ComponentErrorBoundary name="Trace List">
        {store.mode === 'list' && <TraceList />}
      </ComponentErrorBoundary>
      <ComponentErrorBoundary name="Service Map">
        {store.mode === 'map' && <ServiceMapView />}
      </ComponentErrorBoundary>

      <ComponentErrorBoundary name="Trace Detail">
        <TraceDetailPanel />
      </ComponentErrorBoundary>

      <TracingSetup
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onComplete={() => {
          setSetupOpen(false);
          queryClient.invalidateQueries({ queryKey: ['traces'] });
        }}
      />
    </PageLayout>
  );
}
