import type { RenderErrorData } from './render-types';
import { AlertTriangle } from 'lucide-react';

export function RenderErrorBlock({ data }: { data: RenderErrorData }) {
  const rawString =
    typeof data.raw === 'string'
      ? data.raw
      : data.raw == null
        ? ''
        : JSON.stringify(data.raw, null, 2);
  const wasTruncated = rawString.endsWith('...[truncated]');
  return (
    <div className="render-error rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium mb-2">
        <AlertTriangle className="h-4 w-4" />
        Could not render result from{' '}
        <code className="px-1 rounded bg-amber-500/10">{data.tool}</code>
      </div>
      <div className="text-xs text-muted-foreground mb-2">{data.error}</div>
      {rawString && (
        <pre className="font-mono text-xs bg-muted/50 rounded p-2 overflow-auto max-h-[300px] whitespace-pre">
          {rawString}
        </pre>
      )}
      {wasTruncated && (
        <div className="text-xs text-muted-foreground mt-1">
          (raw output truncated at 200 KB)
        </div>
      )}
    </div>
  );
}
