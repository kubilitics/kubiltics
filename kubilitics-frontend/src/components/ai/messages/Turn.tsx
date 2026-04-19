import type { AssistantTurn } from '@/stores/chatStore';
import { TextBlock } from './blocks/TextBlock';
import { UnknownBlock } from './blocks/UnknownBlock';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

interface Props {
  turn: AssistantTurn;
}

export function Turn({ turn }: Props) {
  return (
    <div
      className={cn(
        'rounded-lg bg-muted/40 px-3 py-2 my-2',
        turn.state === 'historical' && 'opacity-60'
      )}
    >
      {turn.blocks.map((b, i) => {
        if (b.type === 'text') {
          return <TextBlock key={i} content={b.content} complete={b.complete} />;
        }
        return <UnknownBlock key={i} kind={b.kind} />;
      })}
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
