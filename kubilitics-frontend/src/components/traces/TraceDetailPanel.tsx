/**
 * TraceDetailPanel — Trace detail slide-out.
 * Shows waterfall for multi-span traces, direct detail for single-span traces.
 */
import { useMemo, useState, useEffect } from 'react';
import { Clock, Layers, AlertTriangle, Server, Database, Globe, ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useTracesStore } from '@/stores/tracesStore';
import { getBackendBase } from '@/lib/backendUrl';
import type { Span, TraceDetail } from '@/services/api/traces';

function fmtDur(ns: number): string {
  const ms = ns / 1_000_000;
  if (ms < 1) return `${(ns / 1_000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const COLORS = [
  { bar: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text: '#3b82f6' },
  { bar: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', text: '#8b5cf6' },
  { bar: '#06b6d4', bg: 'rgba(6,182,212,0.08)', text: '#06b6d4' },
  { bar: '#10b981', bg: 'rgba(16,185,129,0.08)', text: '#10b981' },
  { bar: '#f59e0b', bg: 'rgba(245,158,11,0.08)', text: '#f59e0b' },
  { bar: '#ec4899', bg: 'rgba(236,72,153,0.08)', text: '#ec4899' },
];
const ERR = { bar: '#ef4444', bg: 'rgba(239,68,68,0.06)', text: '#ef4444' };

interface SpanNode { span: Span; children: SpanNode[]; depth: number; }

function buildTree(spans: Span[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];
  for (const s of spans) byId.set(s.span_id, { span: s, children: [], depth: 0 });
  for (const s of spans) {
    const node = byId.get(s.span_id)!;
    const parent = s.parent_span_id ? byId.get(s.parent_span_id) : null;
    if (parent) { node.depth = parent.depth + 1; parent.children.push(node); }
    else roots.push(node);
  }
  const flat: SpanNode[] = [];
  function walk(n: SpanNode) { flat.push(n); n.children.sort((a, b) => a.span.start_time - b.span.start_time).forEach(walk); }
  roots.sort((a, b) => a.span.start_time - b.span.start_time).forEach(walk);
  return flat;
}

export function TraceDetailPanel() {
  const { selectedTraceId, selectedSpanId, selectTrace, selectSpan } = useTracesStore();
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!selectedTraceId) { setTraceDetail(null); return; }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const base = getBackendBase();
        const cl: Array<{ id: string; status: string }> = await (await fetch(`${base}/api/v1/clusters`)).json();
        const c = cl.find((x) => x.status === 'connected');
        if (!c) { setIsLoading(false); return; }
        const d = await (await fetch(`${base}/api/v1/clusters/${c.id}/traces/${selectedTraceId}`)).json();
        if (!cancelled) { setTraceDetail(d); setIsLoading(false); }
      } catch { if (!cancelled) setIsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedTraceId]);

  const open = !!selectedTraceId;
  const spans = (traceDetail?.spans || []) as Span[];
  const summary = traceDetail?.summary;
  const tree = useMemo(() => buildTree(spans), [spans]);
  const colorMap = useMemo(() => {
    const m = new Map<string, number>();
    [...new Set(spans.map(s => s.service_name))].forEach((s, i) => m.set(s, i));
    return m;
  }, [spans]);

  const startNs = summary?.start_time ?? 0;
  const durNs = summary?.duration_ns ?? 1;

  // Auto-select the only span for single-span traces
  useEffect(() => {
    if (spans.length === 1 && !selectedSpanId) {
      selectSpan(spans[0].span_id);
    }
  }, [spans, selectedSpanId, selectSpan]);

  const activeSpan = selectedSpanId ? spans.find(s => s.span_id === selectedSpanId) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { selectTrace(null); selectSpan(null); } }}>
      <SheetContent
        className="w-full sm:max-w-3xl lg:max-w-4xl p-0 flex flex-col border-l border-border/50 shadow-2xl !top-[60px] !h-[calc(100vh-60px)] rounded-tl-xl"
        side="right"
      >
        {/* Header */}
        <div className="shrink-0 bg-card/80 backdrop-blur-sm border-b border-border/40 px-5 py-3">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Trace Detail</span>
          </div>
          {summary && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-[10px] text-muted-foreground/70 font-mono select-all">{summary.trace_id}</code>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="h-5 text-[10px] gap-1"><Clock className="h-2.5 w-2.5" />{fmtDur(summary.duration_ns)}</Badge>
                <Badge variant="outline" className="h-5 text-[10px] gap-1"><Layers className="h-2.5 w-2.5" />{summary.span_count} spans</Badge>
                <Badge variant="outline" className="h-5 text-[10px]">{summary.service_count} svc</Badge>
                {summary.error_count > 0 && (
                  <Badge className="h-5 text-[10px] gap-1 bg-red-500/10 text-red-600 border-red-500/20">
                    <AlertTriangle className="h-2.5 w-2.5" />{summary.error_count} err
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          {isLoading && (
            <div className="p-6 flex items-center justify-center h-40">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {!isLoading && spans.length > 0 && (
            <div className="flex flex-col">
              {/* Waterfall (only useful for multi-span traces) */}
              {spans.length > 1 && (
                <div className="px-4 py-3 border-b border-border/30">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">Waterfall</div>
                  {/* Time axis */}
                  <div className="flex text-[9px] text-muted-foreground/50 font-mono mb-1 ml-[140px]">
                    <span>0</span><span className="flex-1 text-center">{fmtDur(durNs / 2)}</span><span>{fmtDur(durNs)}</span>
                  </div>
                  <div className="space-y-px">
                    {tree.map((node) => {
                      const s = node.span;
                      const isErr = s.status_code === 'ERROR';
                      const c = isErr ? ERR : COLORS[(colorMap.get(s.service_name) ?? 0) % COLORS.length];
                      const offPct = ((s.start_time - startNs) / durNs) * 100;
                      const wPct = Math.max((s.duration_ns / durNs) * 100, 2);
                      const isSel = selectedSpanId === s.span_id;
                      return (
                        <div
                          key={s.span_id}
                          className={cn('flex items-center h-7 rounded cursor-pointer transition-colors', isSel ? 'bg-primary/[0.06]' : 'hover:bg-muted/40')}
                          onClick={() => selectSpan(isSel ? null : s.span_id)}
                        >
                          <div className="w-[180px] shrink-0 truncate text-[11px] font-medium px-2" title={s.service_name} style={{ paddingLeft: `${8 + node.depth * 14}px`, color: c.text }}>
                            {s.service_name}
                          </div>
                          <div className="flex-1 relative h-full flex items-center">
                            <div
                              className="absolute h-4 rounded-[2px] transition-all"
                              style={{ left: `${offPct}%`, width: `${wPct}%`, minWidth: '4px', backgroundColor: c.bar, opacity: isSel ? 0.9 : 0.6 }}
                            >
                              {wPct > 12 && <span className="absolute inset-0 flex items-center px-1 text-[8px] text-white font-medium truncate">{s.operation_name}</span>}
                            </div>
                            <span className="absolute text-[9px] font-mono text-muted-foreground/60" style={{ left: `${Math.min(offPct + wPct + 1, 90)}%` }}>
                              {fmtDur(s.duration_ns)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Legend */}
                  <div className="flex gap-3 mt-2 pt-2 border-t border-border/20">
                    {[...colorMap.entries()].map(([svc, idx]) => (
                      <div key={svc} className="flex items-center gap-1">
                        <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS[idx % COLORS.length].bar }} />
                        <span className="text-[9px] text-muted-foreground">{svc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Span Detail — always visible for selected span (or only span) */}
              {activeSpan && <SpanCard span={activeSpan} colorMap={colorMap} />}

              {/* If multi-span and nothing selected, prompt */}
              {spans.length > 1 && !activeSpan && (
                <div className="px-5 py-8 text-center text-muted-foreground">
                  <p className="text-sm">Click a span in the waterfall to see details</p>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Span Detail Card ─────────────────────────────────────────────────── */

function SpanCard({ span, colorMap }: { span: Span; colorMap: Map<string, number> }) {
  const [showAttrs, setShowAttrs] = useState(true);
  const isErr = span.status_code === 'ERROR';
  const c = isErr ? ERR : COLORS[(colorMap.get(span.service_name) ?? 0) % COLORS.length];

  return (
    <div className="m-4 rounded-lg overflow-hidden border" style={{ borderColor: `${c.bar}30`, backgroundColor: c.bg }}>
      {/* Card header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${c.bar}20` }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: c.bar }} />
          <span className="text-xs font-semibold" style={{ color: c.text }}>{span.service_name}</span>
          <span className="text-xs text-muted-foreground/50">·</span>
          <span className="text-xs font-medium text-foreground truncate">{span.operation_name}</span>
        </div>
        <Badge className={cn('h-5 text-[10px] shrink-0', isErr ? 'bg-red-500/15 text-red-600 border-red-500/25' : 'bg-emerald-500/15 text-emerald-600 border-emerald-500/25')} variant="outline">
          {isErr ? 'ERROR' : 'OK'} · {fmtDur(span.duration_ns)}
        </Badge>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ backgroundColor: `${c.bar}10` }}>
        <InfoCell label="Method" value={span.http_method || '—'} />
        <InfoCell label="Route" value={span.http_route || span.operation_name} />
        <InfoCell label="Status" value={span.http_status_code ? String(span.http_status_code) : (isErr ? 'ERROR' : 'OK')} isError={isErr || (span.http_status_code && span.http_status_code >= 400)} />
        <InfoCell label="Duration" value={fmtDur(span.duration_ns)} />
      </div>

      {/* Sections */}
      <div className="divide-y" style={{ borderColor: `${c.bar}15` }}>
        {/* K8s context */}
        {(span.k8s_pod_name || span.k8s_namespace) && (
          <div className="px-4 py-2.5 bg-background/40">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">Kubernetes</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              {span.k8s_namespace && <KV k="Namespace" v={span.k8s_namespace} />}
              {span.k8s_pod_name && <KV k="Pod" v={span.k8s_pod_name} />}
              {span.k8s_node_name && <KV k="Node" v={span.k8s_node_name} />}
              {span.k8s_deployment && <KV k="Deployment" v={span.k8s_deployment} />}
            </div>
          </div>
        )}

        {/* Database */}
        {span.db_system && (
          <div className="px-4 py-2.5 bg-background/40">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">Database</div>
            <div className="text-xs space-y-1">
              <KV k="System" v={span.db_system} />
              {span.db_statement && (
                <div>
                  <span className="text-muted-foreground text-[10px]">Query</span>
                  <pre className="mt-0.5 text-[11px] font-mono bg-background/60 rounded px-2 py-1 overflow-x-auto">{span.db_statement}</pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error message */}
        {isErr && span.status_message && (
          <div className="px-4 py-2.5 bg-red-500/[0.03]">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-red-500" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-red-500/70">Error</span>
            </div>
            <p className="text-xs text-red-600 font-mono">{span.status_message}</p>
          </div>
        )}

        {/* Span events (exceptions) */}
        {Array.isArray(span.events) && span.events.length > 0 && (
          <div className="px-4 py-2.5 bg-background/40">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1.5">Events</div>
            {(span.events as Array<Record<string, unknown>>).map((evt, i: number) => (
              <div key={i} className="rounded bg-background/60 p-2 mb-1 last:mb-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-0.5">
                  {evt.name === 'exception' && <AlertTriangle className="h-3 w-3 text-red-500" />}
                  {evt.name as string}
                </div>
                {evt.attributes && (
                  <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                    {(Array.isArray(evt.attributes) ? evt.attributes as Array<{ key: string; value?: { stringValue?: string } }> : []).map((a, j: number) => (
                      <div key={j}><span className="text-red-400">{a.key}:</span> {a.value?.stringValue || JSON.stringify(a.value)}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Attributes (collapsible) */}
        {span.attributes && Object.keys(span.attributes).length > 0 && (
          <div className="px-4 py-2.5 bg-background/40">
            <button className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40 hover:text-muted-foreground transition-colors" onClick={() => setShowAttrs(!showAttrs)}>
              {showAttrs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Attributes ({Object.keys(span.attributes).length})
            </button>
            {showAttrs && (
              <div className="mt-1 text-[10px] font-mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {Object.entries(span.attributes).map(([k, v]) => (
                  <div key={k} className="contents">
                    <span className="text-muted-foreground/60">{k}</span>
                    <span className="text-foreground/70 truncate">{JSON.stringify(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Span metadata */}
        <div className="px-4 py-2 bg-background/40 text-[10px] text-muted-foreground/50 flex items-center gap-4">
          <span>ID: <code className="font-mono">{span.span_id.slice(0, 12)}</code></span>
          <span>Kind: {span.span_kind || 'unknown'}</span>
          {span.user_id && <span>User: <code className="font-mono">{span.user_id}</code></span>}
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value, isError }: { label: string; value: string; isError?: boolean | number | null }) {
  return (
    <div className="bg-background/50 px-3 py-2">
      <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', isError ? 'text-red-600' : 'text-foreground')}>{value}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground/60 text-[10px] shrink-0">{k}</span>
      <span className="font-mono text-foreground/80 truncate">{v}</span>
    </div>
  );
}
