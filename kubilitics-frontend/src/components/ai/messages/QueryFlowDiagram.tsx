import { useState } from 'react';
import { Cpu, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, Zap, Clock, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssistantTurn, Block } from '@/stores/chatStore';
import { costForTurn } from '@/lib/aiPricing';

// ─── Node types ──────────────────────────────────────────────────────────────

type NodeKind = 'query' | 'llm' | 'tool-ok' | 'tool-fail' | 'tool-running' | 'render' | 'done' | 'error';

interface FlowNode {
  id: string;
  label: string;
  sublabel?: string;
  kind: NodeKind;
  latencyMs?: number;
  tokens?: { in?: number; out?: number };
  resultPreview?: string;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── Derive flow from turn data ──────────────────────────────────────────────

function deriveFlow(turn: AssistantTurn): FlowNode[] {
  const nodes: FlowNode[] = [];

  nodes.push({ id: 'query', label: 'Query', kind: 'query' });

  const toolBlocks = turn.blocks.filter((b): b is Extract<Block, { type: 'tool' }> => b.type === 'tool');
  const renderBlocks = turn.blocks.filter((b): b is Extract<Block, { type: 'render_block' }> => b.type === 'render_block');
  const hasTools = toolBlocks.length > 0;
  const hasRender = renderBlocks.length > 0;

  const promptTokens = turn.meta?.promptTokens;
  const completionTokens = turn.meta?.completionTokens;
  const hasTokens = (promptTokens ?? 0) > 0 || (completionTokens ?? 0) > 0;

  nodes.push({
    id: 'llm',
    label: 'LLM',
    sublabel: hasTools || hasRender ? 'agentic loop' : undefined,
    kind: 'llm',
    tokens: hasTokens ? { in: promptTokens, out: completionTokens } : undefined,
  });

  for (const b of toolBlocks) {
    const latency = b.endedAt ? b.endedAt - b.startedAt : undefined;
    const kind: NodeKind =
      b.ok === undefined ? 'tool-running' : b.ok ? 'tool-ok' : 'tool-fail';
    nodes.push({
      id: `tool-${b.callId}`,
      label: b.toolName,
      kind,
      latencyMs: latency,
    });
  }

  for (let i = 0; i < renderBlocks.length; i++) {
    const rb = renderBlocks[i]!;
    nodes.push({
      id: `render-${i}`,
      label: rb.renderType.replace(/_/g, ' '),
      sublabel: rb.summary ?? 'structured output',
      kind: 'render',
      resultPreview: rb.summary,
    });
  }

  const isError = turn.state === 'error';
  nodes.push({
    id: 'done',
    label: turn.meta?.latencyMs ? fmtMs(turn.meta.latencyMs) : isError ? 'Error' : 'Done',
    sublabel: isError ? turn.error?.message?.slice(0, 60) : undefined,
    kind: isError ? 'error' : 'done',
  });

  return nodes;
}

// ─── Style maps ──────────────────────────────────────────────────────────────

const kindDot: Record<NodeKind, string> = {
  query:          'bg-blue-500',
  llm:            'bg-violet-500',
  'tool-ok':      'bg-amber-500',
  'tool-fail':    'bg-red-500',
  'tool-running': 'bg-amber-400 animate-pulse',
  render:         'bg-emerald-500',
  done:           'bg-green-500',
  error:          'bg-red-500',
};

const kindPill: Record<NodeKind, string> = {
  query:          'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25 ring-blue-500/10',
  llm:            'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25 ring-violet-500/10',
  'tool-ok':      'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25 ring-amber-500/10',
  'tool-fail':    'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25 ring-red-500/10',
  'tool-running': 'bg-amber-400/10 text-amber-600 dark:text-amber-400 border-amber-400/25 ring-amber-400/10',
  render:         'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 ring-emerald-500/10',
  done:           'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/25 ring-green-500/10',
  error:          'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25 ring-red-500/10',
};

function ToolNodeIcon({ kind }: { kind: NodeKind }) {
  if (kind === 'tool-ok') return <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />;
  if (kind === 'tool-fail') return <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0" />;
  if (kind === 'tool-running') return <Loader2 className="h-2.5 w-2.5 text-amber-400 animate-spin shrink-0" />;
  return null;
}

// ─── Single vertical node ────────────────────────────────────────────────────

function FlowNodeCard({ node, isLast }: { node: FlowNode; isLast: boolean }) {
  const isLLM = node.kind === 'llm';
  const hasTokens = isLLM && node.tokens && ((node.tokens.in ?? 0) > 0 || (node.tokens.out ?? 0) > 0);

  return (
    <div className="flex items-start gap-2">
      {/* Connector: dot + line */}
      <div className="flex flex-col items-center mt-[5px]" style={{ width: 12, flexShrink: 0 }}>
        <div className={cn('rounded-full flex-shrink-0', kindDot[node.kind])} style={{ width: 7, height: 7 }} />
        {!isLast && (
          <div
            className="w-px flex-1 mt-0.5"
            style={{ minHeight: 14, background: 'hsl(var(--muted-foreground) / 0.18)' }}
          />
        )}
      </div>

      {/* Pill */}
      <div className="mb-1.5 flex flex-col gap-0.5 min-w-0 flex-1">
        <div
          className={cn(
            'rounded border px-2 py-[3px] text-[10px] font-mono flex items-center gap-1.5 w-fit max-w-full',
            kindPill[node.kind],
          )}
        >
          <ToolNodeIcon kind={node.kind} />
          <span className="truncate max-w-[180px] font-medium">{node.label}</span>

          {/* Latency */}
          {node.latencyMs !== undefined && (
            <span className="opacity-55 shrink-0 flex items-center gap-0.5">
              <Clock className="h-2 w-2" />
              {fmtMs(node.latencyMs)}
            </span>
          )}

          {/* Token badge on LLM node */}
          {hasTokens && (
            <span className="flex items-center gap-0.5 opacity-80 shrink-0 ml-0.5">
              <Zap className="h-2 w-2 text-violet-400" />
              <span>{fmtTokens(node.tokens!.in ?? 0)}</span>
              <span className="opacity-50">→</span>
              <span>{fmtTokens(node.tokens!.out ?? 0)}</span>
            </span>
          )}

          {/* Sublabel */}
          {node.sublabel && !node.resultPreview && (
            <span className="opacity-50 shrink-0 hidden sm:inline">· {node.sublabel}</span>
          )}
        </div>

        {/* Render result preview — inline below pill */}
        {node.resultPreview && (
          <p className="text-[9.5px] text-muted-foreground/60 pl-1 truncate max-w-[260px]">
            {node.resultPreview}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Summary bar (collapsed state) ───────────────────────────────────────────

function SummaryBar({ turn, open, onToggle }: { turn: AssistantTurn; open: boolean; onToggle: () => void }) {
  const toolBlocks = turn.blocks.filter((b): b is Extract<Block, { type: 'tool' }> => b.type === 'tool');
  const promptTokens = turn.meta?.promptTokens ?? 0;
  const completionTokens = turn.meta?.completionTokens ?? 0;
  const hasTokens = promptTokens > 0 || completionTokens > 0;
  const totalMs = turn.meta?.latencyMs;
  const provider = (turn as { meta?: { provider?: string } }).meta?.provider ?? '';
  const model = (turn as { meta?: { model?: string } }).meta?.model ?? '';
  const usd = hasTokens ? costForTurn(provider, model, promptTokens, completionTokens) : 0;

  const chips: string[] = [];
  if (toolBlocks.length > 0) chips.push(`${toolBlocks.length} tool${toolBlocks.length !== 1 ? 's' : ''}`);
  if (hasTokens) chips.push(`${fmtTokens(promptTokens + completionTokens)} tok`);
  if (usd > 0) chips.push(`$${usd.toFixed(4)}`);
  if (totalMs != null) chips.push(fmtMs(totalMs));

  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors group"
    >
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="font-medium group-hover:text-muted-foreground/80">Query flow</span>
      {chips.length > 0 && !open && (
        <span className="flex items-center gap-1 opacity-70">
          {chips.map((c, i) => (
            <span key={i} className="bg-muted/60 rounded px-1 py-px text-[9px] font-mono">{c}</span>
          ))}
        </span>
      )}
      {open ? <ChevronDown className="h-3 w-3 opacity-50" /> : <ChevronRight className="h-3 w-3 opacity-50" />}
    </button>
  );
}

// ─── Token footer ─────────────────────────────────────────────────────────────

function TokenFooter({ turn }: { turn: AssistantTurn }) {
  const promptTokens = turn.meta?.promptTokens ?? 0;
  const completionTokens = turn.meta?.completionTokens ?? 0;
  if (promptTokens === 0 && completionTokens === 0) return null;

  const provider = (turn as { meta?: { provider?: string } }).meta?.provider ?? '';
  const model = (turn as { meta?: { model?: string } }).meta?.model ?? '';
  const usd = costForTurn(provider, model, promptTokens, completionTokens);

  return (
    <div className="mt-1.5 pt-1.5 border-t border-muted/30 flex items-center gap-3 text-[9.5px] text-muted-foreground/50 font-mono">
      <span className="flex items-center gap-1">
        <Cpu className="h-2.5 w-2.5" />
        <span className="text-violet-500/70">{fmtTokens(promptTokens)}</span>
        <span>in</span>
        <span className="text-violet-500/70">{fmtTokens(completionTokens)}</span>
        <span>out</span>
        <span>·</span>
        <span>{fmtTokens(promptTokens + completionTokens)} total</span>
      </span>
      {usd > 0 && (
        <span className="flex items-center gap-0.5 opacity-70">
          <Zap className="h-2 w-2" />
          ${usd.toFixed(4)}
        </span>
      )}
      {model && <span className="opacity-50 truncate max-w-[100px]">{model}</span>}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

interface Props {
  turn: AssistantTurn;
}

/**
 * Collapsible query flow diagram showing the full LLM pipeline for a turn.
 * Includes: tool calls with timing, token usage, cost estimate, result previews.
 */
export function QueryFlowDiagram({ turn }: Props) {
  const [open, setOpen] = useState(true);

  if (turn.state === 'streaming' || turn.state === 'historical') return null;

  const nodes = deriveFlow(turn);
  if (nodes.length <= 3) return null;

  return (
    <div className="mt-1.5 border-t border-muted/40 pt-1.5">
      <SummaryBar turn={turn} open={open} onToggle={() => setOpen((v) => !v)} />

      {open && (
        <div className="mt-1.5 pl-0.5">
          {nodes.map((node, i) => (
            <FlowNodeCard key={node.id} node={node} isLast={i === nodes.length - 1} />
          ))}
          <TokenFooter turn={turn} />
        </div>
      )}
    </div>
  );
}
