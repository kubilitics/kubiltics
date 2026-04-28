import { useState } from 'react';
import type { LogBlockData } from './render-types';
import { Button } from '@/components/ui/button';
import { Copy, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

// LogBlock renders pod logs as a scrollable monospace surface with
// optional line numbers, truncation indicator, and a copy-all button.
//
// Why this is its own component (not just a YamlBlock with logs):
//   - Logs need line numbers (debugging context — "the error on line 42")
//   - Logs need an explicit "earlier lines elided" notice when the
//     shaper truncated the source (yaml is always whole)
//   - Log lines individually selectable for copy is more useful than
//     copy-all-yaml semantics
//
// Empty-logs state is rendered as a clear empty placeholder rather
// than a 0-tall scroll surface, so the user can tell at a glance
// "the pod returned no logs" vs "the render failed silently".

interface Props {
  data: LogBlockData;
}

export function LogBlock({ data }: Props) {
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const copyAll = () => {
    void navigator.clipboard?.writeText(data.lines.join('\n'));
  };

  // Title: "logs from <pod>/<container>" if container is known, else
  // just "logs from <pod>". Falls back to a generic label when the
  // shaper had no metadata to work with.
  const title = (() => {
    if (!data.pod) return 'Pod logs';
    if (data.container) return `Logs · ${data.pod} / ${data.container}`;
    return `Logs · ${data.pod}`;
  })();

  // Empty-state path. Distinct from "render failed" — the pod really
  // produced no logs in the requested window.
  if (!data.lines || data.lines.length === 0) {
    return (
      <div className="log-block rounded-md border bg-background/50">
        <Header
          title={title}
          showLineNumbers={showLineNumbers}
          onToggleLineNumbers={() => setShowLineNumbers((v) => !v)}
          onCopy={copyAll}
          copyDisabled
        />
        <div className="px-3 py-4 text-xs text-muted-foreground italic">
          No log lines in the requested window.
        </div>
      </div>
    );
  }

  return (
    <div className="log-block rounded-md border bg-background/50">
      <Header
        title={title}
        showLineNumbers={showLineNumbers}
        onToggleLineNumbers={() => setShowLineNumbers((v) => !v)}
        onCopy={copyAll}
      />

      {/* Truncation banner — only shown when the shaper elided lines.
          Communicates "you are seeing the tail of the log" so the SRE
          knows whether to ask for more lines or a different time window. */}
      {data.truncated && (
        <div
          className="px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border-b border-amber-500/30"
          role="note"
        >
          Earlier lines elided · showing last {data.lines.length.toLocaleString()} of{' '}
          {data.total.toLocaleString()} lines
        </div>
      )}

      <pre className="px-0 py-2 font-mono text-xs overflow-auto whitespace-pre max-h-[480px] leading-snug">
        {data.lines.map((line, i) => (
          <div
            key={i}
            className="flex items-start hover:bg-muted/40 px-3"
          >
            {showLineNumbers && (
              <span
                className={cn(
                  'select-none text-right mr-3 text-muted-foreground/50 tabular-nums',
                  // Width scales with line count so 4-digit and 1-digit
                  // displays both align cleanly without jitter.
                  data.lines.length >= 100 ? 'w-[3.5ch]' : 'w-[2.5ch]',
                )}
              >
                {data.truncated ? data.total - data.lines.length + i + 1 : i + 1}
              </span>
            )}
            <span className="flex-1 break-all">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

interface HeaderProps {
  title: string;
  showLineNumbers: boolean;
  onToggleLineNumbers: () => void;
  onCopy: () => void;
  copyDisabled?: boolean;
}

function Header({ title, showLineNumbers, onToggleLineNumbers, onCopy, copyDisabled }: HeaderProps) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-b text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <ScrollText className="h-3.5 w-3.5" />
        <span>{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleLineNumbers}
          aria-label={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
          className="h-6 px-1.5 text-[10px]"
        >
          {showLineNumbers ? '# off' : '# on'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          aria-label="Copy all log lines"
          disabled={copyDisabled}
          className="h-6 px-1.5"
        >
          <Copy className="h-3 w-3 mr-1" /> Copy
        </Button>
      </div>
    </div>
  );
}
