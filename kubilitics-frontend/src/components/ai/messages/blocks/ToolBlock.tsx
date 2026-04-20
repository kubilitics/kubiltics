import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Real tool-call renderer.
 *
 * Replaces the v1 "UI support coming soon" stub. A ToolBlock starts in
 * `running` state the moment the brain emits a `tool_start` event, then
 * transitions to `done` (ok=true) or `failed` (ok=false) when the matching
 * `tool_end` arrives. Result preview is collapsed by default and expands
 * on click so long tool outputs don't drown the chat.
 */
export interface ToolBlockData {
  type: 'tool';
  callId: string;
  toolName: string;
  startPreview?: string; // e.g. "Looking up pods in default..."
  endPreview?: string; // e.g. "Found 14 pods"
  ok?: boolean; // undefined while running
  startedAt: number; // epoch ms
  endedAt?: number;
}

export function ToolBlock({ block }: { block: ToolBlockData }) {
  const [expanded, setExpanded] = useState(false);
  const running = block.ok === undefined;
  const ok = block.ok === true;
  const latency = block.endedAt ? block.endedAt - block.startedAt : undefined;

  const Icon = running ? Loader2 : ok ? CheckCircle2 : XCircle;
  const iconClass = running
    ? 'text-primary animate-spin'
    : ok
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-destructive';

  const preview = running ? block.startPreview : block.endPreview || block.startPreview;
  const hasDetail = !!preview;

  return (
    <div
      className={cn(
        'my-1 rounded-md border border-muted bg-muted/30 px-2.5 py-1.5 text-xs',
        !running && 'cursor-pointer select-none hover:bg-muted/50',
      )}
      onClick={() => hasDetail && !running && setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', iconClass)} />
        <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="font-mono text-[11px] text-foreground/90">{block.toolName}</span>
        {latency !== undefined && (
          <span className="text-[10px] text-muted-foreground ml-auto">{latency}ms</span>
        )}
        {hasDetail && !running && (
          <span className="text-muted-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </div>
      {expanded && preview && (
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[10.5px] text-foreground/80">
          {preview}
        </pre>
      )}
      {running && preview && (
        <div className="mt-1 pl-5 text-muted-foreground text-[10.5px] italic truncate">
          {preview}
        </div>
      )}
    </div>
  );
}
