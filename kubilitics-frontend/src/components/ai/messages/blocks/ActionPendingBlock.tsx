import { AlertTriangle, ShieldCheck } from 'lucide-react';

export interface ActionPendingBlockData {
  type: 'action_pending';
  proposalId: string;
  tier?: number | string;
  summary: string;
  diff?: unknown;
}

/**
 * Minimal render for an action_pending event. Brain emits this when the AI
 * wants to run a potentially-destructive tool (scale, restart, delete) and
 * the current autonomy level requires human approval.
 *
 * Full approval UI (Approve / Deny / Preview diff) ships in subproject 3g;
 * this renderer is the honest "we see the event, here's what it wants" view
 * so the user knows the AI isn't silently failing.
 */
export function ActionPendingBlock({ block }: { block: ActionPendingBlockData }) {
  return (
    <div className="my-1 rounded-md border border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-800/60 px-2.5 py-2 text-xs">
      <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>Action proposed — awaiting approval</span>
        {block.tier !== undefined && (
          <span className="ml-auto rounded bg-amber-200/60 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-mono">
            tier {block.tier}
          </span>
        )}
      </div>
      {block.summary && <div className="mt-1 text-foreground/80 leading-snug">{block.summary}</div>}
      <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-amber-800/80 dark:text-amber-300/70">
        <ShieldCheck className="h-3 w-3" />
        <span>
          Approval flow lands in the next release. Current autonomy will hold this action until then.
        </span>
      </div>
    </div>
  );
}
