/**
 * Events Intelligence — main page with 3 modes: Timeline, Analyze, Incidents.
 * Real-time K8s event stream enriched with operational context.
 */
import { useCallback } from 'react';
import { Activity, BarChart3, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SectionOverviewHeader } from '@/components/layout/SectionOverviewHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { useEventsStore, type EventsMode } from '@/stores/eventsStore';
import { useActiveInsights, useDismissInsight } from '@/hooks/useEventsIntelligence';
import { EventTimeline } from '@/components/events/EventTimeline';
import { EventAnalyze } from '@/components/events/EventAnalyze';
import { IncidentView } from '@/components/events/IncidentView';
import { EventContextPanel } from '@/components/events/EventContextPanel';
import { InsightsBanner } from '@/components/events/InsightsBanner';
import { EventStatsBar } from '@/components/events/EventStatsBar';
import { ComponentErrorBoundary } from '@/components/ui/component-error-boundary';
import type { Insight } from '@/services/api/eventsIntelligence';

/* ─── Mode tabs ──────────────────────────────────────────────────────────── */

const MODES: { value: EventsMode; label: string; icon: typeof Activity }[] = [
  { value: 'timeline', label: 'Timeline', icon: Activity },
  { value: 'analyze', label: 'Analyze', icon: BarChart3 },
  { value: 'incidents', label: 'Incidents', icon: AlertCircle },
];

function ModeTabs({ mode, onChange }: { mode: EventsMode; onChange: (m: EventsMode) => void }) {
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

export default function EventsIntelligence() {
  const store = useEventsStore();
  const { data: insights } = useActiveInsights();
  const dismissMutation = useDismissInsight();
  const queryClient = useQueryClient();

  const activeInsights = insights ?? [];

  const handleSync = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['events-intelligence'] });
  }, [queryClient]);

  const handleInvestigate = useCallback(
    (insight: Insight) => {
      // Switch to Incidents tab — shows grouped incident cards with related events
      store.setMode('incidents');
    },
    [store],
  );

  const handleDismiss = useCallback(
    (insightId: string) => {
      dismissMutation.mutate(insightId);
    },
    [dismissMutation],
  );

  return (
    <PageLayout label="Events Intelligence">
      {/* Insights banner */}
      {activeInsights.length > 0 && (
        <InsightsBanner
          insights={activeInsights}
          onInvestigate={handleInvestigate}
          onDismiss={handleDismiss}
          isDismissing={dismissMutation.isPending}
        />
      )}

      {/* Header */}
      <SectionOverviewHeader
        title="Events Intelligence"
        description="Real-time K8s event stream enriched with operational context."
        icon={Activity}
        iconClassName="from-blue-500/20 to-blue-500/5 text-blue-500 border-blue-500/10"
        onSync={handleSync}
        extraActions={<ModeTabs mode={store.mode} onChange={store.setMode} />}
      />

      {/* Mode content */}
      <ComponentErrorBoundary name="Timeline">
        {store.mode === 'timeline' && <EventTimeline />}
      </ComponentErrorBoundary>
      <ComponentErrorBoundary name="Analysis">
        {store.mode === 'analyze' && <EventAnalyze />}
      </ComponentErrorBoundary>
      <ComponentErrorBoundary name="Incidents">
        {store.mode === 'incidents' && <IncidentView />}
      </ComponentErrorBoundary>

      {/* Stats bar */}
      <EventStatsBar />

      {/* Context panel (slide-out) */}
      <EventContextPanel />
    </PageLayout>
  );
}
