import type { AssistantTurn } from '@/stores/chatStore';
import { TextBlock } from './blocks/TextBlock';
import { ToolBlock } from './blocks/ToolBlock';
import { ActionPendingBlock } from './blocks/ActionPendingBlock';
import { PlanBlock } from './blocks/PlanBlock';
import { UnknownBlock } from './blocks/UnknownBlock';
import { cn } from '@/lib/utils';
import { AlertCircle, ExternalLink } from 'lucide-react';

interface Props {
  turn: AssistantTurn;
}

export function Turn({ turn }: Props) {
  // Detect the "ran tools but no text answer" case so we render a clear
  // fallback instead of a silent gap. Previously this rendered as two bare
  // "UI support coming soon" stubs.
  const hasAnyText = turn.blocks.some((b) => b.type === 'text' && b.content.trim().length > 0);
  const hasAnyTool = turn.blocks.some((b) => b.type === 'tool');
  const allToolsDone = hasAnyTool && turn.blocks.every((b) => b.type !== 'tool' || b.endedAt !== undefined);
  const noAnswer = turn.state === 'done' && hasAnyTool && allToolsDone && !hasAnyText;

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
      {turn.state === 'done' && turn.meta?.completionTokens !== undefined && (
        <div className="text-[10px] text-muted-foreground mt-1">
          {turn.meta.promptTokens ?? 0} → {turn.meta.completionTokens} tokens
          {turn.meta.latencyMs !== undefined && ` · ${turn.meta.latencyMs}ms`}
        </div>
      )}
    </div>
  );
}
