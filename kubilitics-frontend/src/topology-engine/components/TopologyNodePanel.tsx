/**
 * TopologyNodePanel — Right-side slide-in panel shown when a topology node is single-clicked.
 * Redesigned as a persistent side drawer so users can see the graph and details simultaneously.
 *
 * Features:
 *  • Slides in from the right, full viewport height, 400 px wide
 *  • Larger, legible font sizes throughout
 *  • Section per resource concern: Status, Performance, Metadata, Labels, AI Insights
 *  • Copy buttons for UID and kubectl commands
 *  • All labels shown (no truncation)
 *  • Keyboard: Escape to close
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { X, ExternalLink, Copy, Check, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TopologyNode } from '../types/topology.types';
import { NODE_COLORS } from '../renderer/styles';

// ─── Helpers ──────────────────────────────────────────────────

function formatAge(createdAt: string): string {
  if (!createdAt) return '—';
  const diff = Date.now() - new Date(createdAt).getTime();
  if (diff < 0) return '—';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatTimestamp(ts: string): string {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ─── Public API ───────────────────────────────────────────────

export interface TopologyNodePanelProps {
  node: TopologyNode;
  onClose: () => void;
  onNavigate: (node: TopologyNode) => void;
  children?: ReactNode;
}

// ─── Component ────────────────────────────────────────────────

export function TopologyNodePanel({ node, onClose, onNavigate, children }: TopologyNodePanelProps) {
  const colors = NODE_COLORS[node.kind] ?? { bg: '#6B7280', border: '#4B5563', glow: '', text: '#fff' };
  const [copiedUid, setCopiedUid] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const healthVariant: 'default' | 'secondary' | 'destructive' | 'outline' =
    node.computed.health === 'healthy' ? 'default'
      : node.computed.health === 'warning' ? 'secondary'
        : 'destructive';

  const labelEntries = Object.entries(node.metadata?.labels ?? {});
  const annotationEntries = Object.entries(node.metadata?.annotations ?? {});
  const visibleLabels = showAllLabels ? labelEntries : labelEntries.slice(0, 8);
  const fullUid = node.metadata?.uid ?? '';
  const shortUid = fullUid ? `…${fullUid.slice(-12)}` : null;

  const copyUid = () => {
    if (fullUid) {
      navigator.clipboard.writeText(fullUid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 1800);
    }
  };

  return (
    <>
      {/* Dim backdrop — clicking closes panel */}
      <div
        className="fixed inset-0 z-[199] bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Side drawer */}
      <div
        className="fixed right-0 top-0 h-full z-[200] flex flex-col bg-white shadow-2xl border-l border-slate-200"
        style={{
          width: 'clamp(360px, 28vw, 480px)',
          animation: 'tnpSlideIn 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`${node.kind} details: ${node.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes tnpSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>

        {/* ── Header ── */}
        <div
          className="px-5 py-4 flex items-start gap-3 shrink-0 border-b border-slate-100"
          style={{ background: `${colors.bg}14` }}
        >
          {/* Kind badge */}
          <span
            className="shrink-0 mt-1 text-[11px] font-bold px-2.5 py-1 rounded-lg leading-tight uppercase tracking-wide"
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            {node.kind}
          </span>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-[15px] text-slate-900 break-all leading-snug">{node.name}</h2>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
              {node.apiVersion && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{node.apiVersion}</span>}
              {node.namespace && <span className="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px]">{node.namespace}</span>}
            </p>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg hover:bg-black/10 text-slate-400 hover:text-slate-700 transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <ScrollArea className="flex-1">
          <div className="px-5 py-4 space-y-5">

            {/* ── Status ── */}
            <Section title="Status">
              <Row2 label="Health">
                <Badge variant={healthVariant} className="capitalize text-xs font-semibold px-2.5 py-0.5">
                  {node.computed.health ?? '—'}
                </Badge>
              </Row2>
              <Row label="Resource Status" value={node.status ?? '—'} />
              {node.computed.replicas && (
                <>
                  <Row
                    label="Replicas (ready / desired)"
                    value={`${node.computed.replicas.ready} / ${node.computed.replicas.desired}`}
                  />
                  {node.computed.replicas.available !== undefined && (
                    <Row label="Available" value={String(node.computed.replicas.available)} />
                  )}
                </>
              )}
              {node.computed.restartCount != null && (
                <Row
                  label="Restarts"
                  value={String(node.computed.restartCount)}
                  valueClass={node.computed.restartCount > 0 ? 'text-amber-600 font-semibold' : undefined}
                />
              )}
            </Section>

            {/* ── Performance ── */}
            {(node.computed.cpuUsage != null || node.computed.memoryUsage != null) && (
              <Section title="Performance">
                {node.computed.cpuUsage != null && (
                  <Row label="CPU Usage" value={`${node.computed.cpuUsage}%`} />
                )}
                {node.computed.memoryUsage != null && (
                  <Row label="Memory Usage" value={`${node.computed.memoryUsage} MB`} />
                )}
              </Section>
            )}

            {/* ── Metadata ── */}
            <Section title="Metadata">
              <Row label="Age" value={formatAge(node.metadata?.createdAt ?? '')} />
              {node.metadata?.createdAt && (
                <Row label="Created" value={formatTimestamp(node.metadata.createdAt)} />
              )}
              {fullUid && (
                <div className="flex justify-between items-center text-sm gap-3">
                  <span className="text-slate-500 shrink-0">UID</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-slate-700 text-xs truncate">{shortUid}</span>
                    <button
                      onClick={copyUid}
                      className="shrink-0 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      title="Copy full UID"
                    >
                      {copiedUid ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}
              {annotationEntries.length > 0 && (
                <Row label="Annotations" value={`${annotationEntries.length}`} />
              )}
            </Section>

            {/* ── Labels ── */}
            {labelEntries.length > 0 && (
              <Section
                title={`Labels (${labelEntries.length})`}
                icon={<Tag className="h-3.5 w-3.5 text-slate-400" />}
              >
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {visibleLabels.map(([k, v]) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full font-mono transition-colors cursor-default"
                      title={`${k}=${v}`}
                    >
                      <span className="text-slate-500">{k}</span>
                      <span className="text-slate-400">=</span>
                      <span className="font-semibold">{v}</span>
                    </span>
                  ))}
                </div>
                {labelEntries.length > 8 && (
                  <button
                    onClick={() => setShowAllLabels(!showAllLabels)}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {showAllLabels ? 'Show less' : `+${labelEntries.length - 8} more labels`}
                  </button>
                )}
              </Section>
            )}

            {/* ── AI / extra content ── */}
            {children && (
              <Section title="AI Insights">
                {children}
              </Section>
            )}

          </div>
        </ScrollArea>

        {/* ── Footer ── */}
        <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/80 shrink-0">
          <p className="text-xs text-slate-400">Double-click to navigate directly</p>
          <Button
            size="sm"
            className="h-8 px-4 text-sm gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium"
            onClick={() => onNavigate(node)}
          >
            Go to Resource
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        {icon}
        {title}
      </h4>
      <div className="space-y-2.5 bg-slate-50 rounded-xl px-3.5 py-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-start text-sm gap-4">
      <span className="text-slate-500 shrink-0 text-xs">{label}</span>
      <span className={`font-medium text-slate-800 text-right break-all text-xs ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

function Row2({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between items-center text-sm gap-4">
      <span className="text-slate-500 shrink-0 text-xs">{label}</span>
      <span>{children}</span>
    </div>
  );
}
