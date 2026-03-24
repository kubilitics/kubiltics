import { useState } from 'react';
import { ExternalLink, Square, Cable, ChevronDown, ChevronUp } from 'lucide-react';
import { usePortForwardStore, type ActivePortForward } from '@/stores/portForwardStore';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/tauri';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

function formatElapsed(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function ForwardRow({ fwd }: { fwd: ActivePortForward }) {
  const stopAndRemove = usePortForwardStore((s) => s.stopAndRemove);
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    await stopAndRemove(fwd.sessionId);
    toast.info(`Stopped port forward for ${fwd.resourceName}`);
    setStopping(false);
  };

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group text-sm">
      <Cable className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium truncate">{fwd.resourceName}</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
            {fwd.resourceType}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          :{fwd.localPort} → :{fwd.remotePort} · {fwd.namespace} · {formatElapsed(fwd.startedAt)}
        </div>
      </div>
      <button
        onClick={() => void openExternal(`http://localhost:${fwd.localPort}`)}
        className="p-1 rounded hover:bg-primary/10 text-primary"
        title={`Open http://localhost:${fwd.localPort}`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-destructive hover:bg-destructive/10"
        onClick={handleStop}
        disabled={stopping}
        title="Stop forwarding"
      >
        <Square className="h-3 w-3" fill="currentColor" />
      </Button>
    </div>
  );
}

/**
 * Compact indicator + expandable list of active port forwards.
 * Designed to sit in the top navbar or sidebar.
 */
export function ActivePortForwardsIndicator() {
  const forwards = usePortForwardStore((s) => s.forwards);
  const [expanded, setExpanded] = useState(false);

  if (forwards.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
          'hover:bg-muted/80',
          expanded && 'bg-muted'
        )}
        title={`${forwards.length} active port forward${forwards.length > 1 ? 's' : ''}`}
      >
        <Cable className="h-4 w-4 text-emerald-500" />
        <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{forwards.length}</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl border border-border bg-popover shadow-lg">
          <div className="p-2 border-b border-border">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2">
              Active Port Forwards
            </h4>
          </div>
          <div className="p-1 max-h-64 overflow-y-auto">
            {forwards.map((fwd) => (
              <ForwardRow key={fwd.sessionId} fwd={fwd} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
