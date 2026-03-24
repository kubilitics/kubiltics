import { CheckCircle2, AlertTriangle, XCircle, Info, CalendarClock } from 'lucide-react';
import { SectionCard } from './SectionCard';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface EventInfo {
  type: 'Normal' | 'Warning' | 'Error';
  reason: string;
  message: string;
  time: string;
  count?: number;
  historical?: boolean;
}

export interface EventsSectionProps {
  events: EventInfo[];
  isLoading?: boolean;
}

const eventConfig = {
  Normal: { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200/50 dark:border-emerald-800/30' },
  Warning: { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200/50 dark:border-amber-800/30' },
  Error: { icon: XCircle, color: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border-rose-200/50 dark:border-rose-800/30' },
};

export function EventsSection({ events, isLoading }: EventsSectionProps) {
  return (
    <SectionCard
      icon={CalendarClock}
      title="Events"
      tooltip={
        <>
          <p className="font-medium">Events</p>
          <p className="mt-1 text-muted-foreground text-xs">Recent events for this resource</p>
        </>
      }
    >
      {isLoading ? (
          <div className="space-y-4 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-4">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="space-y-4">
          {(() => {
            const liveEvents = events.filter(e => !e.historical);
            const historicalEvents = events.filter(e => e.historical);

            return (
              <>
                {/* Live events from Kubernetes API */}
                {liveEvents.map((event, i) => {
                  const config = eventConfig[event.type];
                  const EventIcon = config.icon;
                  return (
                    <div key={`live-${i}`} className="flex items-start gap-3.5 pb-4 border-b border-border/40 last:border-0 last:pb-0 transition-colors hover:bg-muted/20 -mx-2 px-2 rounded-lg">
                      <div className={cn('p-2 rounded-xl mt-0.5 border shadow-sm', config.bg, config.border)}>
                        <EventIcon className={cn('h-3.5 w-3.5', config.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{event.reason}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">{event.time}</span>
                          {event.count != null && event.count > 1 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-muted/80 text-muted-foreground border border-border/30 tabular-nums">×{event.count}</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{event.message}</p>
                      </div>
                    </div>
                  );
                })}

                {/* Historical events from Kubilitics DB (K8s events expired) */}
                {historicalEvents.length > 0 && (
                  <>
                    {liveEvents.length > 0 && <div className="border-t border-border/40 pt-3 mt-1" />}
                    <div className="flex items-center gap-2 mb-2">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                        {liveEvents.length > 0 ? 'Previous Events' : 'Event History'}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40">Stored by Kubilitics</span>
                    </div>
                    {historicalEvents.map((event, i) => {
                      const config = eventConfig[event.type];
                      const EventIcon = config.icon;
                      return (
                        <div key={`hist-${i}`} className="flex items-start gap-3.5 pb-3 border-b border-border/20 last:border-0 last:pb-0 opacity-70 -mx-2 px-2 rounded-lg">
                          <div className={cn('p-2 rounded-xl mt-0.5 border shadow-sm', config.bg, config.border)}>
                            <EventIcon className={cn('h-3.5 w-3.5', config.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">{event.reason}</span>
                              <span className="text-[11px] text-muted-foreground tabular-nums">{event.time}</span>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{event.message}</p>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {events.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                    <div className="p-3 rounded-xl bg-muted/40 border border-border/30 mb-1">
                      <Info className="h-5 w-5 opacity-70" />
                    </div>
                    <p className="text-sm font-medium">No events recorded</p>
                    <p className="text-xs text-muted-foreground/70">Events will appear here when the cluster reports changes</p>
                  </div>
                )}
              </>
            );
          })()}
        </div>
        )}
    </SectionCard>
  );
}
