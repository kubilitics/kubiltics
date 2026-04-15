/**
 * EventRow — a single event row with collapsed/expanded states.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Eye, GitBranch, AlertTriangle, Shield, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WideEvent } from '@/services/api/eventsIntelligence';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const TYPE_STYLES: Record<string, string> = {
  Warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
  Normal: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
};

const KIND_MAP: Record<string, { abbr: string; color: string }> = {
  Pod: { abbr: 'Pod', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  Deployment: { abbr: 'Deploy', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' },
  ReplicaSet: { abbr: 'RS', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  StatefulSet: { abbr: 'STS', color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  DaemonSet: { abbr: 'DS', color: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400' },
  Service: { abbr: 'Svc', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  Node: { abbr: 'Node', color: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  Job: { abbr: 'Job', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  CronJob: { abbr: 'CronJob', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  Ingress: { abbr: 'Ingress', color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  ConfigMap: { abbr: 'CM', color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  Secret: { abbr: 'Secret', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  PersistentVolumeClaim: { abbr: 'PVC', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
};

/* ─── Component ──────────────────────────────────────────────────────────── */

interface EventRowProps {
  event: WideEvent;
  onViewContext: (eventId: string) => void;
}

export function EventRow({ event, onViewContext }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);

  const kindInfo = KIND_MAP[event.resource_kind] ?? { abbr: event.resource_kind ?? '?', color: 'bg-muted text-muted-foreground' };
  const typeStyle = TYPE_STYLES[event.event_type] ?? TYPE_STYLES.Normal;
  const isWarning = event.event_type === 'Warning';
  const healthDelta = event.health_score != null ? Math.round(event.health_score) : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'border-b border-border/30 last:border-b-0',
        isWarning && 'border-l-2 border-l-amber-500/50',
      )}
    >
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors cursor-pointer group"
      >
        {/* Expand chevron */}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200 shrink-0',
            expanded && 'rotate-90',
          )}
        />

        {/* Leading type icon */}
        {isWarning ? (
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
        ) : (
          <Info className="h-4 w-4 text-slate-500 shrink-0" />
        )}

        {/* Primary + secondary lines */}
        <div className="flex flex-col min-w-0 flex-1">
          {/* Primary line: the human-readable message */}
          <span
            className="text-sm font-medium text-foreground truncate"
            title={event.message}
          >
            {event.message}
          </span>

          {/* Secondary line: kind · resource · age · count · reason */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span className={cn(
              'inline-flex items-center justify-center rounded px-1 text-[10px] font-semibold shrink-0',
              kindInfo.color,
            )}>
              {kindInfo.abbr}
            </span>
            <span className="truncate shrink-0 max-w-[200px]">{event.resource_name}</span>
            <span className="text-muted-foreground/40 shrink-0">·</span>
            <span className="tabular-nums font-mono shrink-0">{relativeTime(event.timestamp)}</span>
            {event.event_count > 1 && (
              <>
                <span className="text-muted-foreground/40 shrink-0">·</span>
                <span className="shrink-0">x{event.event_count}</span>
              </>
            )}
            {event.reason && (
              <>
                <span className="text-muted-foreground/40 shrink-0">·</span>
                <span className="truncate hidden md:inline">{event.reason}</span>
              </>
            )}
          </div>
        </div>

        {/* Health delta */}
        {healthDelta != null && healthDelta !== 0 && (
          <Badge variant="outline" className={cn(
            'text-[10px] px-1.5 py-0 h-5 shrink-0 font-mono',
            healthDelta < 0 ? 'text-red-500 border-red-500/20' : 'text-green-500 border-green-500/20',
          )}>
            {healthDelta > 0 ? '+' : ''}{healthDelta}
          </Badge>
        )}

        {/* SPOF badge */}
        {event.is_spof === 1 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0 bg-red-500/10 text-red-500 border-red-500/20">
            <Shield className="h-2.5 w-2.5 mr-0.5" />
            SPOF
          </Badge>
        )}
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pl-12 space-y-3">
              {/* Message */}
              <p className="text-sm text-muted-foreground">{event.message}</p>

              {/* Dimensions grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                <DimItem label="Kind" value={event.resource_kind} />
                <DimItem label="Name" value={event.resource_name} />
                <DimItem label="Namespace" value={event.resource_namespace} />
                <DimItem label="Reason" value={event.reason} />
                <DimItem label="Source" value={event.source_component} />
                <DimItem label="Node" value={event.node_name} />
                <DimItem label="Owner" value={event.owner_kind ? `${event.owner_kind}/${event.owner_name}` : '-'} />
                <DimItem label="Severity" value={event.severity} />
                <DimItem label="Blast Radius" value={String(event.blast_radius)} />
                <DimItem label="Event Count" value={String(event.event_count)} />
                <DimItem label="Health Score" value={event.health_score != null ? String(Math.round(event.health_score)) : '-'} />
                <DimItem label="Correlation" value={event.correlation_group_id?.slice(0, 8) || '-'} />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewContext(event.event_id);
                  }}
                >
                  <Eye className="h-3 w-3" />
                  View Context
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewContext(event.event_id);
                  }}
                >
                  <GitBranch className="h-3 w-3" />
                  View Chain
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DimItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground/60">{label}: </span>
      <span className="font-medium text-foreground">{value || '-'}</span>
    </div>
  );
}
