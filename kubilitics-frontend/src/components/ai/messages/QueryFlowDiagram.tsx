import { useState } from 'react';
import { GitBranch, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssistantTurn, Block } from '@/stores/chatStore';

// ─── Node types ─────────────────────────────────────────────────────────────

type NodeKind = 'query' | 'llm' | 'tool-ok' | 'tool-fail' | 'tool-running' | 'render' | 'done' | 'error';

interface FlowNode {
  id: string;
  label: string;
  sublabel?: string;
  kind: NodeKind;
  latencyMs?: number;
  tokens?: { in?: number; out?: number };
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
    });
  }

  const isError = turn.state === 'error';
  nodes.push({
    id: 'done',
    label: turn.meta?.latencyMs ? `${turn.meta.latencyMs}ms` : isError ? 'Error' : 'Done',
    sublabel: isError ? turn.error?.message?.slice(0, 40) : undefined,
    kind: isError ? 'error' : 'done',
  });

  return nodes;
}

// ─── Node appearance ─────────────────────────────────────────────────────────

const kindStyles: Record<NodeKind, string> = {
  query:        'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
  llm:          'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'tool-ok':    'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'tool-fail':  'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  'tool-running': 'bg-amber-400/10 text-amber-600 dark:text-amber-400 border-amber-400/30',
  render:       'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  done:         'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30',
  error:        'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
};

const kindDot: Record<NodeKind, string> = {
  query:          'bg-blue-500',
  llm:            'bg-violet-500',
  'tool-ok':      'bg-amber-500',
  'tool-fail':    'bg-red-500',
  'tool-running': 'bg-amber-400',
  render:         'bg-emerald-500',
  done:           'bg-green-500',
  error:          'bg-red-500',
};

function ToolNodeIcon({ kind }: { kind: NodeKind }) {
  if (kind === 'tool-ok') return <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />;
  if (kind === 'tool-fail') return <XCircle className="h-3 w-3 text-red-500 shrink-0" />;
  if (kind === 'tool-running') return <Loader2 className="h-3 w-3 text-amber-400 animate-spin shrink-0" />;
  return null;
}

// ─── Single vertical node ────────────────────────────────────────────────────

function FlowNodeCard({ node, isLast }: { node: FlowNode; isLast: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {/* Connector column: dot + vertical line */}
      <div className="flex flex-col items-center mt-0.5" style={{ width: 14, flexShrink: 0 }}>
        <div className={cn('rounded-full flex-shrink-0', kindDot[node.kind])} style={{ width: 8, height: 8 }} />
        {!isLast && (
          <div className="w-px flex-1 mt-1" style={{ minHeight: 16, background: 'hsl(var(--muted-foreground) / 0.2)' }} />
        )}
      </div>

      {/* Node pill */}
      <div
        className={cn(
          'mb-1.5 rounded border px-2 py-0.5 text-[10.5px] font-mono flex items-center gap-1.5 max-w-full',
          kindStyles[node.kind],
        )}
      >
        <ToolNodeIcon kind={node.kind} />
        <span className="truncate max-w-[160px]">{node.label}</span>
        {node.latencyMs !== undefined && (
          <span className="text-[9.5px] opacity-70 shrink-0 ml-0.5">{node.latencyMs}ms</span>
        )}
        {node.tokens && (
          <span className="text-[9.5px] opacity-70 shrink-0 ml-0.5">
            {node.tokens.in != null ? fmtTokens(node.tokens.in) : '?'} in
            {' · '}
            {node.tokens.out != null ? fmtTokens(node.tokens.out) : '?'} out
          </span>
        )}
        {node.sublabel && (
          <span className="text-[9.5px] opacity-60 shrink-0 ml-0.5 hidden sm:inline">
            · {node.sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

interface Props {
  turn: AssistantTurn;
}

/**
 * Renders a collapsible vertical flow diagram showing the query processing
 * pipeline for a completed assistant turn. Derived purely from existing turn
 * data — no backend changes required.
 *
 * Shows: Query → LLM → tool calls (with timing) → render block → Done
 */
export function QueryFlowDiagram({ turn }: Props) {
  const [open, setOpen] = useState(false);

  if (turn.state === 'streaming' || turn.state === 'historical') return null;

  const nodes = deriveFlow(turn);
  // Only render if there's something interesting beyond query→llm→done
  if (nodes.length <= 3) return null;

  return (
    <div className="mt-1 border-t border-muted/50 pt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <GitBranch className="h-3 w-3" />
        <span>Query flow</span>
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>

      {open && (
        <div className="mt-1.5 pl-0.5">
          {nodes.map((node, i) => (
            <FlowNodeCard key={node.id} node={node} isLast={i === nodes.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}
