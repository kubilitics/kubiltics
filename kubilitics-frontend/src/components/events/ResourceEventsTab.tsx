/**
 * ResourceEventsTab — Reusable tab component that shows Events Intelligence
 * data for a specific Kubernetes resource. Designed to be embedded inside
 * GenericResourceDetail's tab system.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useEventsQuery } from '@/hooks/useEventsIntelligence';
import { useEventsStore } from '@/stores/eventsStore';
import { EventRow } from './EventRow';
import { EventContextPanel } from './EventContextPanel';
import type { EventQueryParams } from '@/services/api/eventsIntelligence';

/* ─── Time range presets ─────────────────────────────────────────────────── */

const TIME_RANGES: { label: string; value: string; ms: number }[] = [
  { label: 'Last 1h', value: '1h', ms: 3_600_000 },
  { label: 'Last 6h', value: '6h', ms: 21_600_000 },
  { label: 'Last 24h', value: '24h', ms: 86_400_000 },
  { label: 'Last 7d', value: '7d', ms: 604_800_000 },
];

/* ─── Props ──────────────────────────────────────────────────────────────── */

export interface ResourceEventsTabProps {
  resourceKind: string;
  resourceName: string;
  namespace: string;
  clusterId: string | null;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function ResourceEventsTab({
  resourceKind,
  resourceName,
  namespace,
}: ResourceEventsTabProps) {
  const [timeRange, setTimeRange] = useState('24h');

  const timeRangeMs = TIME_RANGES.find((t) => t.value === timeRange)?.ms ?? 86_400_000;

  const params: EventQueryParams = useMemo(
    () => ({
      from: Date.now() - timeRangeMs,
      to: Date.now(),
      namespace: namespace || undefined,
      kind: resourceKind || undefined,
      name: resourceName || undefined,
      limit: 200,
      offset: 0,
    }),
    [timeRangeMs, namespace, resourceKind, resourceName],
  );

  const { data: events, isLoading, isFetching } = useEventsQuery(params);

  const sortedEvents = useMemo(
    () => (events ?? []).slice().sort((a, b) => b.timestamp - a.timestamp),
    [events],
  );

  const selectEvent = useEventsStore((s) => s.selectEvent);
  const handleViewContext = (eventId: string) => {
    selectEvent(eventId);
  };

  // Build link to Events Intelligence page with pre-applied filters
  const eventsIntelligenceLink = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (namespace) searchParams.set('namespace', namespace);
    if (resourceKind) searchParams.set('kind', resourceKind);
    if (resourceName) searchParams.set('name', resourceName);
    const qs = searchParams.toString();
    return `/events-intelligence${qs ? `?${qs}` : ''}`;
  }, [namespace, resourceKind, resourceName]);

  return (
    <>
    <Card className="border-none soft-shadow glass-panel">
      {/* Header */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Events for {resourceName}
              {sortedEvents.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5">
                  {sortedEvents.length}
                </Badge>
              )}
              {isFetching && !isLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </CardTitle>
          </div>

          <div className="flex items-center gap-3">
            {/* Time range selector */}
            <div className="flex items-center gap-1">
              {TIME_RANGES.map((t) => (
                <Button
                  key={t.value}
                  variant={timeRange === t.value ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => setTimeRange(t.value)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            {/* Cluster-wide investigation entry point */}
            <Link
              to={eventsIntelligenceLink}
              className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap',
                'text-primary hover:text-primary/80 transition-colors',
              )}
              title="Investigate this resource cluster-wide"
            >
              Open in Events Intelligence
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </CardHeader>

      {/* Event list */}
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-16 shrink-0" />
                <Skeleton className="h-5 w-14 shrink-0" />
                <Skeleton className="h-5 flex-1" />
              </div>
            ))}
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Activity className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No events found for this resource</p>
            <p className="text-xs mt-1">
              Try expanding the time range or check Events Intelligence for cluster-wide events
            </p>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            {sortedEvents.map((event) => (
              <EventRow
                key={event.event_id}
                event={event}
                onViewContext={handleViewContext}
              />
            ))}
          </div>
        )}
      </CardContent>

    </Card>
    {/* Slide-out context panel — driven by useEventsStore */}
    <EventContextPanel />
    </>
  );
}
