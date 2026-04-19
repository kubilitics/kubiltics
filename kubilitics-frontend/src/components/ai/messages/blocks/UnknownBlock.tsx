import { AlertTriangle } from 'lucide-react';

interface Props {
  kind: string;
}

/**
 * Forward-compat fallback: rendered when the sidecar emits an
 * AssistantEvent variant the frontend doesn't yet support
 * (action_pending, plan_proposed, citation, tool_*). Subproject 6 will
 * replace these with proper components.
 */
export function UnknownBlock({ kind }: Props) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed border-muted rounded-md px-2 py-1">
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>AI returned a {kind.replace('_', ' ')} event — UI support coming soon</span>
    </div>
  );
}
