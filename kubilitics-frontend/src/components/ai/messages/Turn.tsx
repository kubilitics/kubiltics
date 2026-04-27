import type { AssistantTurn } from '@/stores/chatStore';
import { TextBlock } from './blocks/TextBlock';
import { ToolBlock } from './blocks/ToolBlock';
import { ActionPendingBlock } from './blocks/ActionPendingBlock';
import { PlanBlock } from './blocks/PlanBlock';
import { RenderBlock } from './blocks/RenderBlock';
import { UnknownBlock } from './blocks/UnknownBlock';
import { cn } from '@/lib/utils';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { costForTurn, formatCostUSD } from '@/lib/aiPricing';

interface Props {
  turn: AssistantTurn;
}

export function Turn({ turn }: Props) {
  // Detect the "ran tools but no text answer" case so we render a clear
  // fallback instead of a silent gap. Previously this rendered as two bare
  // "UI support coming soon" stubs.
  // Defensive: blocks persisted from older shapes may lack `content`; treat
  // missing/empty content as "no text".
  const hasAnyText = turn.blocks.some(
    (b) => b.type === 'text' && typeof b.content === 'string' && b.content.trim().length > 0,
  );
  // A render_block from a Deterministic tool IS the answer; the LLM
  // intentionally returns no prose because the user sees structured
  // data directly. Don't surface the "no answer" fallback in that case.
  const hasRenderBlock = turn.blocks.some((b) => b.type === 'render_block');
  const hasAnyTool = turn.blocks.some((b) => b.type === 'tool');
  const allToolsDone =
    hasAnyTool && turn.blocks.every((b) => b.type !== 'tool' || b.endedAt !== undefined);
  const noAnswer =
    turn.state === 'done' && hasAnyTool && allToolsDone && !hasAnyText && !hasRenderBlock;

  return (
    <div
      className={cn(
        'rounded-lg bg-muted/40 px-3 py-2 my-2',
        turn.state === 'historical' && 'opacity-60',
      )}
    >
      {turn.blocks.map((b, i) => {
        if (b.type === 'text') {
          return <TextBlock key={i} content={b.content} complete={b.complete} />;
        }
        if (b.type === 'tool') {
          return <ToolBlock key={i} block={b} />;
        }
        if (b.type === 'action_pending') {
          return <ActionPendingBlock key={i} block={b} />;
        }
        if (b.type === 'plan_proposed') {
          return <PlanBlock key={i} block={b} />;
        }
        if (b.type === 'render_block') {
          return (
            <RenderBlock
              key={i}
              renderType={b.renderType}
              data={b.data}
              summary={b.summary}
            />
          );
        }
        if (b.type === 'citation') {
          return (
            <a
              key={i}
              href={b.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline my-0.5"
            >
              <ExternalLink className="h-3 w-3" />
              {b.title || b.url}
            </a>
          );
        }
        return <UnknownBlock key={i} kind={b.kind} />;
      })}
      {noAnswer && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground mt-2 border-t border-muted pt-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            The AI called tools but didn't produce a written answer. The tool results above are what
            it saw. Try rephrasing ("summarise the output above") or asking a more specific question.
          </span>
        </div>
      )}
      {turn.state === 'error' && turn.error && (
        <div className="flex items-center gap-2 text-xs text-destructive mt-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{turn.error.message}</span>
        </div>
      )}
      <TurnFooter turn={turn} />
    </div>
  );
}

/**
 * Per-turn footer rendered only when a turn has completed. Surfaces every
 * signal the brain already produces — tokens, cost, latency, tool count,
 * finish reason — in a single monospace strip. Previously the UI showed
 * "0 → 0 tokens" on every turn because the plumbing from adapter → router
 * → Done proto dropped these on the floor; see kotg-schema Done.
 */
function TurnFooter({ turn }: { turn: AssistantTurn }) {
  if (turn.state !== 'done' && turn.state !== 'error') return null;

  const provider = (turn as { meta?: { provider?: string } }).meta?.provider ?? '';
  const model = (turn as { meta?: { model?: string } }).meta?.model ?? '';

  const promptTokens = turn.meta?.promptTokens ?? 0;
  const completionTokens = turn.meta?.completionTokens ?? 0;
  const hasTokens = promptTokens > 0 || completionTokens > 0;
  const toolCalls = turn.blocks.filter((b) => b.type === 'tool').length;

  // Compute USD client-side from the authoritative token counts + the
  // locally-known provider/model. Brain's accounting.Tallier is the
  // budget-enforcement source of truth; this is a display mirror.
  const usd = hasTokens ? costForTurn(provider, model, promptTokens, completionTokens) : 0;

  // Build the strip parts first so we can comma-join and skip falsy ones
  // without stringly-typed concat mess.
  const parts: string[] = [];
  if (hasTokens) parts.push(`${promptTokens} → ${completionTokens} tokens`);
  if (hasTokens) parts.push(formatCostUSD(usd));
  if (toolCalls > 0) parts.push(`${toolCalls} tool${toolCalls === 1 ? '' : 's'}`);
  if (turn.meta?.latencyMs != null) parts.push(`${turn.meta.latencyMs}ms`);
  if (turn.meta?.finishReason && turn.meta.finishReason !== 'stop') {
    parts.push(turn.meta.finishReason);
  }
  if (parts.length === 0) return null;

  return (
    <div
      className={cn(
        'text-[10px] font-mono text-muted-foreground/80 mt-1 flex flex-wrap items-center gap-x-1',
        turn.meta?.partial && 'text-amber-600/80 dark:text-amber-400/80',
      )}
      data-testid="turn-footer"
      title={`provider: ${provider} · model: ${model}`}
    >
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground/40 mx-0.5">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}
