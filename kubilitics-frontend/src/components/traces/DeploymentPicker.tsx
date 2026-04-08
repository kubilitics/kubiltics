/**
 * DeploymentPicker — checkbox list of available deployments to instrument.
 * Pre-selects all non-system deployments. Shows language badges + replica count.
 */
import { useState, useEffect } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DeploymentInfo } from '@/services/api/tracing';

/* ─── Constants ──────────────────────────────────────────────────────────── */

const SYSTEM_NAMESPACES = new Set([
  'kube-system',
  'kubilitics-system',
  'cert-manager',
  'kube-node-lease',
  'kube-public',
]);

/** Language badge styling */
const LANGUAGE_STYLES: Record<string, string> = {
  java: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  'node.js': 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  nodejs: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  node: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  python: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  go: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
  golang: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
  dotnet: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  '.net': 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  csharp: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
};

function languageStyle(lang: string): string {
  const key = lang.toLowerCase().trim();
  return (
    LANGUAGE_STYLES[key] ??
    'bg-muted/50 text-muted-foreground border-border/40'
  );
}

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface DeploymentPickerProps {
  deployments: DeploymentInfo[];
  onInstrument: (selected: Array<{ name: string; namespace: string }>) => void;
  isInstrumenting: boolean;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function DeploymentPicker({
  deployments,
  onInstrument,
  isInstrumenting,
}: DeploymentPickerProps) {
  // Build stable key for a deployment
  const key = (d: DeploymentInfo) => `${d.namespace}/${d.name}`;

  // Pre-select all non-system deployments that are not already instrumented
  const defaultSelected = new Set(
    deployments
      .filter((d) => !SYSTEM_NAMESPACES.has(d.namespace) && !d.instrumented)
      .map(key),
  );

  const [selected, setSelected] = useState<Set<string>>(defaultSelected);

  // Re-compute when deployments change (e.g. dialog re-opens)
  useEffect(() => {
    setSelected(
      new Set(
        deployments
          .filter((d) => !SYSTEM_NAMESPACES.has(d.namespace) && !d.instrumented)
          .map(key),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployments.map(key).join(',')]);

  function toggle(d: DeploymentInfo) {
    const k = key(d);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function handleApply() {
    const payload = deployments
      .filter((d) => selected.has(key(d)))
      .map((d) => ({ name: d.name, namespace: d.namespace }));
    onInstrument(payload);
  }

  const selectedCount = selected.size;
  const hasRestartable = deployments.some((d) => selected.has(key(d)) && !d.instrumented);

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center text-sm text-muted-foreground gap-2">
        <span>No deployments found in this cluster.</span>
        <span className="text-xs">Deploy an application first, then return here to instrument it.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Select the deployments you want to auto-instrument with OpenTelemetry.
        System namespaces are hidden.
      </p>

      {/* Deployment list */}
      <div className="rounded-lg border border-border/50 overflow-hidden divide-y divide-border/40 max-h-64 overflow-y-auto">
        {deployments.map((d) => {
          const k = key(d);
          const isChecked = selected.has(k);
          const alreadyDone = d.instrumented;
          return (
            <label
              key={k}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none transition-colors',
                alreadyDone
                  ? 'opacity-50 cursor-default'
                  : 'hover:bg-muted/40',
              )}
            >
              <input
                type="checkbox"
                className="rounded border-border/60 accent-primary"
                checked={isChecked}
                disabled={alreadyDone || isInstrumenting}
                onChange={() => !alreadyDone && toggle(d)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{d.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.namespace}
                  </span>
                  {alreadyDone && (
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[10px] border-[hsl(var(--success))]/40 text-[hsl(var(--success))]"
                    >
                      instrumented
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {d.detected_language && d.detected_language !== 'unknown' && (
                  <Badge
                    variant="outline"
                    className={cn('h-5 px-1.5 text-[10px] font-medium', languageStyle(d.detected_language))}
                  >
                    {d.detected_language}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {d.replicas} {d.replicas === 1 ? 'replica' : 'replicas'}
                </span>
              </div>
            </label>
          );
        })}
      </div>

      {/* Restart warning */}
      {hasRestartable && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Selected deployments will be restarted to inject the OpenTelemetry
            auto-instrumentation agent. This causes a brief rolling restart.
          </span>
        </div>
      )}

      {/* Apply button */}
      <Button
        className="w-full"
        disabled={selectedCount === 0 || isInstrumenting}
        onClick={handleApply}
      >
        {isInstrumenting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Instrumenting…
          </>
        ) : (
          <>Apply Instrumentation ({selectedCount})</>
        )}
      </Button>
    </div>
  );
}
