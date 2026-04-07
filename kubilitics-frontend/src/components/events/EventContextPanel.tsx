/**
 * EventContextPanel — right slide-out panel showing full event context.
 * Uses Sheet from shadcn/ui.
 */
import { Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Shield, GitBranch, Zap, ArrowDown, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEvent, useCausalChain } from '@/hooks/useEventsIntelligence';
import { useLinkedTraces } from '@/hooks/useTraces';
import { useEventsStore } from '@/stores/eventsStore';

export function EventContextPanel() {
  const { selectedEventId, contextPanelOpen } = useEventsStore();
  const setContextPanelOpen = useEventsStore((s) => s.setContextPanelOpen);

  const { data: context, isLoading } = useEvent(selectedEventId);
  const { data: chain } = useCausalChain(selectedEventId);
  const { data: linkedTraces } = useLinkedTraces(selectedEventId);

  const event = context?.event;

  return (
    <Sheet open={contextPanelOpen} onOpenChange={setContextPanelOpen}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base font-semibold flex items-center gap-2">
            {event ? (
              <>
                <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary text-xs font-bold">
                  {event.resource_kind?.slice(0, 2)}
                </span>
                {event.resource_name}
              </>
            ) : (
              'Event Context'
            )}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : event ? (
          <div className="space-y-5 mt-4">
            {/* Health Score */}
            <ContextSection title="Health Score">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xl font-bold font-mono">
                      {event.health_score != null ? Math.round(event.health_score) : '--'}
                    </span>
                    <Badge variant="outline" className={cn(
                      'text-xs',
                      (event.health_score ?? 100) >= 80 ? 'text-green-500 border-green-500/20' :
                      (event.health_score ?? 100) >= 50 ? 'text-amber-500 border-amber-500/20' :
                      'text-red-500 border-red-500/20',
                    )}>
                      {(event.health_score ?? 100) >= 80 ? 'Healthy' :
                       (event.health_score ?? 100) >= 50 ? 'Degraded' : 'Critical'}
                    </Badge>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        (event.health_score ?? 100) >= 80 ? 'bg-green-500' :
                        (event.health_score ?? 100) >= 50 ? 'bg-amber-500' : 'bg-red-500',
                      )}
                      style={{ width: `${Math.min(100, event.health_score ?? 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </ContextSection>

            {/* SPOF Status */}
            <ContextSection title="SPOF Status">
              <div className="flex items-center gap-2">
                <Shield className={cn('h-5 w-5', event.is_spof === 1 ? 'text-red-500' : 'text-green-500')} />
                <span className="text-sm font-medium">
                  {event.is_spof === 1 ? 'Single Point of Failure' : 'Redundant'}
                </span>
              </div>
            </ContextSection>

            {/* Blast Radius */}
            <ContextSection title="Blast Radius">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-amber-500" />
                <div>
                  <span className="text-xl font-bold font-mono">{event.blast_radius}</span>
                  <span className="text-xs text-muted-foreground ml-1">affected resources</span>
                </div>
              </div>
            </ContextSection>

            {/* Causal Chain */}
            {chain && chain.links && chain.links.length > 0 && (
              <ContextSection title="Causal Chain">
                <div className="space-y-0">
                  {chain.links.map((link, i) => (
                    <div key={link.event_id} className="flex items-start gap-2">
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'w-3 h-3 rounded-full shrink-0 mt-1',
                          i === 0 ? 'bg-red-500' : i === chain.links.length - 1 ? 'bg-blue-500' : 'bg-muted-foreground/40',
                        )} />
                        {i < chain.links.length - 1 && (
                          <div className="w-px h-8 bg-border" />
                        )}
                      </div>
                      <div className="pb-3">
                        <p className="text-xs font-medium">
                          {link.resource_kind}/{link.resource_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {link.reason}
                          {link.confidence > 0 && (
                            <span className="ml-1 opacity-60">
                              ({Math.round(link.confidence * 100)}% confidence)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ContextSection>
            )}

            {/* Related Events */}
            {context.related_events && context.related_events.length > 0 && (
              <ContextSection title="Related Events">
                <div className="space-y-1.5">
                  {context.related_events.slice(0, 10).map((re) => (
                    <div key={re.event_id} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className={cn(
                        'text-[10px] px-1 py-0 h-4 shrink-0',
                        re.event_type === 'Warning'
                          ? 'bg-amber-500/15 text-amber-600 border-amber-500/20'
                          : 'bg-blue-500/15 text-blue-600 border-blue-500/20',
                      )}>
                        {re.event_type}
                      </Badge>
                      <span className="truncate" title={`${re.resource_kind}/${re.resource_name}`}>{re.resource_kind}/{re.resource_name}</span>
                      <span className="text-muted-foreground/60 shrink-0">{re.reason}</span>
                    </div>
                  ))}
                </div>
              </ContextSection>
            )}

            {/* Changes */}
            {context.changes && context.changes.length > 0 && (
              <ContextSection title="Recent Changes">
                <div className="space-y-2">
                  {context.changes.slice(0, 5).map((ch) => (
                    <div key={ch.change_id} className="text-xs bg-muted/50 rounded-md p-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{ch.change_type}</span>
                        <span className="text-muted-foreground/60">
                          {ch.resource_kind}/{ch.resource_name}
                        </span>
                      </div>
                      {ch.field_changes && Array.isArray(ch.field_changes) && ch.field_changes.length > 0 && (
                        <div className="space-y-0.5 mt-1">
                          {ch.field_changes.slice(0, 3).map((fc, i) => (
                            <div key={i} className="font-mono text-[10px]">
                              <span className="text-muted-foreground">{fc.field}: </span>
                              <span className="text-red-500 line-through">{fc.old_value?.slice(0, 30)}</span>
                              {' '}
                              <span className="text-green-500">{fc.new_value?.slice(0, 30)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ContextSection>
            )}

            {/* Linked Traces */}
            {linkedTraces && linkedTraces.length > 0 && (
              <ContextSection title="Linked Traces">
                <div className="space-y-1.5">
                  {linkedTraces.slice(0, 5).map((trace) => (
                    <Link
                      key={trace.trace_id}
                      to={`/traces?traceId=${encodeURIComponent(trace.trace_id)}`}
                      className="flex items-center gap-2 text-xs bg-muted/50 rounded-md p-2 hover:bg-muted/80 transition-colors group"
                    >
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full shrink-0',
                          trace.status === 'ERROR'
                            ? 'bg-red-500'
                            : trace.status === 'OK'
                              ? 'bg-green-500'
                              : 'bg-muted-foreground/40',
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{trace.root_service || 'unknown'}</span>
                        <span className="text-muted-foreground/60 mx-1">&middot;</span>
                        <span className="text-muted-foreground truncate">{trace.root_operation || '-'}</span>
                      </div>
                      <span className="font-mono text-muted-foreground/60 shrink-0">
                        {trace.duration_ns < 1_000_000
                          ? `${(trace.duration_ns / 1_000).toFixed(0)}us`
                          : trace.duration_ns < 1_000_000_000
                            ? `${(trace.duration_ns / 1_000_000).toFixed(0)}ms`
                            : `${(trace.duration_ns / 1_000_000_000).toFixed(1)}s`}
                      </span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary shrink-0" />
                    </Link>
                  ))}
                </div>
              </ContextSection>
            )}

            {/* Event details */}
            <ContextSection title="Event Details">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <DetailItem label="Kind" value={event.resource_kind} />
                <DetailItem label="Namespace" value={event.resource_namespace} />
                <DetailItem label="Reason" value={event.reason} />
                <DetailItem label="Severity" value={event.severity} />
                <DetailItem label="Source" value={event.source_component} />
                <DetailItem label="Node" value={event.node_name} />
                <DetailItem label="Owner" value={`${event.owner_kind}/${event.owner_name}`} />
                <DetailItem label="Count" value={String(event.event_count)} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">{event.message}</p>
            </ContextSection>
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            No event selected
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function ContextSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground/60">{label}: </span>
      <span className="font-medium">{value || '-'}</span>
    </div>
  );
}
